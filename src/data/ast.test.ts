import { getTable } from './ast';

describe('getTable', () => {
  it('extracts a bare table', () => {
    expect(getTable('SELECT * FROM weather')).toBe('weather');
  });

  it('extracts a schema-qualified table', () => {
    expect(getTable('SELECT * FROM doc.weather')).toBe('doc.weather');
  });

  it('handles quoted identifiers', () => {
    expect(getTable('SELECT * FROM "doc"."weather_data"')).toBe('doc.weather_data');
  });

  it('parses queries containing Grafana macros', () => {
    const sql = `SELECT $__timeGroupAlias("ts", $__interval), count(*) FROM doc.weather WHERE $__timeFilter("ts") GROUP BY 1`;
    expect(getTable(sql)).toBe('doc.weather');
  });

  it('parses queries containing dashboard variables', () => {
    expect(getTable('SELECT * FROM weather WHERE location = ${loc}')).toBe('weather');
    expect(getTable("SELECT * FROM weather WHERE location = '$loc'")).toBe('weather');
  });

  it('descends into subqueries', () => {
    expect(getTable('SELECT * FROM (SELECT * FROM doc.weather) AS w')).toBe('doc.weather');
  });

  it('returns empty string for non-select statements', () => {
    expect(getTable('INSERT INTO t VALUES (1)')).toBe('');
    expect(getTable('not sql at all ???')).toBe('');
  });
});
