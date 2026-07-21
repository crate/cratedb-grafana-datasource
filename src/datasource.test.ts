import { AdHocVariableFilter, DataQueryRequest, DataSourceInstanceSettings, TimeRange } from '@grafana/data';
import { lastValueFrom, of } from 'rxjs';

import { CrateDBOptions, CrateDBQuery, CrateDBVariableQuery, QueryFormat } from './types';

// Stub the runtime: a no-op backend base class, and a template service whose
// replace() expands $__interval into a bare duration literal ("20m") the way
// Grafana does at query time — the expansion the injection order must survive —
// and expands $<name> for every mockVariables entry through the format argument,
// the way Grafana routes custom formatters. mockVariables lets tests stand up
// dashboard variables (e.g. the ad-hoc scope, or a multi-select).
interface MockVariable {
  name: string;
  multi?: boolean;
  includeAll?: boolean;
  current?: { value: unknown };
}
const mockVariables: MockVariable[] = [];
jest.mock('@grafana/runtime', () => ({
  DataSourceWithBackend: class {
    constructor(public instanceSettings: unknown) {}
  },
  getTemplateSrv: () => ({
    getVariables: () => mockVariables,
    replace: (sql: string, _scopedVars?: unknown, format?: (value: unknown, variable: MockVariable) => unknown) => {
      let out = sql.replace(/\$__interval\b/g, '20m');
      for (const variable of mockVariables) {
        out = out.replace(new RegExp(`\\$${variable.name}\\b`, 'g'), () => {
          const value = variable.current?.value;
          return String(format ? format(value, variable) : value);
        });
      }
      return out;
    },
  }),
}));

// imported after the mock so the datasource picks up the stubbed runtime
import { CrateDBDatasource } from './datasource';
import { CrateDBVariableSupport } from './variables';

function makeDatasource(): CrateDBDatasource {
  const settings = {
    jsonData: { defaultSchema: 'doc' },
  } as unknown as DataSourceInstanceSettings<CrateDBOptions>;
  return new CrateDBDatasource(settings);
}

const templateQuery: CrateDBQuery = {
  refId: 'A',
  rawSql:
    'SELECT $__timeGroupAlias(ts, $__interval), count(*) AS value FROM doc.demo_metrics WHERE $__timeFilter(ts) GROUP BY 1 ORDER BY 1',
  format: QueryFormat.Timeseries,
};

describe('CrateDBDatasource.applyTemplateVariables', () => {
  beforeEach(() => {
    mockVariables.length = 0;
  });

  it('quotes a concrete multi-select selection as SQL literals', () => {
    mockVariables.push({ name: 'location', multi: true, includeAll: true, current: { value: ['Berlin', 'Vienna'] } });
    const ds = makeDatasource();
    const query: CrateDBQuery = {
      refId: 'A',
      rawSql: 'SELECT * FROM doc.demo_metrics WHERE $__conditionalAll(location IN ($location), $location)',
      format: QueryFormat.Table,
    };

    const { rawSql } = ds.applyTemplateVariables(query, {}, []);

    expect(rawSql).toContain("location IN ('Berlin','Vienna')");
  });

  it('drops the condition entirely on the All selection', () => {
    mockVariables.push({ name: 'location', multi: true, includeAll: true, current: { value: ['$__all'] } });
    const ds = makeDatasource();
    const query: CrateDBQuery = {
      refId: 'A',
      rawSql: 'SELECT * FROM doc.demo_metrics WHERE $__conditionalAll(location IN ($location), $location)',
      format: QueryFormat.Table,
    };

    const { rawSql } = ds.applyTemplateVariables(query, {}, []);

    expect(rawSql).toContain('WHERE 1=1');
    expect(rawSql).not.toContain('$location');
  });

  // ordering invariant: filters inject before replace(), because the AST parser
  // can tokenize $__interval but not the bare "20m" replace() turns it into
  it('applies an ad-hoc filter to a query that uses $__interval', () => {
    const ds = makeDatasource();
    const filters: AdHocVariableFilter[] = [{ key: 'demo_metrics.location', operator: '=', value: 'Vienna' }];

    const { rawSql } = ds.applyTemplateVariables(templateQuery, {}, filters);

    expect(rawSql).toContain(`("location" = 'Vienna')`);
    // the interval macro still expands to its duration literal
    expect(rawSql).toContain('20m');
  });

  it('leaves the query unfiltered when there are no ad-hoc filters', () => {
    const ds = makeDatasource();

    const { rawSql } = ds.applyTemplateVariables(templateQuery, {}, []);

    expect(rawSql).not.toContain('location');
    expect(rawSql).toContain('20m');
  });
});

describe('CrateDBDatasource.getTagKeys', () => {
  beforeEach(() => {
    mockVariables.length = 0;
  });

  function withKeys(ds: CrateDBDatasource, keys: string[]) {
    const postResource = jest.fn().mockResolvedValue(keys);
    (ds as unknown as { postResource: jest.Mock }).postResource = postResource;
    return postResource;
  }

  it('maps the adhoc-keys route result', async () => {
    const ds = makeDatasource();
    const post = withKeys(ds, ['metrics.location', "metrics.tags['source']"]);

    const keys = await ds.getTagKeys();

    expect(post).toHaveBeenCalledWith('adhoc-keys', { schema: 'doc' });
    expect(keys).toEqual([{ text: 'metrics.location' }, { text: "metrics.tags['source']" }]);
  });

  it('narrows tables through the cratedb_adhoc_tables variable', async () => {
    mockVariables.push({ name: 'cratedb_adhoc_tables', current: { value: 'metrics, doc.sensors' } });
    const ds = makeDatasource();
    withKeys(ds, ['metrics.location', 'sensors.id', 'other.value']);

    const keys = await ds.getTagKeys();

    // "doc.sensors" matches: the default-schema qualifier is dropped
    expect(keys).toEqual([{ text: 'metrics.location' }, { text: 'sensors.id' }]);
  });

  it('coalesces concurrent lookups for the same scope', async () => {
    const ds = makeDatasource();
    const post = withKeys(ds, ['metrics.location']);

    await Promise.all([ds.getTagKeys(), ds.getTagKeys()]);

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not share in-flight results across scopes', async () => {
    const ds = makeDatasource();
    const post = withKeys(ds, ['metrics.location', 'sensors.id']);

    const unscoped = ds.getTagKeys();
    mockVariables.push({ name: 'cratedb_adhoc_tables', current: { value: 'metrics' } });
    const scoped = ds.getTagKeys();

    expect(await unscoped).toHaveLength(2);
    expect(await scoped).toEqual([{ text: 'metrics.location' }]);
    expect(post).toHaveBeenCalledTimes(2);
  });
});

interface Frame {
  fields: Array<{ name: string; values: unknown[] }>;
}

// stub the data path: runTableQuery/metricFindQuery/getTagValues all go through
// this.query() (the real one calls super.query on the mocked backend base, which
// has none) — return an Observable of the frame the backend would produce.
function withQueryResult(ds: CrateDBDatasource, frame?: Frame) {
  const query = jest.fn().mockReturnValue(of({ data: frame ? [frame] : [] }));
  (ds as unknown as { query: jest.Mock }).query = query;
  return query;
}

describe('CrateDBDatasource.getTagValues', () => {
  beforeEach(() => {
    mockVariables.length = 0;
  });

  it('runs a DISTINCT scan of the key column and maps non-null values', async () => {
    const ds = makeDatasource();
    const query = withQueryResult(ds, { fields: [{ name: 'value', values: ['Berlin', null, 'Vienna'] }] });

    const values = await ds.getTagValues({ key: 'demo_metrics.location' });

    const sql = query.mock.calls[0][0].targets[0].rawSql;
    expect(sql).toBe('SELECT DISTINCT "location" AS value FROM "doc"."demo_metrics" LIMIT 1000');
    // the value scan is deliberately unbounded — no range reaches the request
    expect(query.mock.calls[0][0].range).toBeUndefined();
    expect(values).toEqual([{ text: 'Berlin' }, { text: 'Vienna' }]);
  });

  it('scans an OBJECT sub-column key with subscript escaping intact', async () => {
    const ds = makeDatasource();
    const query = withQueryResult(ds, { fields: [{ name: 'value', values: ['sensor-a'] }] });

    await ds.getTagValues({ key: "demo_metrics.tags['source']" });

    expect(query.mock.calls[0][0].targets[0].rawSql).toContain(`"tags"['source']`);
  });

  it('returns nothing for a malformed key', async () => {
    const ds = makeDatasource();
    const query = withQueryResult(ds, { fields: [{ name: 'value', values: ['x'] }] });

    expect(await ds.getTagValues({ key: 'no-dot' })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('coalesces concurrent lookups for the same key', async () => {
    const ds = makeDatasource();
    const query = withQueryResult(ds, { fields: [{ name: 'value', values: ['Berlin'] }] });

    await Promise.all([ds.getTagValues({ key: 'demo_metrics.location' }), ds.getTagValues({ key: 'demo_metrics.location' })]);

    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('CrateDBDatasource.metricFindQuery', () => {
  beforeEach(() => {
    mockVariables.length = 0;
  });

  it('returns text-only entries for a single-column result', async () => {
    const ds = makeDatasource();
    withQueryResult(ds, { fields: [{ name: 'location', values: ['Berlin', 'Vienna'] }] });

    expect(await ds.metricFindQuery('SELECT DISTINCT location FROM doc.demo_metrics')).toEqual([
      { text: 'Berlin' },
      { text: 'Vienna' },
    ]);
  });

  it('maps a __text/__value pair to label/value entries', async () => {
    const ds = makeDatasource();
    withQueryResult(ds, {
      fields: [
        { name: '__value', values: [1, 2] },
        { name: '__text', values: ['Berlin', 'Vienna'] },
      ],
    });

    expect(await ds.metricFindQuery('SELECT id AS __value, name AS __text FROM t')).toEqual([
      { text: 'Berlin', value: 1 },
      { text: 'Vienna', value: 2 },
    ]);
  });

  it('falls back to first=text second=value for two unnamed columns', async () => {
    const ds = makeDatasource();
    withQueryResult(ds, {
      fields: [
        { name: 'name', values: ['Berlin'] },
        { name: 'id', values: [7] },
      ],
    });

    expect(await ds.metricFindQuery('SELECT name, id FROM t')).toEqual([{ text: 'Berlin', value: 7 }]);
  });

  it('returns nothing for an empty query', async () => {
    const ds = makeDatasource();
    const query = withQueryResult(ds);

    expect(await ds.metricFindQuery('')).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  // without a range the backend expands $__timeFilter against the zero epoch, so
  // a time-bound variable query would silently return nothing
  it('passes the dashboard time range into the variable query request', async () => {
    const ds = makeDatasource();
    const query = withQueryResult(ds, { fields: [{ name: 'host', values: ['a'] }] });
    const range = { from: 'FROM', to: 'TO', raw: { from: 'now-1h', to: 'now' } } as unknown as TimeRange;

    await ds.metricFindQuery('SELECT DISTINCT host FROM m WHERE $__timeFilter(ts)', { range });

    expect(query.mock.calls[0][0].range).toBe(range);
  });
});

describe('CrateDBDatasource.variables (query-variable support)', () => {
  beforeEach(() => {
    mockVariables.length = 0;
  });

  function runVariableQuery(ds: CrateDBDatasource, rawSql: string) {
    const request = { targets: [{ refId: 'A', rawSql }] } as unknown as DataQueryRequest<CrateDBVariableQuery>;
    return lastValueFrom(new CrateDBVariableSupport(ds).query(request));
  }

  it('resolves variable values through metricFindQuery as a data frame', async () => {
    const ds = makeDatasource();
    withQueryResult(ds, { fields: [{ name: 'name', values: ['node-0', 'node-1'] }] });

    const response = await runVariableQuery(ds, 'SELECT name FROM sys.nodes');

    const frame = response.data[0];
    expect(frame.fields[0].values).toEqual(['node-0', 'node-1']);
  });

  it('carries __text/__value pairs through into the frame', async () => {
    const ds = makeDatasource();
    withQueryResult(ds, {
      fields: [
        { name: '__value', values: [1, 2] },
        { name: '__text', values: ['Berlin', 'Vienna'] },
      ],
    });

    const response = await runVariableQuery(ds, 'SELECT id AS __value, name AS __text FROM t');

    const frame = response.data[0];
    const text = frame.fields.find((f: { name: string }) => f.name === 'text');
    const value = frame.fields.find((f: { name: string }) => f.name === 'value');
    expect(text.values).toEqual(['Berlin', 'Vienna']);
    expect(value.values).toEqual([1, 2]);
  });
});

describe('CrateDBDatasource.filterQuery', () => {
  it('runs only queries that have SQL', () => {
    const ds = makeDatasource();

    expect(ds.filterQuery({ refId: 'A', rawSql: 'SELECT 1', format: QueryFormat.Table })).toBe(true);
    expect(ds.filterQuery({ refId: 'A', rawSql: '', format: QueryFormat.Table })).toBe(false);
  });
});
