import React from 'react';

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataSourcePluginOptionsEditorProps, DataSourceSettings } from '@grafana/data';

import { CrateDBOptions, CrateDBSecureOptions, TLSConfigMethod, TLSMode } from '../types';
import { ConfigEditor } from './ConfigEditor';

type Props = DataSourcePluginOptionsEditorProps<CrateDBOptions, CrateDBSecureOptions>;

function makeProps(jsonData: Partial<CrateDBOptions> = {}): Props {
  const options = {
    id: 1,
    uid: 'test',
    orgId: 1,
    name: 'CrateDB',
    type: 'cratedb-cratedb-datasource',
    typeName: 'CrateDB',
    typeLogoUrl: '',
    access: 'proxy',
    url: '',
    user: '',
    database: '',
    basicAuth: false,
    basicAuthUser: '',
    isDefault: false,
    jsonData: jsonData as CrateDBOptions,
    secureJsonFields: {},
    readOnly: false,
    withCredentials: false,
  } as DataSourceSettings<CrateDBOptions, CrateDBSecureOptions>;
  return { options, onOptionsChange: jest.fn() };
}

describe('ConfigEditor Host URL', () => {
  it('splits host:port into the server and port jsonData keys', async () => {
    const props = makeProps();
    render(<ConfigEditor {...props} />);

    await userEvent.type(screen.getByPlaceholderText('localhost:5432'), 'db.example.com:5433');

    expect(props.onOptionsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        jsonData: expect.objectContaining({ server: 'db.example.com', port: 5433 }),
      })
    );
  });

  it('leaves the port unset when only a host is typed', async () => {
    const props = makeProps();
    render(<ConfigEditor {...props} />);

    await userEvent.type(screen.getByPlaceholderText('localhost:5432'), 'localhost');

    expect(props.onOptionsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        jsonData: expect.objectContaining({ server: 'localhost', port: undefined }),
      })
    );
  });

  it('displays existing server and port keys joined', () => {
    render(<ConfigEditor {...makeProps({ server: 'crate.internal', port: 5433 })} />);
    expect(screen.getByDisplayValue('crate.internal:5433')).toBeInTheDocument();
  });

  it('warns when the CrateDB HTTP port is entered', async () => {
    render(<ConfigEditor {...makeProps()} />);

    await userEvent.type(screen.getByPlaceholderText('localhost:5432'), 'myhost:4200');

    expect(screen.getByText(/Port 4200 is CrateDB's HTTP port/)).toBeInTheDocument();
  });

  it('warns for a provisioned datasource pointing at an HTTP-range port', () => {
    render(<ConfigEditor {...makeProps({ server: 'crate.internal', port: 4201 })} />);
    expect(screen.getByText(/Port 4201 is CrateDB's HTTP port/)).toBeInTheDocument();
  });

  it('does not warn for the PostgreSQL wire-protocol port', async () => {
    render(<ConfigEditor {...makeProps()} />);

    await userEvent.type(screen.getByPlaceholderText('localhost:5432'), 'myhost:5432');

    expect(screen.queryByText(/is CrateDB's HTTP port/)).not.toBeInTheDocument();
  });
});

describe('ConfigEditor TLS/SSL', () => {
  it('hides method and cert details while TLS is disabled', () => {
    render(<ConfigEditor {...makeProps()} />);
    expect(screen.queryByText('TLS/SSL Method')).not.toBeInTheDocument();
    expect(screen.queryByText('TLS/SSL Auth Details')).not.toBeInTheDocument();
  });

  it('defaults to certificate content with the PEM textareas', () => {
    render(<ConfigEditor {...makeProps({ tlsMode: TLSMode.Require })} />);
    expect(screen.getByText('TLS/SSL Method')).toBeInTheDocument();
    expect(screen.getByText('TLS/SSL Auth Details')).toBeInTheDocument();
    expect(screen.getByText('TLS/SSL Root Certificate')).toBeInTheDocument();
    expect(document.querySelector('input[name="tlsCACertFile"]')).toBeNull();
  });

  it('switching the method to file system path emits tlsConfigurationMethod', async () => {
    const props = makeProps({ tlsMode: TLSMode.Require });
    render(<ConfigEditor {...props} />);

    // the accessible name includes the Field description, so match by prefix.
    // jsdom can't lay out the virtualized option list, but downshift's
    // keyboard handling selects independently of rendering: the first option
    // is "File system path".
    const method = screen.getByRole('combobox', { name: /^TLS\/SSL Method/ });
    await userEvent.click(method);
    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(props.onOptionsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonData: expect.objectContaining({ tlsConfigurationMethod: TLSConfigMethod.FilePath }),
      })
    );
  });

  it('file-path method shows path inputs bound to jsonData', async () => {
    const props = makeProps({
      tlsMode: TLSMode.VerifyFull,
      tlsConfigurationMethod: TLSConfigMethod.FilePath,
      tlsCACertFile: '/etc/grafana/certs/root.crt',
    });
    render(<ConfigEditor {...props} />);

    const caInput = screen.getByDisplayValue('/etc/grafana/certs/root.crt');
    expect(caInput).toHaveAttribute('name', 'tlsCACertFile');

    const keyInput = document.querySelector('input[name="tlsClientKeyFile"]');
    expect(keyInput).not.toBeNull();
    // single keystroke: the input is controlled and onOptionsChange is a mock,
    // so the value prop never advances between keys
    await userEvent.type(keyInput as Element, 'k');
    expect(props.onOptionsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonData: expect.objectContaining({ tlsClientKeyFile: 'k' }),
      })
    );
  });

  it('keeps the stored PEM state when the method is content and a secret is configured', () => {
    const props = makeProps({ tlsMode: TLSMode.Require });
    props.options.secureJsonFields = { tlsCACert: true };
    render(<ConfigEditor {...props} />);

    // configured secrets render as a reset-able field
    expect(screen.getByText('TLS/SSL Root Certificate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
  });
});

describe('ConfigEditor additional settings', () => {
  // the section is collapsible and starts closed; the toggle is an icon button
  async function openAdditional() {
    await userEvent.click(screen.getByRole('button', { name: 'Expand section Additional settings' }));
  }

  it('parses the row limit as a number', async () => {
    const props = makeProps();
    render(<ConfigEditor {...props} />);
    await openAdditional();

    await userEvent.type(document.querySelector('input[name="rowLimit"]') as Element, '5');

    expect(props.onOptionsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ jsonData: expect.objectContaining({ rowLimit: 5 }) })
    );
  });

  it('stores the min time interval as a string', async () => {
    const props = makeProps();
    render(<ConfigEditor {...props} />);
    await openAdditional();

    await userEvent.type(document.querySelector('input[name="timeInterval"]') as Element, '1');

    expect(props.onOptionsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ jsonData: expect.objectContaining({ timeInterval: '1' }) })
    );
  });

  it('parses a connection-pool limit as a number', async () => {
    const props = makeProps();
    render(<ConfigEditor {...props} />);
    await openAdditional();

    await userEvent.type(document.querySelector('input[name="maxOpenConnections"]') as Element, '8');

    expect(props.onOptionsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ jsonData: expect.objectContaining({ maxOpenConnections: 8 }) })
    );
  });

  it('toggling the disable-cache switch sets disableSchemaCache', async () => {
    const props = makeProps();
    const { container } = render(<ConfigEditor {...props} />);
    await openAdditional();

    await userEvent.click(container.querySelector('input#disableSchemaCache') as Element);

    expect(props.onOptionsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ jsonData: expect.objectContaining({ disableSchemaCache: true }) })
    );
  });

  it('disables the cache TTL input when the cache is disabled', async () => {
    render(<ConfigEditor {...makeProps({ disableSchemaCache: true })} />);
    await openAdditional();

    expect(document.querySelector('input[name="schemaCacheTTLSeconds"]')).toBeDisabled();
  });

  it('enables the cache TTL input when the cache is on', async () => {
    render(<ConfigEditor {...makeProps()} />);
    await openAdditional();

    expect(document.querySelector('input[name="schemaCacheTTLSeconds"]')).not.toBeDisabled();
  });
});
