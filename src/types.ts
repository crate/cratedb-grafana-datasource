import { DataSourceJsonData } from '@grafana/data';
import type { DataQuery } from '@grafana/schema';

// numeric to match the backend's sqlutil.FormatQueryOption; Auto is a
// frontend-only sentinel, negative to stay clear of sqlutil's values
export enum QueryFormat {
  Auto = -1,
  Timeseries = 0,
  Table = 1,
  Logs = 2,
}

export interface CrateDBQuery extends DataQuery {
  rawSql: string;
  /** the resolved format the backend consumes */
  format: Exclude<QueryFormat, QueryFormat.Auto>;
  /**
   * the picker choice, which may be Auto; resolved into `format` at edit time so
   * dashboards and alerting always see a concrete value. Unset means `format` is explicit.
   */
  selectedFormat?: QueryFormat;
}

// dashboard Query-variable model; variable queries always run as tables, so no format field
export interface CrateDBVariableQuery extends DataQuery {
  rawSql: string;
}

export enum TLSMode {
  Disable = 'disable',
  Require = 'require',
  VerifyCA = 'verify-ca',
  VerifyFull = 'verify-full',
}

// how certificates reach the backend: encrypted PEM content in secureJsonData, or
// server-readable file paths. An unset method is treated as file-content.
export enum TLSConfigMethod {
  FileContent = 'file-content',
  FilePath = 'file-path',
}

export interface CrateDBOptions extends DataSourceJsonData {
  server?: string;
  port?: number;
  username?: string;
  defaultSchema?: string;
  tlsMode?: TLSMode;
  tlsConfigurationMethod?: TLSConfigMethod;
  /** server-side certificate paths, used when tlsConfigurationMethod is file-path */
  tlsCACertFile?: string;
  tlsClientCertFile?: string;
  tlsClientKeyFile?: string;
  timeout?: number;
  queryTimeout?: number;
  maxOpenConnections?: number;
  maxIdleConnections?: number;
  maxConnectionLifetime?: number;
  timeInterval?: string;
  enableSecureSocksProxy?: boolean;
  /** cap on rows read per query; 0 defers to Grafana's dataproxy.row_limit */
  rowLimit?: number;
  /** turns off the TTL cache in front of autocomplete introspection */
  disableSchemaCache?: boolean;
  /** lifetime of cached autocomplete results, in seconds (default 60) */
  schemaCacheTTLSeconds?: number;
}

export interface CrateDBSecureOptions {
  password?: string;
  tlsCACert?: string;
  tlsClientCert?: string;
  tlsClientKey?: string;
}
