import { MacroType } from '@grafana/plugin-ui';

// macro metadata for autocomplete and the cheat sheet; keep in sync with
// pkg/macros/macros.go and the tables in README.md / docs/architecture.md.
// id (cheat sheet) always equals name (autocomplete), so it's derived below
const DEFINITIONS = [
  {
    name: '$__timeFilter(timeColumn)',
    text: '$__timeFilter',
    args: ['column'],
    type: MacroType.Filter,
    description:
      'Restrict a query to the panel\'s time range (millisecond precision) so CrateDB can prune partitions. Expands to e.g. "ts" >= \'2026-07-03T10:00:00.000Z\' AND "ts" <= \'2026-07-03T16:00:00.000Z\'.',
  },
  {
    name: '$__dateFilter(dateColumn)',
    text: '$__dateFilter',
    args: ['column'],
    type: MacroType.Filter,
    description: "Restrict a DATE column to the panel's time range using date-only literals. Expands to e.g. \"day\" >= '2026-07-03' AND \"day\" <= '2026-07-04'.",
  },
  {
    name: '$__timeFrom()',
    text: '$__timeFrom',
    args: [],
    type: MacroType.Filter,
    description: "Replaced by the start of the panel time range, millisecond precision, e.g. '2026-07-03T10:00:00.000Z'.",
  },
  {
    name: '$__timeTo()',
    text: '$__timeTo',
    args: [],
    type: MacroType.Filter,
    description: "Replaced by the end of the panel time range, millisecond precision, e.g. '2026-07-03T16:00:00.000Z'.",
  },
  {
    name: '$__fromTime',
    text: '$__fromTime',
    args: [],
    type: MacroType.Value,
    description:
      "Range start as a typed, millisecond-precision literal ('...'::TIMESTAMPTZ) for use inside expressions.",
  },
  {
    name: '$__toTime',
    text: '$__toTime',
    args: [],
    type: MacroType.Value,
    description:
      "Range end as a typed, millisecond-precision literal ('...'::TIMESTAMPTZ) for use inside expressions.",
  },
  {
    name: "$__timeGroup(timeColumn, '1m')",
    text: '$__timeGroup',
    args: ['column', "'1m'"],
    type: MacroType.Column,
    description:
      'Bucket rows into time intervals server-side. Expands to DATE_BIN(\'60 seconds\'::INTERVAL, "ts", 0); pass $__interval to follow the panel resolution.',
  },
  {
    name: "$__timeGroupAlias(timeColumn, '1m')",
    text: '$__timeGroupAlias',
    args: ['column', "'1m'"],
    type: MacroType.Column,
    description: 'Like $__timeGroup, aliased to "time" (the column Grafana expects for time series).',
  },
  {
    name: '$__unixEpochFilter(timeColumn)',
    text: '$__unixEpochFilter',
    args: ['column'],
    type: MacroType.Filter,
    description: 'Time range condition for BIGINT epoch-seconds columns, e.g. col >= 1783072800 AND col <= 1783094400.',
  },
  {
    name: "$__unixEpochGroup(timeColumn, '1m')",
    text: '$__unixEpochGroup',
    args: ['column', "'1m'"],
    type: MacroType.Column,
    description: 'Bucketing for epoch-seconds columns: FLOOR(col/60)*60.',
  },
  {
    name: "$__unixEpochGroupAlias(timeColumn, '1m')",
    text: '$__unixEpochGroupAlias',
    args: ['column', "'1m'"],
    type: MacroType.Column,
    description: 'Like $__unixEpochGroup, aliased to "time".',
  },
  {
    name: '$__interval',
    text: '$__interval',
    args: [],
    type: MacroType.Value,
    description:
      "Replaced by Grafana's suggested bucket size for the panel width and time range, e.g. 30s. Pass it to $__timeGroupAlias.",
  },
  {
    name: '$__interval_s',
    text: '$__interval_s',
    args: [],
    type: MacroType.Value,
    description: 'The panel interval as whole seconds (minimum 1), for arithmetic on epoch-seconds columns.',
  },
  {
    name: '$__conditionalAll(condition, $variable)',
    text: '$__conditionalAll',
    args: ['condition', '$variable'],
    type: MacroType.Filter,
    description:
      "Replaced by the condition when the multi-select variable has a selection, or by 1=1 when it is set to 'All'. Interpolated in the frontend before the query is sent.",
  },
];

export const MACROS = DEFINITIONS.map((macro) => ({ ...macro, id: macro.name }));
