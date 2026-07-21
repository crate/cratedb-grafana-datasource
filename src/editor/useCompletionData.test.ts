import { act, renderHook } from '@testing-library/react';

import { CrateDBDatasource } from '../datasource';
import { useCompletionData } from './useCompletionData';

function makeDatasource(overrides: Record<string, unknown> = {}): CrateDBDatasource {
  return {
    defaultSchema: 'doc',
    fetchSchemas: jest.fn().mockResolvedValue(['doc', 'sys']),
    fetchTables: jest.fn().mockResolvedValue(['metrics']),
    fetchColumns: jest.fn().mockResolvedValue(['ts', 'value']),
    ...overrides,
  } as unknown as CrateDBDatasource;
}

describe('useCompletionData', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('maps introspection results to completion suggestions', async () => {
    const { result } = renderHook(() => useCompletionData(makeDatasource()));

    let schemas: Array<{ name: string; completion: string }> = [];
    await act(async () => {
      schemas = await result.current.getSchemas();
    });

    expect(schemas).toEqual([
      { name: 'doc', completion: 'doc' },
      { name: 'sys', completion: 'sys' },
    ]);
    expect(result.current.error).toBe(false);
  });

  it('falls back to the default schema for column lookups', async () => {
    const datasource = makeDatasource();
    const { result } = renderHook(() => useCompletionData(datasource));

    await act(async () => {
      await result.current.getColumns('metrics');
    });

    expect(datasource.fetchColumns).toHaveBeenCalledWith('doc', 'metrics');
  });

  it('surfaces failures instead of swallowing them', async () => {
    const datasource = makeDatasource({
      fetchSchemas: jest.fn().mockRejectedValue(new Error('RelationUnknown')),
    });
    const { result } = renderHook(() => useCompletionData(datasource));

    let schemas: unknown[] = ['sentinel'];
    await act(async () => {
      schemas = await result.current.getSchemas();
    });

    expect(schemas).toEqual([]);
    expect(result.current.error).toBe(true);
    expect(warn).toHaveBeenCalledWith('CrateDB autocomplete: schema lookup failed', expect.any(Error));
  });

  it('clears the error on the next successful lookup', async () => {
    const datasource = makeDatasource({
      fetchSchemas: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const { result } = renderHook(() => useCompletionData(datasource));

    await act(async () => {
      await result.current.getSchemas();
    });
    expect(result.current.error).toBe(true);

    await act(async () => {
      await result.current.getTables('doc');
    });
    expect(result.current.error).toBe(false);
  });
});
