import { useEffect, useState } from 'react';

import { CrateDBDatasource } from '../../datasource';
import { ColumnMeta } from '../../types';

// column metadata for the selected table; resolves to [] on failure so the
// pickers degrade to free-text entry (the same tolerance as useCompletionData)
export function useColumnMeta(datasource: CrateDBDatasource, schema: string, table: string): ColumnMeta[] {
  // keyed by table so a stale result never shows for the current one
  const [loaded, setLoaded] = useState<{ key: string; columns: ColumnMeta[] } | null>(null);
  const key = `${schema}.${table}`;

  useEffect(() => {
    let cancelled = false;
    if (table) {
      datasource.fetchColumnMeta(schema, table).then(
        (meta) => {
          if (!cancelled) {
            setLoaded({ key: `${schema}.${table}`, columns: meta });
          }
        },
        () => {
          if (!cancelled) {
            setLoaded({ key: `${schema}.${table}`, columns: [] });
          }
        }
      );
    }
    return () => {
      cancelled = true;
    };
  }, [datasource, schema, table]);

  return loaded?.key === key ? loaded.columns : [];
}
