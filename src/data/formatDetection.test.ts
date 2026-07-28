import { TIMESERIES_QUERY_TEMPLATE } from '../constants';
import { QueryFormat } from '../types';
import { detectFormat } from './formatDetection';

describe('detectFormat', () => {
  it('detects the recommended time-series template as a time series (macro alias)', () => {
    expect(detectFormat(TIMESERIES_QUERY_TEMPLATE)).toBe(QueryFormat.Timeseries);
  });

  it.each([
    ['SELECT ts AS time, value FROM t', QueryFormat.Timeseries],
    ['select "ts" as "time", avg(v) from t group by 1', QueryFormat.Timeseries],
    ['SELECT $__unixEpochGroupAlias(ts, 1m), count(*) FROM t GROUP BY 1', QueryFormat.Timeseries],
    ['SELECT * FROM t', QueryFormat.Table],
    ['SELECT ts, value FROM t', QueryFormat.Table],
    // needs at least two projections
    ['SELECT ts AS time FROM t', QueryFormat.Table],
    // only the FIRST projection counts
    ['SELECT value, ts AS time FROM t', QueryFormat.Table],
    ['', QueryFormat.Table],
    ['not sql at all', QueryFormat.Table],
    [undefined, QueryFormat.Table],
  ])('%s → %d', (sql, expected) => {
    expect(detectFormat(sql)).toBe(expected);
  });

  it.each([
    // the logs template: body + time, with the optional level column
    ['SELECT "ts" AS time, "message" AS body, "level" FROM doc.demo_logs', QueryFormat.Logs],
    // level is optional — body + time alone is still logs
    ['SELECT ts AS time, msg AS body FROM t', QueryFormat.Logs],
    ['select "ts" as "time", "message" as "body" from t', QueryFormat.Logs],
    // detected by field presence, not column order
    ['SELECT msg AS body, ts AS time FROM t', QueryFormat.Logs],
    // a body column without a time column is not logs
    ['SELECT msg AS body, host FROM t', QueryFormat.Table],
    // a real time series that happens to alias a column `body` stays a time
    // series: the logs rule needs a *plain* time column, not a bucket macro
    ['SELECT $__timeGroupAlias(ts, 1m), avg(v) AS body FROM t GROUP BY 1', QueryFormat.Timeseries],
  ])('logs: %s → %d', (sql, expected) => {
    expect(detectFormat(sql)).toBe(expected);
  });

  it('splits projections on top-level commas only', () => {
    expect(detectFormat("SELECT DATE_BIN('60 seconds'::INTERVAL, ts, 0) AS time, v FROM t")).toBe(
      QueryFormat.Timeseries
    );
    expect(detectFormat('SELECT coalesce(a, b), c FROM t')).toBe(QueryFormat.Table);
  });

  it('ignores subqueries inside projections', () => {
    expect(detectFormat('SELECT (SELECT max(ts) FROM u) AS time, v FROM t')).toBe(QueryFormat.Timeseries);
  });

  it('skips the CTE and reads the outer SELECT', () => {
    expect(detectFormat('WITH c AS (SELECT * FROM t) SELECT ts AS time, v FROM c')).toBe(QueryFormat.Timeseries);
    expect(detectFormat('WITH c AS (SELECT ts AS time, v FROM t) SELECT count(*) FROM c')).toBe(QueryFormat.Table);
  });

  it('strips comments before scanning', () => {
    const sql = `-- leading comment with a fake SELECT nothing, at all
      /* block /* nested */ comment */
      SELECT ts AS time, -- trailing note
        v
      FROM t`;
    expect(detectFormat(sql)).toBe(QueryFormat.Timeseries);
  });

  it('does not mistake quoted text for keywords or commas', () => {
    expect(detectFormat(`SELECT 'as time, fake' AS label, v FROM t`)).toBe(QueryFormat.Table);
    expect(detectFormat(`SELECT "weird, col" AS time, v FROM t`)).toBe(QueryFormat.Timeseries);
  });

  it('requires the alias at the end of the first projection', () => {
    expect(detectFormat('SELECT ts AS timestamp, v FROM t')).toBe(QueryFormat.Table);
  });

  it('treats a bare $__timeGroup first projection as time-aliased (backend comma shorthand)', () => {
    expect(detectFormat('SELECT $__timeGroup(ts, $__interval), avg(v) FROM t GROUP BY 1')).toBe(
      QueryFormat.Timeseries
    );
    // an expression argument with nested parens is still recognized
    expect(detectFormat(`SELECT $__timeGroup(date_trunc('hour', "ts"), '1h'), avg(v) FROM t GROUP BY 1`)).toBe(
      QueryFormat.Timeseries
    );
    // inside a wider expression the shorthand does not apply
    expect(detectFormat('SELECT max($__timeGroup(ts, 1m)), avg(v) FROM t')).toBe(QueryFormat.Table);
  });

  it('resolves EXPLAIN statements to table (plans are rows of text)', () => {
    expect(detectFormat('EXPLAIN SELECT $__timeGroupAlias(ts, 1m), v FROM t')).toBe(QueryFormat.Table);
    expect(detectFormat('  explain analyze SELECT ts AS time, v FROM t')).toBe(QueryFormat.Table);
    expect(detectFormat('-- comment\nEXPLAIN SELECT ts AS time, v FROM t')).toBe(QueryFormat.Table);
  });
});
