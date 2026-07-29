import React, { ChangeEvent, useState } from 'react';

import {
  DataSourcePluginOptionsEditorProps,
  onUpdateDatasourceJsonDataOption,
  onUpdateDatasourceSecureJsonDataOption,
  updateDatasourcePluginResetOption,
} from '@grafana/data';
import { ConfigSection, ConfigSubSection, DataSourceDescription } from '@grafana/plugin-ui';
import { config } from '@grafana/runtime';
import { Combobox, ComboboxOption, Divider, Field, InlineSwitch, Input, SecretInput, SecretTextArea } from '@grafana/ui';

import { DEFAULTS, DOCS_URL } from '../constants';
import { joinHostURL, splitHostURL } from '../data/hostUrl';
import { CrateDBOptions, CrateDBSecureOptions, TLSConfigMethod, TLSMode } from '../types';

type Props = DataSourcePluginOptionsEditorProps<CrateDBOptions, CrateDBSecureOptions>;

// structure and wording mirror the built-in PostgreSQL datasource config; the
// jsonData/secureJsonData keys stay CrateDB's own

const TLS_MODES: Array<ComboboxOption<TLSMode>> = [
  { label: 'disable', value: TLSMode.Disable },
  { label: 'require', value: TLSMode.Require },
  { label: 'verify-ca', value: TLSMode.VerifyCA },
  { label: 'verify-full', value: TLSMode.VerifyFull },
];

const TLS_METHODS: Array<ComboboxOption<TLSConfigMethod>> = [
  { label: 'File system path', value: TLSConfigMethod.FilePath },
  { label: 'Certificate content', value: TLSConfigMethod.FileContent },
];

export function ConfigEditor(props: Props) {
  const { options, onOptionsChange } = props;
  const { jsonData, secureJsonFields } = options;
  const secureJsonData = (options.secureJsonData ?? {}) as CrateDBSecureOptions;

  // local text state so intermediate input like "localhost:" isn't reshaped
  // by the parse/join round trip while typing
  const [hostUrl, setHostUrl] = useState(() => joinHostURL({ server: jsonData.server, port: jsonData.port }));

  const onHostURLChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    setHostUrl(value);
    const { server, port } = splitHostURL(value);
    onOptionsChange({ ...options, jsonData: { ...jsonData, server, port } });
  };

  const onNumberOption = (key: keyof CrateDBOptions) => (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: { ...jsonData, [key]: e.currentTarget.value === '' ? undefined : +e.currentTarget.value },
    });
  };

  // 4200-4299 is CrateDB's HTTP port range — a classic mix-up, since that's
  // the port the Admin UI runs on; this plugin speaks the pg wire protocol
  const typedPort = splitHostURL(hostUrl).port;
  const httpPortWarning =
    typedPort !== undefined && typedPort >= 4200 && typedPort <= 4299
      ? `Port ${typedPort} is CrateDB's HTTP port. This plugin connects over the PostgreSQL wire protocol, usually port 5432.`
      : undefined;

  const tlsEnabled = (jsonData.tlsMode ?? DEFAULTS.tlsMode) !== TLSMode.Disable;
  // unset means file-content on the backend, so a provisioned file-path
  // datasource displays its actual mode and everything else defaults to content
  const tlsMethod = jsonData.tlsConfigurationMethod ?? TLSConfigMethod.FileContent;

  return (
    <>
      <DataSourceDescription dataSourceName="CrateDB" docsLink={DOCS_URL} hasRequiredFields />
      <Divider />

      <ConfigSection title="User Permissions" isCollapsible isInitiallyOpen={false}>
        <p>
          A panel can run any SQL the connected user is allowed to — including writes and DDL. Connect with a read-only
          user, e.g. <code>GRANT DQL ON SCHEMA doc TO grafana;</code>
        </p>
      </ConfigSection>
      <Divider />

      <ConfigSection title="Connection">
        <Field
          label="Host URL"
          description="CrateDB node or load balancer as host:port. Use the PostgreSQL port (5432), not the HTTP port (4200)."
          required
          invalid={!!httpPortWarning}
          error={httpPortWarning}
        >
          <Input id="host" name="host" width={40} value={hostUrl} placeholder="localhost:5432" onChange={onHostURLChange} />
        </Field>
        <Field
          label="Default schema"
          description='Applied as search_path. CrateDB stores user tables in "doc"; "sys" holds cluster monitoring tables.'
        >
          <Input
            id="defaultSchema"
            name="defaultSchema"
            width={40}
            value={jsonData.defaultSchema ?? ''}
            placeholder={DEFAULTS.defaultSchema}
            onChange={onUpdateDatasourceJsonDataOption(props, 'defaultSchema')}
          />
        </Field>
      </ConfigSection>
      <Divider />

      <ConfigSection title="Authentication">
        <Field label="Username">
          <Input
            id="username"
            name="username"
            width={40}
            value={jsonData.username ?? ''}
            placeholder={DEFAULTS.username}
            onChange={onUpdateDatasourceJsonDataOption(props, 'username')}
          />
        </Field>
        <Field
          label="Password"
          description="Optional; CrateDB defaults to trust authentication (e.g. the official Docker image)."
        >
          <SecretInput
            id="password"
            name="password"
            width={40}
            isConfigured={!!secureJsonFields?.password}
            value={secureJsonData.password ?? ''}
            onChange={onUpdateDatasourceSecureJsonDataOption(props, 'password')}
            onReset={() => updateDatasourcePluginResetOption(props, 'password')}
          />
        </Field>
        <Field
          label="TLS/SSL Mode"
          description="Whether, and how strictly, to negotiate TLS with the server."
        >
          <Combobox
            id="tlsMode"
            options={TLS_MODES}
            value={jsonData.tlsMode ?? DEFAULTS.tlsMode}
            width={40}
            onChange={(mode) =>
              onOptionsChange({
                ...options,
                jsonData: { ...jsonData, tlsMode: mode.value },
              })
            }
          />
        </Field>
        {tlsEnabled && (
          <Field
            label="TLS/SSL Method"
            description="Point to certificate files on the Grafana server, or paste their contents (stored encrypted)."
          >
            <Combobox
              id="tlsMethod"
              options={TLS_METHODS}
              value={tlsMethod}
              width={40}
              onChange={(method) =>
                // switching only changes which fields the backend reads;
                // the other method's stored values are kept
                onOptionsChange({
                  ...options,
                  jsonData: { ...jsonData, tlsConfigurationMethod: method.value },
                })
              }
            />
          </Field>
        )}
      </ConfigSection>

      {tlsEnabled && (
        <>
          <Divider />
          <ConfigSection title="TLS/SSL Auth Details">
            {tlsMethod === TLSConfigMethod.FilePath ? (
              <>
                <Field
                  label="TLS/SSL Root Certificate"
                  description="Path to the server root certificate file, if your TLS mode needs one."
                >
                  <Input
                    id="tlsCACertFile"
                    name="tlsCACertFile"
                    width={60}
                    value={jsonData.tlsCACertFile ?? ''}
                    placeholder="TLS/SSL root cert file"
                    onChange={onUpdateDatasourceJsonDataOption(props, 'tlsCACertFile')}
                  />
                </Field>
                <Field
                  label="TLS/SSL Client Certificate"
                  description="Path to the client certificate file, readable by the Grafana server process."
                >
                  <Input
                    id="tlsClientCertFile"
                    name="tlsClientCertFile"
                    width={60}
                    value={jsonData.tlsClientCertFile ?? ''}
                    placeholder="TLS/SSL client cert file"
                    onChange={onUpdateDatasourceJsonDataOption(props, 'tlsClientCertFile')}
                  />
                </Field>
                <Field
                  label="TLS/SSL Client Key"
                  description="Path to the client key file; keep it readable only by the Grafana server process."
                >
                  <Input
                    id="tlsClientKeyFile"
                    name="tlsClientKeyFile"
                    width={60}
                    value={jsonData.tlsClientKeyFile ?? ''}
                    placeholder="TLS/SSL client key file"
                    onChange={onUpdateDatasourceJsonDataOption(props, 'tlsClientKeyFile')}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field
                  label="TLS/SSL Root Certificate"
                  description="If the selected TLS/SSL mode requires a server root certificate, provide it here."
                >
                  <SecretTextArea
                    cols={60}
                    rows={7}
                    placeholder="-----BEGIN CERTIFICATE-----"
                    isConfigured={!!secureJsonFields?.tlsCACert}
                    onChange={onUpdateDatasourceSecureJsonDataOption(props, 'tlsCACert')}
                    onReset={() => updateDatasourcePluginResetOption(props, 'tlsCACert')}
                  />
                </Field>
                <Field
                  label="TLS/SSL Client Certificate"
                  description="To authenticate with a TLS/SSL client certificate, provide the certificate content here; requires the client key as well."
                >
                  <SecretTextArea
                    cols={60}
                    rows={7}
                    placeholder="-----BEGIN CERTIFICATE-----"
                    isConfigured={!!secureJsonFields?.tlsClientCert}
                    onChange={onUpdateDatasourceSecureJsonDataOption(props, 'tlsClientCert')}
                    onReset={() => updateDatasourcePluginResetOption(props, 'tlsClientCert')}
                  />
                </Field>
                <Field
                  label="TLS/SSL Client Key"
                  description="To authenticate with a client TLS/SSL certificate, provide the key content here."
                >
                  <SecretTextArea
                    cols={60}
                    rows={7}
                    placeholder="-----BEGIN RSA PRIVATE KEY-----"
                    isConfigured={!!secureJsonFields?.tlsClientKey}
                    onChange={onUpdateDatasourceSecureJsonDataOption(props, 'tlsClientKey')}
                    onReset={() => updateDatasourcePluginResetOption(props, 'tlsClientKey')}
                  />
                </Field>
              </>
            )}
          </ConfigSection>
        </>
      )}
      <Divider />

      <ConfigSection title="Additional settings" isCollapsible isInitiallyOpen={false}>
        <ConfigSubSection title="CrateDB options">
          <Field
            label="Min time interval"
            description="Lower bound for the auto $__interval, e.g. 1m — set it to your data's write frequency."
          >
            <Input
              id="timeInterval"
              name="timeInterval"
              width={40}
              value={jsonData.timeInterval ?? ''}
              placeholder="1m"
              onChange={onUpdateDatasourceJsonDataOption(props, 'timeInterval')}
            />
          </Field>
          <Field
            label="Row limit"
            description="Max rows read back per query; doesn't limit query cost server-side. Empty uses Grafana's dataproxy.row_limit."
          >
            <Input
              id="rowLimit"
              name="rowLimit"
              width={40}
              type="number"
              value={jsonData.rowLimit ?? ''}
              placeholder="dataproxy.row_limit"
              onChange={onNumberOption('rowLimit')}
            />
          </Field>
          <Field
            label="Autocomplete cache TTL (seconds)"
            description="How long schema/table/column lists for editor autocomplete are cached."
          >
            <Input
              id="schemaCacheTTLSeconds"
              name="schemaCacheTTLSeconds"
              width={40}
              type="number"
              value={jsonData.schemaCacheTTLSeconds ?? ''}
              placeholder="60"
              disabled={jsonData.disableSchemaCache ?? false}
              onChange={onNumberOption('schemaCacheTTLSeconds')}
            />
          </Field>
          <Field
            label="Disable autocomplete cache"
            description="Query information_schema on every completion popup instead."
          >
            <InlineSwitch
              id="disableSchemaCache"
              value={jsonData.disableSchemaCache ?? false}
              onChange={(e) =>
                onOptionsChange({
                  ...options,
                  jsonData: { ...jsonData, disableSchemaCache: e.currentTarget.checked },
                })
              }
            />
          </Field>
        </ConfigSubSection>

        <ConfigSubSection title="Connection limits">
          <Field
            label="Max open"
            description="Maximum open connections to the database (0 = unlimited)."
          >
            <Input
              id="maxOpenConnections"
              name="maxOpenConnections"
              width={40}
              type="number"
              value={jsonData.maxOpenConnections ?? ''}
              placeholder="unlimited"
              onChange={onNumberOption('maxOpenConnections')}
            />
          </Field>
          <Field label="Max idle" description="The maximum number of connections in the idle connection pool.">
            <Input
              id="maxIdleConnections"
              name="maxIdleConnections"
              width={40}
              type="number"
              value={jsonData.maxIdleConnections ?? ''}
              placeholder="2"
              onChange={onNumberOption('maxIdleConnections')}
            />
          </Field>
          <Field
            label="Max lifetime"
            description="Seconds a connection may be reused before it's recycled (0 = forever)."
          >
            <Input
              id="maxConnectionLifetime"
              name="maxConnectionLifetime"
              width={40}
              type="number"
              value={jsonData.maxConnectionLifetime ?? ''}
              placeholder="unlimited"
              onChange={onNumberOption('maxConnectionLifetime')}
            />
          </Field>
          <Field label="Connect timeout (seconds)">
            <Input
              id="timeout"
              name="timeout"
              width={40}
              type="number"
              value={jsonData.timeout ?? ''}
              placeholder="none"
              onChange={onNumberOption('timeout')}
            />
          </Field>
          <Field label="Query timeout (seconds)">
            <Input
              id="queryTimeout"
              name="queryTimeout"
              width={40}
              type="number"
              value={jsonData.queryTimeout ?? ''}
              placeholder="60"
              onChange={onNumberOption('queryTimeout')}
            />
          </Field>
        </ConfigSubSection>

        {config.secureSocksDSProxyEnabled && (
          <ConfigSubSection title="Proxy">
            <Field
              label="Secure Socks Proxy"
              description="Route the connection through the Grafana secure socks proxy."
            >
              <InlineSwitch
                id="enableSecureSocksProxy"
                value={jsonData.enableSecureSocksProxy ?? false}
                onChange={(e) =>
                  onOptionsChange({
                    ...options,
                    jsonData: { ...jsonData, enableSecureSocksProxy: e.currentTarget.checked },
                  })
                }
              />
            </Field>
          </ConfigSubSection>
        )}
      </ConfigSection>
    </>
  );
}
