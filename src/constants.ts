import { TLSMode } from './types';

/**
 * Every new query starts from this template. Aggregating by $__interval
 * server-side (DATE_BIN) keeps result sets proportional to panel pixels
 * instead of raw row counts — essential when dashboards sit on top of
 * billions of records.
 */
export const DEFAULT_QUERY_TEMPLATE = `SELECT
  $__timeGroupAlias("ts", $__interval),
  count(*) AS value
FROM "doc"."my_table"
WHERE $__timeFilter("ts")
GROUP BY 1
ORDER BY 1`;

export const DEFAULTS = {
  port: 5432,
  username: 'crate',
  defaultSchema: 'doc',
  tlsMode: TLSMode.Disable,
  tlsConfigurationMethod: 'file-content',
};

export const DOCS_URL = 'https://cratedb.com/docs';
export const PLUGIN_REPO_URL = 'https://github.com/crate/cratedb-grafana-datasource';
