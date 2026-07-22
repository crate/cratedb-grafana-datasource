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

// how a target is edited: raw SQL in Monaco, or the visual builder. Unset means
// SQL — targets saved before the builder existed carry no editorType.
export enum EditorType {
  SQL = 'sql',
  Builder = 'builder',
}

// ---- visual-builder query model -------------------------------------------
// adapted from the ClickHouse datasource (Apache-2.0),
// https://github.com/grafana/clickhouse-datasource; see NOTICE

export enum BuilderMode {
  Simple = 'simple',
  Aggregate = 'aggregate',
}

// semantic column roles; the generator aliases hinted columns to the names
// Grafana's panels expect (time / body / level)
export enum ColumnHint {
  Time = 'time',
  LogMessage = 'log_message',
  LogLevel = 'log_level',
}

export interface SelectedColumn {
  column: string;
  alias?: string;
  hint?: ColumnHint;
}

export enum AggregateType {
  Count = 'count',
  CountDistinct = 'count_distinct',
  Sum = 'sum',
  Avg = 'avg',
  Min = 'min',
  Max = 'max',
}

export interface AggregateColumn {
  aggregateType: AggregateType;
  /** '*' stands for count(*) */
  column: string;
  alias?: string;
}

export enum FilterOperator {
  Equals = '=',
  NotEquals = '!=',
  LessThan = '<',
  LessThanOrEqual = '<=',
  GreaterThan = '>',
  GreaterThanOrEqual = '>=',
  Like = 'LIKE',
  NotLike = 'NOT LIKE',
  ILike = 'ILIKE',
  NotILike = 'NOT ILIKE',
  In = 'IN',
  NotIn = 'NOT IN',
  IsNull = 'IS NULL',
  IsNotNull = 'IS NOT NULL',
  /** emits $__timeFilter(column) */
  WithinTimeRange = 'WITHIN DASHBOARD TIME RANGE',
}

// value-editor category a CrateDB data type maps onto; 'other' (OBJECT, geo,
// arrays) is excluded from filter and aggregate pickers
export type ColumnKind = 'time' | 'number' | 'string' | 'boolean' | 'other';

/** column name + CrateDB data type, as served by the column-meta resource */
export interface ColumnMeta {
  name: string;
  type: string;
}

export interface Filter {
  column: string;
  operator: FilterOperator;
  /** string[] for In/NotIn; unset for the valueless operators */
  value?: string | string[];
  /** joiner with the preceding filter; ignored on the first filter */
  condition: 'AND' | 'OR';
  /** drives the value editor; derived from column metadata */
  type?: ColumnKind;
}

export interface OrderBy {
  column: string;
  dir: 'ASC' | 'DESC';
}

export interface BuilderOptions {
  schema: string;
  table: string;
  /** maps 1:1 onto the format the backend consumes */
  flavor: Exclude<QueryFormat, QueryFormat.Auto>;
  /** Table and Timeseries flavors only; Logs ignores it */
  mode: BuilderMode;
  /** hinted time/body/level columns live here alongside plain selections */
  columns: SelectedColumn[];
  aggregates: AggregateColumn[];
  groupBy: string[];
  filters: Filter[];
  orderBy: OrderBy[];
  limit?: number;
}

// ---------------------------------------------------------------------------

interface CrateDBQueryBase extends DataQuery {
  rawSql: string;
  /** the resolved format the backend consumes */
  format: Exclude<QueryFormat, QueryFormat.Auto>;
  /**
   * the picker choice, which may be Auto; resolved into `format` at edit time so
   * dashboards and alerting always see a concrete value. Unset means `format` is explicit.
   */
  selectedFormat?: QueryFormat;
}

export interface CrateDBSqlQuery extends CrateDBQueryBase {
  editorType?: EditorType.SQL;
  /** builder state stashed on switch to SQL, restored on switch back */
  meta?: { builderOptions?: BuilderOptions };
}

export interface CrateDBBuilderQuery extends CrateDBQueryBase {
  editorType: EditorType.Builder;
  builderOptions: BuilderOptions;
}

// the backend only ever consumes rawSql + format; builderOptions is frontend state
// from which rawSql is regenerated on every builder edit
export type CrateDBQuery = CrateDBSqlQuery | CrateDBBuilderQuery;

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
