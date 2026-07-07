import React from 'react';

import { QueryEditorHelpProps } from '@grafana/data';

import { DEFAULT_QUERY_TEMPLATE } from '../constants';
import { MACROS } from '../editor/macros';
import { CrateDBQuery, QueryFormat } from '../types';

/**
 * Query-guidance help panel (the "?" next to the query editor). Teaches the
 * server-side aggregation pattern that keeps big-data dashboards from
 * pulling raw rows over the wire.
 */
export function CheatSheet({ onClickExample }: QueryEditorHelpProps<CrateDBQuery>) {
  return (
    <div>
      <h2>CrateDB time series queries</h2>
      <p>
        Always aggregate server-side: group by <code>$__timeGroupAlias</code> buckets and filter with{' '}
        <code>$__timeFilter</code>. The result set stays proportional to the panel width instead of the number of rows
        in the table — on billions of records, that is the difference between a snappy dashboard and an overloaded
        cluster.
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() =>
          onClickExample({
            refId: 'A',
            rawSql: DEFAULT_QUERY_TEMPLATE,
            format: QueryFormat.Timeseries,
          })
        }
      >
        Use the recommended template
      </button>
      <pre>
        <code>{DEFAULT_QUERY_TEMPLATE}</code>
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

      <h2>CrateDB notes</h2>
      <ul>
        <li>
          Use <code>$__timeFilter</code> on the table&apos;s partition column where possible, so CrateDB can prune
          partitions instead of scanning them.
        </li>
        <li>
          The <code>sys</code> schema is queryable like any other — handy for cluster monitoring dashboards (
          <code>sys.nodes</code>, <code>sys.shards</code>, <code>sys.jobs_log</code>).
        </li>
      </ul>
    </div>
  );
}
