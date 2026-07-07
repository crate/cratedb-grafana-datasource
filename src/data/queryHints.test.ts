import { DataQueryRequest, DataQueryResponse } from '@grafana/data';

import { CrateDBQuery, QueryFormat } from '../types';
import { attachTimeBoundNotices, hasTimeBound } from './queryHints';

describe('hasTimeBound', () => {
  it.each([
    'SELECT * FROM t WHERE $__timeFilter(ts)',
    'SELECT * FROM t WHERE $__dateFilter(day)',
    'SELECT * FROM t WHERE ts >= $__fromTime',
    'SELECT * FROM t WHERE epoch BETWEEN $__unixEpochFilter(epoch)',
    "SELECT * FROM t WHERE ts > $__timeFrom()",
  ])('finds the bound in %s', (sql) => {
    expect(hasTimeBound(sql)).toBe(true);
  });

  it.each([
    'SELECT * FROM t',
    "SELECT * FROM t WHERE ts > now() - '1 day'::INTERVAL",
    // group macros do not bind the range
    'SELECT $__timeGroupAlias(ts, 1m), avg(v) FROM t GROUP BY 1',
  ])('reports no bound for %s', (sql) => {
    expect(hasTimeBound(sql)).toBe(false);
  });

  it('ignores macros inside comments', () => {
    expect(hasTimeBound('SELECT * FROM t -- add $__timeFilter(ts) later')).toBe(false);
  });
});

function makeRequest(targets: Array<Partial<CrateDBQuery>>): DataQueryRequest<CrateDBQuery> {
  return {
    targets: targets.map((t, i) => ({
      refId: String.fromCharCode(65 + i),
      rawSql: 'SELECT 1',
      format: QueryFormat.Table,
      ...t,
    })),
  } as DataQueryRequest<CrateDBQuery>;
}

function makeResponse(frames: Array<{ refId: string; meta?: Record<string, unknown> }>): DataQueryResponse {
  return { data: frames } as DataQueryResponse;
}

describe('attachTimeBoundNotices', () => {
  it('stamps an info notice on frames of unbounded queries only', () => {
    const request = makeRequest([
      { rawSql: 'SELECT * FROM t' },
      { rawSql: 'SELECT * FROM t WHERE $__timeFilter(ts)' },
    ]);
    const response = makeResponse([{ refId: 'A' }, { refId: 'B' }]);

    attachTimeBoundNotices(request, response);

    const [a, b] = response.data as Array<{ meta?: { notices?: Array<{ severity: string; text: string }> } }>;
    expect(a.meta?.notices).toHaveLength(1);
    expect(a.meta?.notices?.[0].severity).toBe('info');
    expect(a.meta?.notices?.[0].text).toContain('time-range macro');
    expect(b.meta?.notices).toBeUndefined();
  });

  it('keeps existing notices', () => {
    const request = makeRequest([{ rawSql: 'SELECT * FROM t' }]);
    const response = makeResponse([{ refId: 'A', meta: { notices: [{ severity: 'warning', text: 'limited' }] } }]);

    attachTimeBoundNotices(request, response);

    const frame = response.data[0] as { meta: { notices: unknown[] } };
    expect(frame.meta.notices).toHaveLength(2);
  });

  it('stamps only the first frame per refId', () => {
    const request = makeRequest([{ rawSql: 'SELECT * FROM t' }]);
    const response = makeResponse([{ refId: 'A' }, { refId: 'A' }]);

    attachTimeBoundNotices(request, response);

    const [first, second] = response.data as Array<{ meta?: { notices?: unknown[] } }>;
    expect(first.meta?.notices).toHaveLength(1);
    expect(second.meta?.notices).toBeUndefined();
  });

  it('skips hidden targets and internal lookups', () => {
    const request = makeRequest([
      { rawSql: 'SELECT * FROM t', hide: true },
      { refId: 'adhoc-metadata', rawSql: 'SELECT DISTINCT c FROM t' },
      { refId: 'variable-query', rawSql: 'SELECT v FROM t' },
    ]);
    const response = makeResponse([{ refId: 'A' }, { refId: 'adhoc-metadata' }, { refId: 'variable-query' }]);

    attachTimeBoundNotices(request, response);

    for (const frame of response.data as Array<{ meta?: unknown }>) {
      expect(frame.meta).toBeUndefined();
    }
  });

  it('tolerates responses without data', () => {
    const request = makeRequest([{ rawSql: 'SELECT * FROM t' }]);
    const response = { data: undefined } as unknown as DataQueryResponse;

    expect(() => attachTimeBoundNotices(request, response)).not.toThrow();
  });
});
