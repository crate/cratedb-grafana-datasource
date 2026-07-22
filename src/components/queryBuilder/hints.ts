import { findColumnByHint } from '../../data/columnHeuristics';
import { getColumnByHint } from '../../data/sqlGenerator';
import { BuilderOptions, ColumnHint, ColumnMeta, QueryFormat, SelectedColumn } from '../../types';

// replaces the column holding a hint; no column clears the role
export function withHint(columns: SelectedColumn[], hint: ColumnHint, column?: string): SelectedColumn[] {
  const rest = columns.filter((entry) => entry.hint !== hint);
  return column ? [...rest, { column, hint }] : rest;
}

const WANTED_HINTS: Partial<Record<QueryFormat, ColumnHint[]>> = {
  [QueryFormat.Timeseries]: [ColumnHint.Time],
  [QueryFormat.Logs]: [ColumnHint.Time, ColumnHint.LogMessage, ColumnHint.LogLevel],
};

// fills the flavor's unassigned hinted columns from the table's metadata via the
// name heuristics; returns the input identity when nothing was missing
export function applyHints(options: BuilderOptions, meta: ColumnMeta[]): BuilderOptions {
  let columns = options.columns;
  let changed = false;
  for (const hint of WANTED_HINTS[options.flavor] ?? []) {
    if (getColumnByHint({ ...options, columns }, hint) === undefined) {
      const guess = findColumnByHint(meta, hint);
      if (guess) {
        columns = withHint(columns, hint, guess.name);
        changed = true;
      }
    }
  }
  return changed ? { ...options, columns } : options;
}
