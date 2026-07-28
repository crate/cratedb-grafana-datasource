import { useCallback, useRef, useState } from 'react';

import { CrateDBDatasource } from '../datasource';

interface Suggestion {
  name: string;
  completion: string;
}

// introspection callbacks for the completion provider. Failures resolve to empty
// lists (typing is never blocked) but surface through `error` — e.g. a user without
// DQL on information_schema learns why only keywords are offered. Clears on next success.
export function useCompletionData(datasource: CrateDBDatasource) {
  const [error, setError] = useState(false);
  // a generation guard keeps a slow earlier lookup from clobbering the latest
  const generation = useRef(0);

  const wrap = useCallback(async (fetch: () => Promise<string[]>): Promise<Suggestion[]> => {
    const gen = ++generation.current;
    try {
      const values = await fetch();
      if (gen === generation.current) {
        setError(false);
      }
      return values.map((value) => ({ name: value, completion: value }));
    } catch (err) {
      console.warn('CrateDB autocomplete: schema lookup failed', err);
      if (gen === generation.current) {
        setError(true);
      }
      return [];
    }
  }, []);

  const getSchemas = useCallback(() => wrap(() => datasource.fetchSchemas()), [datasource, wrap]);

  const getTables = useCallback((schema?: string) => wrap(() => datasource.fetchTables(schema)), [datasource, wrap]);

  const getColumns = useCallback(
    (table: string, schema?: string) => wrap(() => datasource.fetchColumns(schema ?? datasource.defaultSchema, table)),
    [datasource, wrap]
  );

  return { getSchemas, getTables, getColumns, error };
}
