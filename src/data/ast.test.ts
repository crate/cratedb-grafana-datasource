import { getTable, injectPredicate, referencedTables } from './ast';

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

  it('returns empty for a derived-table (subquery) FROM', () => {
    // the inner columns live one level down, so an outer WHERE can't reference
    // them — ad-hoc injection is skipped rather than producing malformed SQL
    expect(getTable('SELECT * FROM (SELECT * FROM doc.weather) AS w')).toBe('');
  });

  it('returns empty string for non-select statements', () => {
    expect(getTable('INSERT INTO t VALUES (1)')).toBe('');
    expect(getTable('not sql at all ???')).toBe('');
  });

  it.each([
    ['a JOIN', 'SELECT * FROM a JOIN b ON a.id = b.id'],
    ['comma join', 'SELECT * FROM a, b'],
  ])('returns empty for a multi-relation FROM (%s)', (_label, sql) => {
    // both tables carry an unqualified column identically, so the filter scope
    // can't be resolved to either one without risking an ambiguous reference
    expect(getTable(sql)).toBe('');
  });
});

describe('injectPredicate', () => {
  it('splices into a single-table FROM', () => {
    expect(injectPredicate('SELECT * FROM weather', 'active')).toBe('SELECT * FROM weather WHERE (active)');
  });

  it.each([
    ['a JOIN', 'SELECT * FROM a JOIN b ON a.id = b.id'],
    ['comma join', 'SELECT * FROM a, b'],
  ])('returns null for a multi-relation FROM (%s)', (_label, sql) => {
    expect(injectPredicate(sql, 'active')).toBeNull();
  });
});

describe('referencedTables', () => {
  it.each([
    ['a single table', 'SELECT * FROM doc.weather', ['doc.weather']],
    ['every relation of a join', 'SELECT * FROM a JOIN b ON a.id = b.id', ['a', 'b']],
    ['the inner table of a derived-table FROM', 'SELECT * FROM (SELECT * FROM doc.weather) AS w', ['doc.weather']],
    [
      'both branches of a union',
      "SELECT 'cluster' AS scope FROM sys.checks UNION ALL SELECT node_id AS scope FROM sys.node_checks",
      ['sys.checks', 'sys.node_checks'],
    ],
    ['the body of a CTE, not the name it binds', 'WITH x AS (SELECT * FROM sys.nodes) SELECT * FROM x', ['sys.nodes']],
    ['nothing for unparseable SQL', 'not sql at all ???', []],
  ])('collects %s', (_label, sql, expected) => {
    expect(referencedTables(sql as string)).toEqual(expected);
  });
});
