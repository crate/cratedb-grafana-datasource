import React from 'react';

import { QueryEditorHelpProps } from '@grafana/data';

import { TIMESERIES_QUERY_TEMPLATE, LOGS_QUERY_TEMPLATE } from '../constants';
import { MACROS } from '../editor/macros';
import { CrateDBQuery, QueryFormat } from '../types';

const LOGS_EXAMPLE: CrateDBQuery = {
  refId: 'A',
  rawSql: LOGS_QUERY_TEMPLATE,
  format: QueryFormat.Logs,
};

// help panel behind the "?" in the query editor; shows the server-side
// aggregation pattern
export function CheatSheet({ onClickExample }: QueryEditorHelpProps<CrateDBQuery>) {
  return (
    <div>
      <h2>CrateDB time series queries</h2>
      <p>
        Keep dashboards fast on large tables: aggregate server-side so the result set tracks the panel width, not the
        row count. Group by <code>$__timeGroupAlias</code> buckets and filter with <code>$__timeFilter</code>.
      </p>
      <p>
        Press <code>Ctrl+Enter</code> (<code>Cmd+Enter</code> on macOS) in the editor to run the query.
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() =>
          onClickExample({
            refId: 'A',
            rawSql: TIMESERIES_QUERY_TEMPLATE,
            format: QueryFormat.Timeseries,
          })
        }
      >
        Use the recommended template
      </button>
      <pre>
        <code>{TIMESERIES_QUERY_TEMPLATE}</code>
      </pre>

      <h2>Macros</h2>
      <table className="filter-table">
        <thead>
          <tr>
            <th>Macro</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {MACROS.map((macro) => (
            <tr key={macro.id}>
              <td>
                <code>{macro.id}</code>
              </td>
              <td>{macro.description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Logs</h2>
      <p>
        With the <strong>Logs</strong> format, Grafana renders rows as log lines (e.g. in Explore). Alias your columns
        to the names the logs panel detects: the timestamp as <code>time</code>, the log line as <code>body</code>, and
        optionally a severity string as <code>level</code> (drives line coloring).
      </p>
      <button type="button" className="btn btn-secondary" onClick={() => onClickExample(LOGS_EXAMPLE)}>
        Use the logs template
      </button>
      <pre>
        <code>{LOGS_QUERY_TEMPLATE}</code>
      </pre>

      <h2>Ad-hoc filters</h2>
      <p>
        Ad-hoc filter keys are the filterable columns (<code>table.column</code>) of every table in the default
        schema. On large schemas, add a dashboard constant or textbox variable named{' '}
        <code>cratedb_adhoc_tables</code> with a comma-separated list of table names to narrow the key picker.
      </p>

      <h2>Query plans</h2>
      <p>
        Prefix a query with <code>EXPLAIN</code> (or <code>EXPLAIN ANALYZE</code> to execute it and report real costs)
        to inspect CrateDB&apos;s query plan; the result renders as a table. Macros expand before the plan runs, and the
        exact SQL that was executed is always visible under Query Inspector → Query.
      </p>

      <h2>CrateDB notes</h2>
      <ul>
        <li>
          Use <code>$__timeFilter</code> on the table&apos;s partition column where possible, so CrateDB can prune
          partitions instead of scanning them.
        </li>
        <li>
          The <code>sys</code> schema is queryable like any other table, useful for cluster monitoring (
          <code>sys.nodes</code>, <code>sys.shards</code>, <code>sys.jobs_log</code>).
        </li>
      </ul>
    </div>
  );
}
