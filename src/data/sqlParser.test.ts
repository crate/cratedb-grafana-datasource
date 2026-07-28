import {
  AggregateType,
  BuilderMode,
  BuilderOptions,
  ColumnHint,
  FilterOperator,
  QueryFormat,
} from '../types';
import { LOGS_QUERY_TEMPLATE, TIMESERIES_QUERY_TEMPLATE } from '../constants';
import { defaultBuilderOptions, generateSql } from './sqlGenerator';
import { parseSqlToBuilderOptions } from './sqlParser';

const parse = (sql: string) => parseSqlToBuilderOptions(sql, 'doc');

describe('parseSqlToBuilderOptions round-trips generator output', () => {
  const matrix: Array<[string, BuilderOptions]> = [
    [
      'bare table',
      {
        schema: 'doc',
        table: 'demo_metrics',
        flavor: QueryFormat.Table,
        mode: BuilderMode.Simple,
        columns: [],
        aggregates: [],
        groupBy: [],
        filters: [],
        orderBy: [],
      },
    ],
    [
      'table with columns, filters, order, limit',
      {
        schema: 'doc',
        table: 'demo_metrics',
        flavor: QueryFormat.Table,
        mode: BuilderMode.Simple,
        columns: [{ column: 'host', alias: 'h' }, { column: `payload['user']` }],
        aggregates: [],
        groupBy: [],
        filters: [
          { column: 'region', operator: FilterOperator.Equals, value: 'eu', condition: 'AND' },
          { column: 'host', operator: FilterOperator.In, value: ['a', 'b'], condition: 'AND' },
          { column: 'note', operator: FilterOperator.IsNull, condition: 'OR' },
        ],
        orderBy: [{ column: 'host', dir: 'DESC' }],
        limit: 50,
      },
    ],
    [
      'aggregated table',
      {
        schema: 'doc',
        table: 'demo_metrics',
        flavor: QueryFormat.Table,
        mode: BuilderMode.Aggregate,
        columns: [],
        aggregates: [
          { aggregateType: AggregateType.Avg, column: 'value' },
          { aggregateType: AggregateType.CountDistinct, column: 'host', alias: 'hosts' },
        ],
        groupBy: ['region'],
        filters: [{ column: 'value', operator: FilterOperator.GreaterThan, value: '1.5', condition: 'AND', type: 'number' }],
        orderBy: [],
      },
    ],
    [
      'bucketed time series with grouping',
      {
        schema: 'doc',
        table: 'demo_metrics',
        flavor: QueryFormat.Timeseries,
        mode: BuilderMode.Aggregate,
        columns: [{ column: 'ts', hint: ColumnHint.Time }],
        aggregates: [{ aggregateType: AggregateType.Count, column: '*', alias: 'value' }],
        groupBy: ['host'],
        filters: [
          { column: 'host', operator: FilterOperator.Equals, value: 'a', condition: 'AND' },
          { column: 'host', operator: FilterOperator.Equals, value: 'b', condition: 'OR' },
        ],
        orderBy: [],
      },
    ],
    [
      'simple time series',
      {
        schema: 'doc',
        table: 'demo_metrics',
        flavor: QueryFormat.Timeseries,
        mode: BuilderMode.Simple,
        columns: [{ column: 'ts', hint: ColumnHint.Time }, { column: 'value' }],
        aggregates: [],
        groupBy: [],
        filters: [{ column: 'active', operator: FilterOperator.Equals, value: 'true', condition: 'AND', type: 'boolean' }],
        orderBy: [],
        limit: 500,
      },
    ],
    [
      'logs with extra column',
      {
        schema: 'doc',
        table: 'demo_logs',
        flavor: QueryFormat.Logs,
        mode: BuilderMode.Simple,
        columns: [
          { column: 'ts', hint: ColumnHint.Time },
          { column: 'message', hint: ColumnHint.LogMessage },
          { column: 'level', hint: ColumnHint.LogLevel },
          { column: 'host' },
        ],
        aggregates: [],
        groupBy: [],
        filters: [{ column: 'level', operator: FilterOperator.NotEquals, value: 'debug', condition: 'AND' }],
        orderBy: [],
        limit: 1000,
      },
    ],
  ];

  it.each(matrix)('%s', (_name, options) => {
    expect(parse(generateSql(options))).toEqual(options);
  });

  it('round-trips filter values that are template variables', () => {
    const options: BuilderOptions = {
      ...defaultBuilderOptions('doc', QueryFormat.Table),
      table: 'demo_metrics',
      filters: [
        { column: 'host', operator: FilterOperator.Equals, value: '$host', condition: 'AND' },
        { column: 'region', operator: FilterOperator.In, value: ['${regions:sqlstring}'], condition: 'AND' },
      ],
    };
    expect(parse(generateSql(options))).toEqual(options);
  });
});

describe('parseSqlToBuilderOptions on hand-written SQL', () => {
  it('reads the recommended time-series template', () => {
    expect(parse(TIMESERIES_QUERY_TEMPLATE)).toEqual({
      schema: 'doc',
      table: 'demo_metrics',
      flavor: QueryFormat.Timeseries,
      mode: BuilderMode.Aggregate,
      columns: [{ column: 'ts', hint: ColumnHint.Time }],
      aggregates: [{ aggregateType: AggregateType.Count, column: '*', alias: 'value' }],
      groupBy: [],
      filters: [],
      orderBy: [],
    });
  });

  it('reads the logs template', () => {
    // the template selects "level" bare; the builder aliases it, which is the
    // same projection — so the conversion is faithful only via the alias form
    const aliased = LOGS_QUERY_TEMPLATE.replace('"level"', '"level" AS "level"');
    expect(parse(aliased)).toEqual({
      schema: 'doc',
      table: 'demo_logs',
      flavor: QueryFormat.Logs,
      mode: BuilderMode.Simple,
      columns: [
        { column: 'ts', hint: ColumnHint.Time },
        { column: 'message', hint: ColumnHint.LogMessage },
        { column: 'level', hint: ColumnHint.LogLevel },
      ],
      aggregates: [],
      groupBy: [],
      filters: [],
      orderBy: [],
      limit: 1000,
    });
  });

  it('tolerates keyword case, whitespace and unquoted identifiers', () => {
    const options = parse(`select host, value from demo_metrics where region = 'eu' order by host limit 10`);
    expect(options).toEqual({
      schema: 'doc',
      table: 'demo_metrics',
      flavor: QueryFormat.Table,
      mode: BuilderMode.Simple,
      columns: [{ column: 'host' }, { column: 'value' }],
      aggregates: [],
      groupBy: [],
      filters: [{ column: 'region', operator: FilterOperator.Equals, value: 'eu', condition: 'AND' }],
      orderBy: [{ column: 'host', dir: 'ASC' }],
      limit: 10,
    });
  });

  it('resolves an unqualified table against the default schema', () => {
    expect(parse('SELECT * FROM demo_metrics')?.schema).toBe('doc');
    expect(parseSqlToBuilderOptions('SELECT * FROM demo_metrics', 'sys')?.schema).toBe('sys');
  });

  it('normalizes <> to !=', () => {
    expect(parse(`SELECT * FROM t WHERE a <> 'x'`)?.filters).toEqual([
      { column: 'a', operator: FilterOperator.NotEquals, value: 'x', condition: 'AND' },
    ]);
  });

  it('maps a grouped aggregate query into aggregate mode', () => {
    expect(parse('SELECT region, count(*) FROM demo_metrics GROUP BY region')).toEqual({
      schema: 'doc',
      table: 'demo_metrics',
      flavor: QueryFormat.Table,
      mode: BuilderMode.Aggregate,
      columns: [],
      aggregates: [{ aggregateType: AggregateType.Count, column: '*', alias: undefined }],
      groupBy: ['region'],
      filters: [],
      orderBy: [],
    });
  });
});

describe('parseSqlToBuilderOptions rejects what the builder cannot express', () => {
  it.each([
    ['empty input', ''],
    ['not SQL', 'hello world'],
    ['join', 'SELECT a FROM t JOIN u ON t.id = u.id'],
    ['subquery in FROM', 'SELECT a FROM (SELECT a FROM t) s'],
    ['CTE', 'WITH c AS (SELECT * FROM t) SELECT * FROM c'],
    ['union', 'SELECT a FROM t UNION SELECT a FROM u'],
    ['expression projection', 'SELECT a + 1 FROM t'],
    ['CASE projection', 'SELECT CASE WHEN a THEN 1 ELSE 2 END FROM t'],
    ['window function', 'SELECT rank() OVER (ORDER BY a) FROM t'],
    ['HAVING', 'SELECT count(*) FROM t GROUP BY a HAVING count(*) > 1'],
    ['DISTINCT select', 'SELECT DISTINCT a FROM t'],
    ['offset', 'SELECT a FROM t LIMIT 10 OFFSET 5'],
    ['table alias', 'SELECT a FROM t x'],
    ['qualified column', 'SELECT t.a FROM t'],
    ['BETWEEN', 'SELECT * FROM t WHERE a BETWEEN 1 AND 2'],
    ['grouping the flat filter chain cannot carry', `SELECT * FROM t WHERE (a = 'x' OR b = 'y') AND c = 'z'`],
    ['multiple statements', 'SELECT a FROM t; SELECT b FROM u'],
    ['non-select', 'DELETE FROM t'],
  ])('%s → null', (_name, sql) => {
    expect(parse(sql)).toBeNull();
  });

  it('rejects a time bucket whose interval is not $__interval', () => {
    expect(parse(`SELECT $__timeGroupAlias(ts, '1m'), count(*) FROM t WHERE $__timeFilter(ts) GROUP BY 1 ORDER BY 1`)).toBeNull();
  });

  it('rejects a bucketed query missing its time filter', () => {
    expect(parse('SELECT $__timeGroupAlias(ts, $__interval), count(*) FROM t GROUP BY 1 ORDER BY 1')).toBeNull();
  });

  it('rejects unknown functions', () => {
    expect(parse('SELECT upper(a) FROM t')).toBeNull();
  });
});
