import { MacroType } from '@grafana/plugin-ui';

/**
 * Macro metadata: single source of truth for autocomplete and the cheat
 * sheet. Must stay in sync with the backend implementations in
 * pkg/macros/macros.go (and the tables in README.md / docs/architecture.md).
 */
export const MACROS = [
  {
    id: '$__timeFilter(timeColumn)',
    name: '$__timeFilter(timeColumn)',
    text: '$__timeFilter',
    args: ['column'],
    type: MacroType.Filter,
    description:
      'Replaced by a time range condition on the column, e.g. "ts" >= \'2026-07-03T10:00:00Z\' AND "ts" <= \'2026-07-03T16:00:00Z\'. Lets CrateDB prune partitions.',
  },
  {
    id: '$__timeFrom()',
    name: '$__timeFrom()',
    text: '$__timeFrom',
    args: [],
    type: MacroType.Filter,
    description: "Replaced by the start of the panel time range, e.g. '2026-07-03T10:00:00Z'.",
  },
  {
    id: '$__timeTo()',
    name: '$__timeTo()',
    text: '$__timeTo',
    args: [],
    type: MacroType.Filter,
    description: "Replaced by the end of the panel time range, e.g. '2026-07-03T16:00:00Z'.",
  },
  {
    id: "$__timeGroup(timeColumn, '1m')",
    name: "$__timeGroup(timeColumn, '1m')",
    text: '$__timeGroup',
    args: ['column', "'1m'"],
    type: MacroType.Group,
    description:
      'Replaced by DATE_BIN(\'60 seconds\'::INTERVAL, "ts", 0) — buckets rows into intervals server-side. Use $__interval as the interval to follow the panel resolution.',
  },
  {
    id: "$__timeGroupAlias(timeColumn, '1m')",
    name: "$__timeGroupAlias(timeColumn, '1m')",
    text: '$__timeGroupAlias',
    args: ['column', "'1m'"],
    type: MacroType.Group,
    description: 'Like $__timeGroup, aliased to "time" (the column Grafana expects for time series).',
  },
  {
    id: '$__unixEpochFilter(timeColumn)',
    name: '$__unixEpochFilter(timeColumn)',
    text: '$__unixEpochFilter',
    args: ['column'],
    type: MacroType.Filter,
    description: 'Time range condition for BIGINT epoch-seconds columns, e.g. col >= 1783072800 AND col <= 1783094400.',
  },
  {
    id: "$__unixEpochGroup(timeColumn, '1m')",
    name: "$__unixEpochGroup(timeColumn, '1m')",
    text: '$__unixEpochGroup',
    args: ['column', "'1m'"],
    type: MacroType.Group,
    description: 'Bucketing for epoch-seconds columns: FLOOR(col/60)*60.',
  },
  {
    id: "$__unixEpochGroupAlias(timeColumn, '1m')",
    name: "$__unixEpochGroupAlias(timeColumn, '1m')",
    text: '$__unixEpochGroupAlias',
    args: ['column', "'1m'"],
    type: MacroType.Group,
    description: 'Like $__unixEpochGroup, aliased to "time".',
  },
  {
    id: '$__interval',
    name: '$__interval',
    text: '$__interval',
    args: [],
    type: MacroType.Value,
    description:
      "Replaced by Grafana's suggested bucket size for the panel width and time range, e.g. 30s. Pass it to $__timeGroupAlias.",
  },
];
