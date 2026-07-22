import {
  AggregateType,
  BuilderMode,
  BuilderOptions,
  ColumnHint,
  Filter,
  FilterOperator,
  QueryFormat,
} from '../types';
import { defaultBuilderOptions, generateSql, isRunnable, LOGS_DEFAULT_LIMIT } from './sqlGenerator';

function tableOptions(overrides: Partial<BuilderOptions> = {}): BuilderOptions {
  return {
    schema: 'doc',
    table: 'demo_metrics',
    flavor: QueryFormat.Table,
    mode: BuilderMode.Simple,
    columns: [],
    aggregates: [],
    groupBy: [],
    filters: [],
    orderBy: [],
    ...overrides,
  };
}

function timeseriesOptions(overrides: Partial<BuilderOptions> = {}): BuilderOptions {
  return tableOptions({
    flavor: QueryFormat.Timeseries,
    mode: BuilderMode.Aggregate,
    columns: [{ column: 'ts', hint: ColumnHint.Time }],
    aggregates: [{ aggregateType: AggregateType.Count, column: '*', alias: 'value' }],
    ...overrides,
  });
}

function logsOptions(overrides: Partial<BuilderOptions> = {}): BuilderOptions {
  return tableOptions({
    flavor: QueryFormat.Logs,
    columns: [
      { column: 'ts', hint: ColumnHint.Time },
      { column: 'message', hint: ColumnHint.LogMessage },
      { column: 'level', hint: ColumnHint.LogLevel },
    ],
    table: 'demo_logs',
    ...overrides,
  });
}

describe('isRunnable', () => {
  it('requires a table for every flavor', () => {
    expect(isRunnable(tableOptions({ table: '' }))).toBe(false);
    expect(isRunnable(tableOptions())).toBe(true);
  });

  it('requires a time column for time series', () => {
    expect(isRunnable(timeseriesOptions({ columns: [] }))).toBe(false);
    expect(isRunnable(timeseriesOptions())).toBe(true);
  });

  it('requires time and message columns for logs', () => {
    expect(isRunnable(logsOptions({ columns: [{ column: 'ts', hint: ColumnHint.Time }] }))).toBe(false);
    expect(isRunnable(logsOptions())).toBe(true);
  });
});

describe('generateSql', () => {
  it('returns empty SQL when not runnable, so filterQuery skips the target', () => {
    expect(generateSql(tableOptions({ table: '' }))).toBe('');
    expect(generateSql(timeseriesOptions({ columns: [] }))).toBe('');
  });

  it('selects * when no table columns are chosen', () => {
    expect(generateSql(tableOptions())).toBe('SELECT\n  *\nFROM "doc"."demo_metrics"');
  });

  it('builds a plain table query with columns, order and limit', () => {
    const sql = generateSql(
      tableOptions({
        columns: [{ column: 'host' }, { column: 'value', alias: 'v' }],
        orderBy: [{ column: 'host', dir: 'DESC' }],
        limit: 50,
      })
    );
    expect(sql).toBe(
      'SELECT\n  "host",\n  "value" AS "v"\nFROM "doc"."demo_metrics"\nORDER BY "host" DESC\nLIMIT 50'
    );
  });

  it('interleaves group-by columns and aggregates in aggregate mode', () => {
    const sql = generateSql(
      tableOptions({
        mode: BuilderMode.Aggregate,
        aggregates: [
          { aggregateType: AggregateType.Avg, column: 'value' },
          { aggregateType: AggregateType.CountDistinct, column: 'host', alias: 'hosts' },
        ],
        groupBy: ['region'],
      })
    );
    expect(sql).toBe(
      'SELECT\n  "region",\n  avg("value"),\n  count(DISTINCT "host") AS "hosts"\nFROM "doc"."demo_metrics"\nGROUP BY "region"'
    );
  });

  it('reproduces the recommended time-series template shape', () => {
    expect(generateSql(timeseriesOptions())).toBe(
      'SELECT\n' +
        '  $__timeGroupAlias("ts", $__interval),\n' +
        '  count(*) AS "value"\n' +
        'FROM "doc"."demo_metrics"\n' +
        'WHERE $__timeFilter("ts")\n' +
        'GROUP BY 1\n' +
        'ORDER BY 1'
    );
  });

  it('adds group-by columns to the projection and both trailing clauses', () => {
    const sql = generateSql(timeseriesOptions({ groupBy: ['host'] }));
    expect(sql).toBe(
      'SELECT\n' +
        '  $__timeGroupAlias("ts", $__interval),\n' +
        '  "host",\n' +
        '  count(*) AS "value"\n' +
        'FROM "doc"."demo_metrics"\n' +
        'WHERE $__timeFilter("ts")\n' +
        'GROUP BY 1, "host"\n' +
        'ORDER BY 1'
    );
  });

  it('builds a raw time series in simple mode, time first and ascending', () => {
    const sql = generateSql(
      timeseriesOptions({
        mode: BuilderMode.Simple,
        columns: [{ column: 'ts', hint: ColumnHint.Time }, { column: 'value' }],
        aggregates: [],
      })
    );
    expect(sql).toBe(
      'SELECT\n' +
        '  "ts" AS "time",\n' +
        '  "value"\n' +
        'FROM "doc"."demo_metrics"\n' +
        'WHERE $__timeFilter("ts")\n' +
        'ORDER BY "ts" ASC'
    );
  });

  it('aliases logs columns to the names the logs panel expects', () => {
    expect(generateSql(logsOptions())).toBe(
      'SELECT\n' +
        '  "ts" AS "time",\n' +
        '  "message" AS "body",\n' +
        '  "level" AS "level"\n' +
        'FROM "doc"."demo_logs"\n' +
        'WHERE $__timeFilter("ts")\n' +
        'ORDER BY "ts" DESC\n' +
        `LIMIT ${LOGS_DEFAULT_LIMIT}`
    );
  });

  it('keeps extra unhinted log columns after the hinted ones', () => {
    const sql = generateSql(
      logsOptions({
        columns: [
          { column: 'ts', hint: ColumnHint.Time },
          { column: 'message', hint: ColumnHint.LogMessage },
          { column: 'host' },
        ],
        limit: 200,
      })
    );
    expect(sql).toBe(
      'SELECT\n' +
        '  "ts" AS "time",\n' +
        '  "message" AS "body",\n' +
        '  "host"\n' +
        'FROM "doc"."demo_logs"\n' +
        'WHERE $__timeFilter("ts")\n' +
        'ORDER BY "ts" DESC\n' +
        'LIMIT 200'
    );
  });

  it('doubles embedded quotes in identifiers and keeps OBJECT subscripts outside them', () => {
    const sql = generateSql(
      tableOptions({
        schema: 'we"ird',
        columns: [{ column: `payload['user']` }],
      })
    );
    expect(sql).toBe(`SELECT\n  "payload"['user']\nFROM "we""ird"."demo_metrics"`);
  });
});

describe('generateSql filters', () => {
  function filtered(filters: Filter[], overrides: Partial<BuilderOptions> = {}): string {
    return generateSql(tableOptions({ filters, ...overrides }));
  }

  it.each<[FilterOperator, string | string[] | undefined, string]>([
    [FilterOperator.Equals, 'web-1', `"host" = 'web-1'`],
    [FilterOperator.NotEquals, 'web-1', `"host" != 'web-1'`],
    [FilterOperator.LessThan, 'web-1', `"host" < 'web-1'`],
    [FilterOperator.LessThanOrEqual, 'web-1', `"host" <= 'web-1'`],
    [FilterOperator.GreaterThan, 'web-1', `"host" > 'web-1'`],
    [FilterOperator.GreaterThanOrEqual, 'web-1', `"host" >= 'web-1'`],
    [FilterOperator.Like, 'web-%', `"host" LIKE 'web-%'`],
    [FilterOperator.NotLike, 'web-%', `"host" NOT LIKE 'web-%'`],
    [FilterOperator.ILike, 'WEB-%', `"host" ILIKE 'WEB-%'`],
    [FilterOperator.NotILike, 'WEB-%', `"host" NOT ILIKE 'WEB-%'`],
    [FilterOperator.In, ['a', 'b'], `"host" IN ('a', 'b')`],
    [FilterOperator.NotIn, ['a', 'b'], `"host" NOT IN ('a', 'b')`],
    [FilterOperator.IsNull, undefined, `"host" IS NULL`],
    [FilterOperator.IsNotNull, undefined, `"host" IS NOT NULL`],
    [FilterOperator.WithinTimeRange, undefined, `$__timeFilter("host")`],
  ])('%s', (operator, value, expected) => {
    expect(filtered([{ column: 'host', operator, value, condition: 'AND' }])).toBe(
      `SELECT\n  *\nFROM "doc"."demo_metrics"\nWHERE ${expected}`
    );
  });

  it('joins rows with their own AND/OR conditions', () => {
    const sql = filtered([
      { column: 'host', operator: FilterOperator.Equals, value: 'a', condition: 'AND' },
      { column: 'host', operator: FilterOperator.Equals, value: 'b', condition: 'OR' },
      { column: 'region', operator: FilterOperator.IsNotNull, condition: 'AND' },
    ]);
    expect(sql).toContain(`WHERE "host" = 'a' OR "host" = 'b' AND "region" IS NOT NULL`);
  });

  it('skips rows whose operator still lacks a value', () => {
    const sql = filtered([
      { column: 'host', operator: FilterOperator.Equals, value: '', condition: 'AND' },
      { column: '', operator: FilterOperator.Equals, value: 'x', condition: 'AND' },
      { column: 'host', operator: FilterOperator.In, value: [], condition: 'AND' },
      { column: 'region', operator: FilterOperator.Equals, value: 'eu', condition: 'AND' },
    ]);
    expect(sql).toBe(`SELECT\n  *\nFROM "doc"."demo_metrics"\nWHERE "region" = 'eu'`);
  });

  it('quotes values as string literals so CrateDB casts to the column type', () => {
    expect(filtered([{ column: 'mode', operator: FilterOperator.Equals, value: '0755', condition: 'AND' }])).toContain(
      `"mode" = '0755'`
    );
  });

  it('keeps clean typed values raw for number and boolean columns', () => {
    const sql = filtered([
      { column: 'value', operator: FilterOperator.GreaterThan, value: '1.5', condition: 'AND', type: 'number' },
      { column: 'active', operator: FilterOperator.Equals, value: 'TRUE', condition: 'AND', type: 'boolean' },
      { column: 'value', operator: FilterOperator.Equals, value: 'not-a-number', condition: 'AND', type: 'number' },
    ]);
    expect(sql).toContain(`WHERE "value" > 1.5 AND "active" = true AND "value" = 'not-a-number'`);
  });

  it('passes template variables and macros through unquoted', () => {
    const sql = filtered([
      { column: 'host', operator: FilterOperator.Equals, value: '$host', condition: 'AND' },
      { column: 'region', operator: FilterOperator.In, value: ['${regions:sqlstring}'], condition: 'AND' },
    ]);
    expect(sql).toContain(`WHERE "host" = $host AND "region" IN (\${regions:sqlstring})`);
  });

  it('escapes embedded single quotes in values', () => {
    expect(filtered([{ column: 'name', operator: FilterOperator.Equals, value: "O'Brien", condition: 'AND' }])).toContain(
      `"name" = 'O''Brien'`
    );
  });

  it('ANDs the filter chain after the time filter, parenthesized when it contains OR', () => {
    const orChain: Filter[] = [
      { column: 'host', operator: FilterOperator.Equals, value: 'a', condition: 'AND' },
      { column: 'host', operator: FilterOperator.Equals, value: 'b', condition: 'OR' },
    ];
    expect(generateSql(timeseriesOptions({ filters: orChain }))).toContain(
      `WHERE $__timeFilter("ts") AND ("host" = 'a' OR "host" = 'b')`
    );
    expect(generateSql(timeseriesOptions({ filters: [orChain[0]] }))).toContain(
      `WHERE $__timeFilter("ts") AND "host" = 'a'`
    );
  });
});

describe('defaultBuilderOptions', () => {
  it('seeds the time-series default with the recommended count(*) aggregation', () => {
    const options = defaultBuilderOptions('doc');
    expect(options.flavor).toBe(QueryFormat.Timeseries);
    expect(options.mode).toBe(BuilderMode.Aggregate);
    expect(options.aggregates).toEqual([{ aggregateType: AggregateType.Count, column: '*', alias: 'value' }]);
    expect(options.table).toBe('');
    expect(generateSql(options)).toBe('');
  });

  it('caps the unbucketed flavors by default', () => {
    expect(defaultBuilderOptions('doc', QueryFormat.Table).limit).toBe(LOGS_DEFAULT_LIMIT);
    expect(defaultBuilderOptions('doc', QueryFormat.Logs).limit).toBe(LOGS_DEFAULT_LIMIT);
    expect(defaultBuilderOptions('doc', QueryFormat.Timeseries).limit).toBeUndefined();
  });
});
