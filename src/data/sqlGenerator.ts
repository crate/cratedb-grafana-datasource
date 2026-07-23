import {
  AggregateColumn,
  AggregateType,
  BuilderMode,
  BuilderOptions,
  ColumnHint,
  ColumnKind,
  Filter,
  FilterOperator,
  OrderBy,
  QueryFormat,
  SelectedColumn,
} from '../types';
import { escapeColumnRef, escapeIdentifier, quoteLiteral } from './escape';

// Builder state → CrateDB SQL. Macros ($__timeFilter, $__timeGroupAlias,
// $__interval) are emitted as literal text for the backend to expand; every
// identifier goes through escape.ts, so OBJECT['key'] subscripts survive and
// reserved words stay inert. The output shapes mirror the cheat-sheet templates
// in constants.ts.
//
// adapted from the ClickHouse datasource (Apache-2.0),
// https://github.com/grafana/clickhouse-datasource; see NOTICE

export const LOGS_DEFAULT_LIMIT = 1000;

// aliases the generator gives hinted columns; the names Grafana's panels expect
const HINT_ALIAS: Record<ColumnHint, string> = {
  [ColumnHint.Time]: 'time',
  [ColumnHint.LogMessage]: 'body',
  [ColumnHint.LogLevel]: 'level',
};

export function getColumnByHint(options: BuilderOptions, hint: ColumnHint): SelectedColumn | undefined {
  return options.columns.find((column) => column.hint === hint);
}

// prerequisites before any SQL is generated: a table always; the time-bound
// flavors additionally need their hinted columns. A non-runnable builder leaves
// rawSql empty, which filterQuery skips.
export function isRunnable(options: BuilderOptions): boolean {
  if (!options.table) {
    return false;
  }
  switch (options.flavor) {
    case QueryFormat.Timeseries:
      return getColumnByHint(options, ColumnHint.Time) !== undefined;
    case QueryFormat.Logs:
      return (
        getColumnByHint(options, ColumnHint.Time) !== undefined &&
        getColumnByHint(options, ColumnHint.LogMessage) !== undefined
      );
    default:
      return true;
  }
}

// fresh builder state for a flavor; the timeseries default (count(*) bucketed by
// $__interval) reproduces the recommended template once a table and time column
// are in place. The unbucketed flavors get a row cap so a bare SELECT can't
// stream a whole table into a panel.
export function defaultBuilderOptions(
  schema: string,
  flavor: Exclude<QueryFormat, QueryFormat.Auto> = QueryFormat.Timeseries
): BuilderOptions {
  const base: BuilderOptions = {
    schema,
    table: '',
    flavor,
    mode: BuilderMode.Simple,
    columns: [],
    aggregates: [],
    groupBy: [],
    filters: [],
    orderBy: [],
  };
  switch (flavor) {
    case QueryFormat.Timeseries:
      return {
        ...base,
        mode: BuilderMode.Aggregate,
        aggregates: [{ aggregateType: AggregateType.Count, column: '*', alias: 'value' }],
      };
    case QueryFormat.Logs:
      return { ...base, limit: LOGS_DEFAULT_LIMIT };
    default:
      return { ...base, limit: LOGS_DEFAULT_LIMIT };
  }
}

export function generateSql(options: BuilderOptions): string {
  if (!isRunnable(options)) {
    return '';
  }
  switch (options.flavor) {
    case QueryFormat.Timeseries:
      return generateTimeSeriesQuery(options);
    case QueryFormat.Logs:
      return generateLogsQuery(options);
    default:
      return generateTableQuery(options);
  }
}

// '*' is an argument only count accepts; a row still missing its column (or
// carrying '*' into another function) stays out of the SQL until completed
function isCompleteAggregate(aggregate: AggregateColumn): boolean {
  if (!aggregate.column) {
    return false;
  }
  return aggregate.column !== '*' || aggregate.aggregateType === AggregateType.Count;
}

function completeAggregates(options: BuilderOptions): AggregateColumn[] {
  return options.aggregates.filter(isCompleteAggregate);
}

// a column-less order-by row would emit `ORDER BY "" ...`; drop it until chosen
function orderByRefs(orderBy: OrderBy[]): string[] {
  return orderBy.filter((entry) => entry.column).map((entry) => `${escapeColumnRef(entry.column)} ${entry.dir}`);
}

function generateTableQuery(options: BuilderOptions): string {
  const aggregating = options.mode === BuilderMode.Aggregate;
  const select = aggregating
    ? [...options.groupBy.map(escapeColumnRef), ...completeAggregates(options).map(aggregateExpr)]
    : options.columns.map(columnExpr);
  return assemble({
    select: select.length > 0 ? select : ['*'],
    from: tableIdent(options),
    where: whereChain(options.filters),
    groupBy: aggregating ? options.groupBy.map(escapeColumnRef) : [],
    orderBy: orderByRefs(options.orderBy),
    limit: options.limit,
  });
}

function generateTimeSeriesQuery(options: BuilderOptions): string {
  const time = escapeColumnRef(getColumnByHint(options, ColumnHint.Time)!.column);
  const timeFilter = `$__timeFilter(${time})`;
  const userOrder = orderByRefs(options.orderBy);

  if (options.mode === BuilderMode.Aggregate) {
    const groupRefs = options.groupBy.map(escapeColumnRef);
    return assemble({
      select: [`$__timeGroupAlias(${time}, $__interval)`, ...groupRefs, ...completeAggregates(options).map(aggregateExpr)],
      from: tableIdent(options),
      where: prependCondition(timeFilter, whereChain(options.filters)),
      groupBy: ['1', ...groupRefs],
      orderBy: ['1', ...userOrder],
      limit: options.limit,
    });
  }
  return assemble({
    select: [
      `${time} AS "time"`,
      ...options.columns.filter((column) => column.hint !== ColumnHint.Time).map(columnExpr),
    ],
    from: tableIdent(options),
    where: prependCondition(timeFilter, whereChain(options.filters)),
    orderBy: [`${time} ASC`, ...userOrder],
    limit: options.limit,
  });
}

// per-level buckets for the logs-volume histogram, keyed by the field names
// Grafana's severity coloring recognizes; each bucket absorbs the lowercased
// level spellings on the right
const LOG_LEVEL_BUCKETS: Array<[string, string[]]> = [
  ['critical', ['critical', 'crit', 'fatal', 'emerg', 'alert']],
  ['error', ['error', 'err']],
  ['warn', ['warn', 'warning']],
  ['info', ['info', 'information', 'notice']],
  ['debug', ['debug', 'dbug']],
  ['trace', ['trace']],
];

// the LogsVolume supplementary query for a logs builder state: log counts per
// $__interval bucket over the full dashboard range, split by severity when a
// level column is assigned. Same table and filters as the logs query itself.
export function generateLogVolumeSql(options: BuilderOptions): string {
  if (options.flavor !== QueryFormat.Logs || !isRunnable(options)) {
    return '';
  }
  const time = escapeColumnRef(getColumnByHint(options, ColumnHint.Time)!.column);
  const level = getColumnByHint(options, ColumnHint.LogLevel);

  const select = [`$__timeGroupAlias(${time}, $__interval)`];
  if (level) {
    // CAST tolerates non-text level columns; NULL and unrecognized spellings
    // land in "unknown"
    const normalized = `lower(CAST(${escapeColumnRef(level.column)} AS TEXT))`;
    const bucketExpr = (values: string[]) => `${normalized} IN (${values.map(quoteLiteral).join(', ')})`;
    for (const [bucket, values] of LOG_LEVEL_BUCKETS) {
      select.push(`sum(CASE WHEN ${bucketExpr(values)} THEN 1 ELSE 0 END) AS ${escapeIdentifier(bucket)}`);
    }
    const known = LOG_LEVEL_BUCKETS.flatMap(([, values]) => values);
    select.push(`sum(CASE WHEN ${bucketExpr(known)} THEN 0 ELSE 1 END) AS "unknown"`);
  } else {
    select.push(`count(*) AS "logs"`);
  }

  return assemble({
    select,
    from: tableIdent(options),
    where: prependCondition(`$__timeFilter(${time})`, whereChain(options.filters)),
    groupBy: ['1'],
    orderBy: ['1'],
  });
}

function generateLogsQuery(options: BuilderOptions): string {
  const time = escapeColumnRef(getColumnByHint(options, ColumnHint.Time)!.column);
  const hinted = [ColumnHint.Time, ColumnHint.LogMessage, ColumnHint.LogLevel]
    .map((hint) => getColumnByHint(options, hint))
    .filter((column): column is SelectedColumn => column !== undefined)
    .map(columnExpr);
  return assemble({
    select: [...hinted, ...options.columns.filter((column) => !column.hint).map(columnExpr)],
    from: tableIdent(options),
    where: prependCondition(`$__timeFilter(${time})`, whereChain(options.filters)),
    orderBy: [`${time} DESC`],
    limit: options.limit ?? LOGS_DEFAULT_LIMIT,
  });
}

function tableIdent(options: BuilderOptions): string {
  return `${escapeIdentifier(options.schema)}.${escapeIdentifier(options.table)}`;
}

function columnExpr(column: SelectedColumn): string {
  const ref = escapeColumnRef(column.column);
  const alias = column.hint ? HINT_ALIAS[column.hint] : column.alias;
  return alias ? `${ref} AS ${escapeIdentifier(alias)}` : ref;
}

function aggregateExpr(aggregate: AggregateColumn): string {
  const arg = aggregate.column === '*' ? '*' : escapeColumnRef(aggregate.column);
  const call =
    aggregate.aggregateType === AggregateType.CountDistinct
      ? `count(DISTINCT ${arg})`
      : `${aggregate.aggregateType}(${arg})`;
  return aggregate.alias ? `${call} AS ${escapeIdentifier(aggregate.alias)}` : call;
}

// the filters joined by their per-row AND/OR conditions; rows without the value
// their operator needs are skipped, so a half-filled filter never breaks the SQL
function whereChain(filters: Filter[]): { clause: string; hasOr: boolean } {
  const parts: string[] = [];
  let hasOr = false;
  for (const filter of filters) {
    const expr = filterExpr(filter);
    if (expr === null) {
      continue;
    }
    if (parts.length > 0) {
      parts.push(filter.condition, expr);
      hasOr = hasOr || filter.condition === 'OR';
    } else {
      parts.push(expr);
    }
  }
  return { clause: parts.join(' '), hasOr };
}

// a chain containing OR is parenthesized before ANDing it to the time filter,
// preserving the row-by-row reading of the filter list
function prependCondition(first: string, chain: { clause: string; hasOr: boolean }): { clause: string; hasOr: boolean } {
  if (!chain.clause) {
    return { clause: first, hasOr: false };
  }
  return { clause: `${first} AND ${chain.hasOr ? `(${chain.clause})` : chain.clause}`, hasOr: false };
}

function filterExpr(filter: Filter): string | null {
  if (!filter.column) {
    return null;
  }
  const ref = escapeColumnRef(filter.column);
  switch (filter.operator) {
    case FilterOperator.IsNull:
    case FilterOperator.IsNotNull:
      return `${ref} ${filter.operator}`;
    case FilterOperator.WithinTimeRange:
      return `$__timeFilter(${ref})`;
    case FilterOperator.In:
    case FilterOperator.NotIn: {
      const values = Array.isArray(filter.value) ? filter.value : filter.value ? [filter.value] : [];
      if (values.length === 0) {
        return null;
      }
      return `${ref} ${filter.operator} (${values.map((value) => filterValue(value, filter.type)).join(', ')})`;
    }
    default: {
      if (filter.value === undefined || filter.value === '' || Array.isArray(filter.value)) {
        return null;
      }
      return `${ref} ${filter.operator} ${filterValue(filter.value, filter.type)}`;
    }
  }
}

// values are string literals by default (CrateDB casts to the column type, so
// numeric-looking text stays text — the ad-hoc filter convention). Clean numeric
// and boolean values for typed columns stay raw, and $-prefixed values pass
// through untouched so template variables and macros keep working. Builder input
// carries panel-editor trust, the same as raw SQL.
function filterValue(value: string, kind?: ColumnKind): string {
  if (/^\$[{_a-zA-Z]/.test(value)) {
    return value;
  }
  if (kind === 'number' && /^-?\d+(\.\d+)?$/.test(value)) {
    return value;
  }
  if (kind === 'boolean' && /^(true|false)$/i.test(value)) {
    return value.toLowerCase();
  }
  return quoteLiteral(value);
}

interface QueryParts {
  select: string[];
  from: string;
  where?: { clause: string; hasOr: boolean };
  groupBy?: string[];
  orderBy?: string[];
  limit?: number;
}

// multi-line layout matching the cheat-sheet templates: one projection per
// indented line, one clause per line
function assemble(parts: QueryParts): string {
  const lines = [`SELECT\n  ${parts.select.join(',\n  ')}`, `FROM ${parts.from}`];
  if (parts.where?.clause) {
    lines.push(`WHERE ${parts.where.clause}`);
  }
  if (parts.groupBy && parts.groupBy.length > 0) {
    lines.push(`GROUP BY ${dedupe(parts.groupBy).join(', ')}`);
  }
  if (parts.orderBy && parts.orderBy.length > 0) {
    lines.push(`ORDER BY ${dedupe(parts.orderBy).join(', ')}`);
  }
  if (parts.limit !== undefined && parts.limit > 0) {
    lines.push(`LIMIT ${Math.floor(parts.limit)}`);
  }
  return lines.join('\n');
}

function dedupe(entries: string[]): string[] {
  return [...new Set(entries)];
}
