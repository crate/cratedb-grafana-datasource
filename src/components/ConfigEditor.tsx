import React, { ChangeEvent } from 'react';

import {
  DataSourcePluginOptionsEditorProps,
  onUpdateDatasourceJsonDataOption,
  onUpdateDatasourceSecureJsonDataOption,
  updateDatasourcePluginResetOption,
} from '@grafana/data';
import { ConfigSection, DataSourceDescription } from '@grafana/plugin-ui';
import {
  Combobox,
  ComboboxOption,
  Divider,
  Field,
  InlineSwitch,
  Input,
  SecretInput,
  SecretTextArea,
} from '@grafana/ui';

import { DEFAULTS, DOCS_URL } from '../constants';
import { CrateDBOptions, CrateDBSecureOptions, TLSMode } from '../types';

type Props = DataSourcePluginOptionsEditorProps<CrateDBOptions, CrateDBSecureOptions>;

const TLS_MODES: Array<ComboboxOption<TLSMode>> = [
  { label: 'disable', value: TLSMode.Disable },
  { label: 'require', value: TLSMode.Require },
  { label: 'verify-ca', value: TLSMode.VerifyCA },
  { label: 'verify-full', value: TLSMode.VerifyFull },
];

export function ConfigEditor(props: Props) {
  const { options, onOptionsChange } = props;
  const { jsonData, secureJsonFields } = options;
  const secureJsonData = (options.secureJsonData ?? {}) as CrateDBSecureOptions;

  const onPortChange = (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: { ...jsonData, port: e.currentTarget.value === '' ? undefined : +e.currentTarget.value },
    });
  };

  const onNumberOption = (key: keyof CrateDBOptions) => (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: { ...jsonData, [key]: e.currentTarget.value === '' ? undefined : +e.currentTarget.value },
    });
  };

  const tlsEnabled = (jsonData.tlsMode ?? DEFAULTS.tlsMode) !== TLSMode.Disable;

  return (
    <>
      <DataSourceDescription dataSourceName="CrateDB" docsLink={DOCS_URL} hasRequiredFields />
      <Divider />

      <ConfigSection title="Connection">
        <Field label="Server address" description="Hostname of a CrateDB node or load balancer." required>
          <Input
            name="server"
            width={40}
            value={jsonData.server ?? ''}
            placeholder="localhost"
            onChange={onUpdateDatasourceJsonDataOption(props, 'server')}
          />
        </Field>
        <Field label="Server port" description="CrateDB's PostgreSQL wire protocol port.">
          <Input
            name="port"
            width={40}
            type="number"
            value={jsonData.port ?? ''}
            placeholder={String(DEFAULTS.port)}
            onChange={onPortChange}
          />
        </Field>
      </ConfigSection>
      <Divider />

      <ConfigSection title="Credentials">
        <Field label="Username">
          <Input
            name="username"
            width={40}
            value={jsonData.username ?? ''}
            placeholder={DEFAULTS.username}
            onChange={onUpdateDatasourceJsonDataOption(props, 'username')}
          />
        </Field>
        <Field
          label="Password"
          description="Optional — CrateDB defaults to trust authentication (e.g. the official Docker image)."
        >
          <SecretInput
            name="password"
            width={40}
            isConfigured={!!secureJsonFields?.password}
            value={secureJsonData.password ?? ''}
            onChange={onUpdateDatasourceSecureJsonDataOption(props, 'password')}
            onReset={() => updateDatasourcePluginResetOption(props, 'password')}
          />
        </Field>
      </ConfigSection>
      <Divider />

      <ConfigSection title="Schema">
        <Field
          label="Default schema"
          description='Applied as search_path. CrateDB stores user tables in "doc"; "sys" holds cluster monitoring tables.'
        >
          <Input
            name="defaultSchema"
            width={40}
            value={jsonData.defaultSchema ?? ''}
            placeholder={DEFAULTS.defaultSchema}
            onChange={onUpdateDatasourceJsonDataOption(props, 'defaultSchema')}
          />
        </Field>
      </ConfigSection>
      <Divider />

      <ConfigSection title="TLS / SSL">
        <Field label="TLS mode">
          <Combobox
            options={TLS_MODES}
            value={jsonData.tlsMode ?? DEFAULTS.tlsMode}
            width={40}
            onChange={(mode) =>
              onOptionsChange({
                ...options,
                jsonData: {
                  ...jsonData,
                  tlsMode: mode.value,
                  tlsConfigurationMethod: DEFAULTS.tlsConfigurationMethod,
                },
              })
            }
          />
        </Field>
        {tlsEnabled && (
          <>
            <Field label="CA certificate" description="PEM content of the certificate authority.">
              <SecretTextArea
                cols={60}
                rows={5}
                isConfigured={!!secureJsonFields?.tlsCACert}
                onChange={onUpdateDatasourceSecureJsonDataOption(props, 'tlsCACert')}
                onReset={() => updateDatasourcePluginResetOption(props, 'tlsCACert')}
              />
            </Field>
            <Field label="Client certificate" description="PEM content; requires the client key as well.">
              <SecretTextArea
                cols={60}
                rows={5}
                isConfigured={!!secureJsonFields?.tlsClientCert}
                onChange={onUpdateDatasourceSecureJsonDataOption(props, 'tlsClientCert')}
                onReset={() => updateDatasourcePluginResetOption(props, 'tlsClientCert')}
              />
            </Field>
            <Field label="Client key" description="PEM content of the client private key.">
              <SecretTextArea
                cols={60}
                rows={5}
                isConfigured={!!secureJsonFields?.tlsClientKey}
                onChange={onUpdateDatasourceSecureJsonDataOption(props, 'tlsClientKey')}
                onReset={() => updateDatasourcePluginResetOption(props, 'tlsClientKey')}
              />
            </Field>
          </>
        )}
      </ConfigSection>
      <Divider />

      <ConfigSection title="Advanced" isCollapsible isInitiallyOpen={false}>
        <Field label="Connect timeout (seconds)">
          <Input
            name="timeout"
            width={40}
            type="number"
            value={jsonData.timeout ?? ''}
            placeholder="10"
            onChange={onNumberOption('timeout')}
          />
        </Field>
        <Field label="Query timeout (seconds)">
          <Input
            name="queryTimeout"
            width={40}
            type="number"
            value={jsonData.queryTimeout ?? ''}
            placeholder="60"
            onChange={onNumberOption('queryTimeout')}
          />
        </Field>
        <Field label="Max open connections">
          <Input
            name="maxOpenConnections"
            width={40}
            type="number"
            value={jsonData.maxOpenConnections ?? ''}
            placeholder="unlimited"
            onChange={onNumberOption('maxOpenConnections')}
          />
        </Field>
        <Field label="Max idle connections">
          <Input
            name="maxIdleConnections"
            width={40}
            type="number"
            value={jsonData.maxIdleConnections ?? ''}
            placeholder="2"
            onChange={onNumberOption('maxIdleConnections')}
          />
        </Field>
        <Field label="Max connection lifetime (seconds)">
          <Input
            name="maxConnectionLifetime"
            width={40}
            type="number"
            value={jsonData.maxConnectionLifetime ?? ''}
            placeholder="14400"
            onChange={onNumberOption('maxConnectionLifetime')}
          />
        </Field>
        <Field
          label="Min time interval"
          description="Lower bound for $__interval, e.g. 1m. Defaults to the panel resolution."
        >
          <Input
            name="timeInterval"
            width={40}
            value={jsonData.timeInterval ?? ''}
            placeholder="1m"
            onChange={onUpdateDatasourceJsonDataOption(props, 'timeInterval')}
          />
        </Field>
        <Field label="Secure Socks Proxy" description="Route the connection through the Grafana secure socks proxy.">
          <InlineSwitch
            value={jsonData.enableSecureSocksProxy ?? false}
            onChange={(e) =>
              onOptionsChange({
                ...options,
                jsonData: { ...jsonData, enableSecureSocksProxy: e.currentTarget.checked },
              })
            }
          />
        </Field>
      </ConfigSection>
    </>
  );
}
