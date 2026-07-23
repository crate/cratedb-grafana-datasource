import { ColumnHint, ColumnMeta } from '../types';
import { columnKind } from './columnTypes';

// name-based guesses for a table's time/body/level columns, used to prefill the
// builder's hinted pickers when a table is selected. A name match only counts
// when the column's data type fits the role (time hint needs a timestamp/date
// column, log roles need text).

const HINT_NAMES: Record<ColumnHint, RegExp[]> = {
  [ColumnHint.Time]: [/^ts$/i, /^time$/i, /^timestamp$/i, /^@timestamp$/i, /^event_time$/i, /^log_time$/i, /^created_at$/i],
  [ColumnHint.LogMessage]: [/^body$/i, /^message$/i, /^msg$/i, /^log_message$/i, /^log$/i, /^content$/i],
  [ColumnHint.LogLevel]: [/^level$/i, /^severity$/i, /^severity_text$/i, /^log_level$/i, /^loglevel$/i],
};

const HINT_KIND: Record<ColumnHint, 'time' | 'string'> = {
  [ColumnHint.Time]: 'time',
  [ColumnHint.LogMessage]: 'string',
  [ColumnHint.LogLevel]: 'string',
};

export function findColumnByHint(columns: ColumnMeta[], hint: ColumnHint): ColumnMeta | undefined {
  const kind = HINT_KIND[hint];
  const candidates = columns.filter((column) => columnKind(column.type) === kind);
  for (const pattern of HINT_NAMES[hint]) {
    const match = candidates.find((column) => pattern.test(column.name));
    if (match) {
      return match;
    }
  }
  // any timestamp column beats none; the log roles have no meaningful fallback
  return hint === ColumnHint.Time ? candidates[0] : undefined;
}
