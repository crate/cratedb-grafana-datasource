import { useEffect, useState } from 'react';

import { CrateDBDatasource } from '../../datasource';
import { ColumnMeta } from '../../types';

// metadata fetches ride through backend restarts and blips; only after the
// retries are spent does the hook settle on "no metadata"
const RETRIES = 2;
const RETRY_DELAY_MS = 1500;

// column metadata for the selected table; resolves to [] on persistent failure
// so the pickers degrade to free-text entry (the same tolerance as
// useCompletionData)
export function useColumnMeta(datasource: CrateDBDatasource, schema: string, table: string): ColumnMeta[] {
  // keyed by table so a stale result never shows for the current one
  const [loaded, setLoaded] = useState<{ key: string; columns: ColumnMeta[] } | null>(null);
  const key = `${schema}.${table}`;

  useEffect(() => {
    let cancelled = false;
    if (!table) {
      return;
    }
    const attempt = (retriesLeft: number) => {
      datasource.fetchColumnMeta(schema, table).then(
        (meta) => {
          if (!cancelled) {
            setLoaded({ key: `${schema}.${table}`, columns: meta });
          }
        },
        () => {
          if (cancelled) {
            return;
          }
          if (retriesLeft > 0) {
            setTimeout(() => {
              if (!cancelled) {
                attempt(retriesLeft - 1);
              }
            }, RETRY_DELAY_MS);
          } else {
            setLoaded({ key: `${schema}.${table}`, columns: [] });
          }
        }
      );
    };
    attempt(RETRIES);
    return () => {
      cancelled = true;
    };
  }, [datasource, schema, table]);

  return loaded?.key === key ? loaded.columns : [];
}
