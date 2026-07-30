# Macros

Grafana's SQL macros, expanded to CrateDB SQL. Most resolve on the backend
(`pkg/macros`), so they hold up on the alerting path where no frontend interpolation runs.
The final SQL after expansion is shown under **Query Inspector → Query**.

The editor completes every macro by name and shows the same documentation on hover; the
cheat sheet (book icon) lists them next to runnable query templates.

| Macro | Expands to (CrateDB SQL) |
|---|---|
| `$__timeFilter(col)` | `col >= '<from>' AND col <= '<to>'` — millisecond-precision RFC 3339 UTC literals |
| `$__dateFilter(col)` | `col >= '<from-date>' AND col <= '<to-date>'` — date-only literals, for `DATE` columns |
| `$__timeFrom()` / `$__timeTo()` | RFC 3339 UTC literal of the panel range boundary |
| `$__fromTime` / `$__toTime` | the same boundary as a typed literal, `'<boundary>'::TIMESTAMPTZ` |
| `$__timeGroup(col, 1m)` | `DATE_BIN('60 seconds'::INTERVAL, col, 0)` |
| `$__timeGroupAlias(col, 1m)` | the same, plus ` AS "time"` |
| `$__unixEpochFilter(col)` | `col >= <from-epoch> AND col <= <to-epoch>` — for `BIGINT` epoch-seconds columns |
| `$__unixEpochGroup(col, 1m)` | `FLOOR(col/60)*60` |
| `$__unixEpochGroupAlias(col, 1m)` | the same, plus ` AS "time"` |
| `$__interval_s` | the panel interval as whole seconds (minimum 1) |
| `$__conditionalAll(cond, $var)` | `cond` when the multi-select variable `$var` has a selection, `1=1` when it is on *All* |
| `$__interval`, `$__interval_ms`, `$__table`, `$__column` | provided by the plugin SDK |

## Rules worth knowing

**Arguments pass through verbatim.** A macro does not quote the column you give it, so
quote mixed-case identifiers yourself — CrateDB lower-cases unquoted ones. Write
`$__timeFilter("myColumn")`, not `$__timeFilter(myColumn)`.

**Bucket widths below a second stay milliseconds.** `intervalLiteral` renders whole seconds
as `N seconds` and anything finer as `N milliseconds`, so a 200ms interval is not coarsened
to one second.

**A bare `$__timeGroup(...)` projection is shorthand for the aliased form.** When it sits
directly before a comma in the select list, it is rewritten to `$__timeGroupAlias(...)`,
matching Grafana's built-in PostgreSQL data source. Anywhere else — inside `GROUP BY`, inside
an expression — it expands as written.

**`$__timeGroup` accepts `$__interval` as its width.** On the alerting path the literal
`$__interval` reaches the backend unexpanded and resolves from the query's own interval, so
the same query works in a panel and in an alert rule.

## Time-series template

The shape the visual query builder generates, and the one the cheat sheet inserts:

```sql
SELECT
  $__timeGroupAlias("ts", $__interval),
  count(*) AS "value"
FROM "doc"."demo_metrics"
WHERE $__timeFilter("ts")
GROUP BY 1
ORDER BY 1
```

Aggregating by `$__interval` server-side keeps the result set proportional to panel width
rather than to row count, and `$__timeFilter` is what lets CrateDB prune partitions. A query
with no time-range macro gets an info notice on the panel saying so.

## Logs template

Grafana's logs panel detects a log frame by column name: the timestamp as `time`, the log
line as `body`, and optionally a severity string as `level`.

```sql
SELECT
  "ts" AS time,
  "message" AS body,
  "level"
FROM "doc"."demo_logs"
WHERE $__timeFilter("ts")
ORDER BY "ts" DESC
LIMIT 1000
```
