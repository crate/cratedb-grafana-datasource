import { DataSourceJsonData } from '@grafana/data';
import type { DataQuery } from '@grafana/schema';

/**
 * Query format, encoded numerically to match the backend's
 * sqlutil.FormatQueryOption (0 = time series, 1 = table).
 */
export enum QueryFormat {
  Timeseries = 0,
  Table = 1,
}

export interface CrateDBQuery extends DataQuery {
  rawSql: string;
  format: QueryFormat;
}

export enum TLSMode {
  Disable = 'disable',
  Require = 'require',
  VerifyCA = 'verify-ca',
  VerifyFull = 'verify-full',
}

export interface CrateDBOptions extends DataSourceJsonData {
  server?: string;
  port?: number;
  username?: string;
  defaultSchema?: string;
  tlsMode?: TLSMode;
  tlsConfigurationMethod?: string;
  timeout?: number;
  queryTimeout?: number;
  maxOpenConnections?: number;
  maxIdleConnections?: number;
  maxConnectionLifetime?: number;
  timeInterval?: string;
  enableSecureSocksProxy?: boolean;
}

export interface CrateDBSecureOptions {
  password?: string;
  tlsCACert?: string;
  tlsClientCert?: string;
  tlsClientKey?: string;
}
