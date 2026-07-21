import { TLSMode } from './types';

// every new query starts here; grouping by $__interval server-side (DATE_BIN)
// keeps the result size close to panel pixels, not row count
export const DEFAULT_QUERY_TEMPLATE = `SELECT
  $__timeGroupAlias("ts", $__interval),
  count(*) AS value
FROM "doc"."demo_metrics"
WHERE $__timeFilter("ts")
GROUP BY 1
ORDER BY 1`;

// the logs cheat-sheet example; aliases match what Grafana's logs panel
// detects: "time" (timestamp), "body" (log line), "level" (severity coloring)
export const LOGS_QUERY_TEMPLATE = `SELECT
  "ts" AS time,
  "message" AS body,
  "level"
FROM "doc"."demo_logs"
WHERE $__timeFilter("ts")
ORDER BY "ts" DESC
LIMIT 1000`;

export const DEFAULTS = {
  username: 'crate',
  defaultSchema: 'doc',
  tlsMode: TLSMode.Disable,
};

export const DOCS_URL = 'https://cratedb.com/docs';
