import { AdHocVariableFilter } from '@grafana/data';

import { AdHocFilter } from './adHocFilter';

describe('AdHocFilter', () => {
  const filter = (overrides: Partial<AdHocVariableFilter>): AdHocVariableFilter => ({
    key: 'weather.location',
    operator: '=',
    value: 'Berlin',
    ...overrides,
  });

  it('returns sql unchanged without filters', () => {
    const f = new AdHocFilter('doc');
    expect(f.apply('SELECT 1', [])).toBe('SELECT 1');
  });

  it('injects a WHERE and quotes string values', () => {
    const f = new AdHocFilter('doc');
    expect(f.apply('SELECT * FROM weather', [filter({})])).toBe(
      `SELECT * FROM weather WHERE ("location" = 'Berlin')`
    );
  });

  it('skips queries on other tables', () => {
    const f = new AdHocFilter('doc');
    const sql = 'SELECT * FROM other_table';
    expect(f.apply(sql, [filter({})])).toBe(sql);
  });

  it('joins multiple filters with AND', () => {
    const f = new AdHocFilter('doc');
    const got = f.apply('SELECT * FROM weather', [filter({}), filter({ key: 'weather.temp', operator: '>', value: '20' })]);
    expect(got).toContain(`WHERE ("location" = 'Berlin' AND "temp" > '20')`);
  });

  it('quotes every value, including ones that look numeric', () => {
    const f = new AdHocFilter('doc');
    // a value that looks numeric (leading zero) must stay a string literal, not become 755
    expect(f.apply('SELECT * FROM weather', [filter({ key: 'weather.zip', value: '0755' })])).toContain(
      `"zip" = '0755'`
    );
    expect(f.apply('SELECT * FROM weather', [filter({ key: 'weather.active', value: 'true' })])).toContain(
      `"active" = 'true'`
    );
  });

  it('ignores filters whose operator is not on the allowlist', () => {
    const f = new AdHocFilter('doc');
    const sql = 'SELECT * FROM weather';
    // an operator set to injection text via the URL must not reach the SQL
    const injected = filter({ operator: '= 1 OR 1=1 --' });
    expect(f.apply(sql, [injected])).toBe(sql);
  });

  it('escapes single quotes in values', () => {
    const f = new AdHocFilter('doc');
    expect(f.apply('SELECT * FROM weather', [filter({ value: "O'Brien" })])).toContain(`'O''Brien'`);
  });

  it('maps regex operators to CrateDB syntax', () => {
    const f = new AdHocFilter('doc');
    expect(f.apply('SELECT * FROM weather', [filter({ operator: '=~', value: 'Ber.*' })])).toContain(
      `"location" ~ 'Ber.*'`
    );
  });

  it('strips a trailing semicolon', () => {
    const f = new AdHocFilter('doc');
    expect(f.apply('SELECT * FROM weather;', [filter({})])).toBe(
      `SELECT * FROM weather WHERE ("location" = 'Berlin')`
    );
  });

  it('skips filters whose key has no table prefix', () => {
    const f = new AdHocFilter('doc');
    const sql = 'SELECT * FROM weather';
    // an un-prefixed key can't be resolved to a table, so it must not be applied
    expect(f.apply(sql, [filter({ key: 'location' })])).toBe(sql);
  });

  it('applies only the filters keyed to the query table, skipping the rest', () => {
    const f = new AdHocFilter('doc');
    const got = f.apply('SELECT * FROM weather', [
      filter({ key: 'weather.location', value: 'Berlin' }),
      filter({ key: 'sensors.status', value: 'ok' }),
    ]);
    // the sensors filter must not leak into the weather query
    expect(got).toBe(`SELECT * FROM weather WHERE ("location" = 'Berlin')`);
  });

  it('does not match a same-named table in another schema', () => {
    const f = new AdHocFilter('doc');
    // keys come from the default (doc) schema; a query on sys.nodes must not pick them up
    const sql = 'SELECT * FROM "sys"."nodes"';
    expect(f.apply(sql, [filter({ key: 'nodes.name', value: 'n1' })])).toBe(sql);
  });

  // ad-hoc filters must land in the query's own WHERE (before GROUP BY), not wrap
  // the aggregated result, which would reference a column it no longer exposes
  it('ANDs into an existing WHERE, before GROUP BY', () => {
    const f = new AdHocFilter('doc');
    expect(f.apply('SELECT count(*) AS value FROM weather WHERE ts > 0 GROUP BY 1', [filter({})])).toBe(
      `SELECT count(*) AS value FROM weather WHERE (ts > 0) AND ("location" = 'Berlin') GROUP BY 1`
    );
  });

  it('adds a WHERE to an aggregation that has none', () => {
    const f = new AdHocFilter('doc');
    expect(f.apply('SELECT count(*) AS value FROM weather GROUP BY 1', [filter({})])).toBe(
      `SELECT count(*) AS value FROM weather WHERE ("location" = 'Berlin') GROUP BY 1`
    );
  });

  it('builds IN lists from the structured values array, keeping commas intact', () => {
    const f = new AdHocFilter('doc');
    const got = f.apply('SELECT * FROM weather', [
      filter({ operator: 'IN', value: 'Berlin,Vienna', values: ['Berlin', 'Vienna, AT'] }),
    ]);
    expect(got).toContain(`"location" IN ('Berlin', 'Vienna, AT')`);
  });

  it('falls back to splitting the flattened string for IN without a values array', () => {
    const f = new AdHocFilter('doc');
    const got = f.apply('SELECT * FROM weather', [filter({ operator: 'IN', value: '(Berlin,Vienna)' })]);
    expect(got).toContain(`"location" IN ('Berlin', 'Vienna')`);
  });

  it('leaves a subquery-in-FROM query unchanged rather than splicing at the wrong level', () => {
    const f = new AdHocFilter('doc');
    const sql = 'SELECT sub.location FROM (SELECT location FROM weather) AS sub';
    expect(f.apply(sql, [filter({})])).toBe(sql);
  });

  it('preserves Grafana macros when injecting (the default template shape)', () => {
    const f = new AdHocFilter('doc');
    const sql =
      'SELECT $__timeGroupAlias("ts", $__interval), count(*) AS value FROM "doc"."weather" WHERE $__timeFilter("ts") GROUP BY 1 ORDER BY 1';
    expect(f.apply(sql, [filter({})])).toBe(
      `SELECT $__timeGroupAlias("ts", $__interval), count(*) AS value FROM "doc"."weather" WHERE ($__timeFilter("ts")) AND ("location" = 'Berlin') GROUP BY 1 ORDER BY 1`
    );
  });
});
