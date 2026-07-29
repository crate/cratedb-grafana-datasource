# CrateDB data source for Grafana

[![CI](https://github.com/crate/cratedb-grafana-datasource/actions/workflows/ci.yml/badge.svg)](https://github.com/crate/cratedb-grafana-datasource/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/crate/cratedb-grafana-datasource?include_prereleases)](https://github.com/crate/cratedb-grafana-datasource/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Visualize [CrateDB](https://cratedb.com) data in Grafana: time-series panels, cluster
monitoring from the `sys` schema, logs in Explore, alerting, annotations, and dashboard
variables.

> **Status: pre-release.** Not yet signed or listed in the Grafana plugin catalog; install from
> the zip attached to [GitHub releases](https://github.com/crate/cratedb-grafana-datasource/releases).

## Getting started

1. Install the plugin (unzip into Grafana's plugin directory, or `grafana cli plugins install`
   once it is listed in the catalog) and restart Grafana.
2. Add a **CrateDB** data source: *Connections → Data sources → Add data source*.

   | Option | Default | Notes |
   |---|---|---|
   | Host URL | — | CrateDB node or load balancer as `host:port` (the PostgreSQL wire protocol port, usually 5432) |
   | Default schema | `doc` | Used as `search_path`; `doc` is CrateDB's default schema if none is given at table creation, but tables can live in any schema |
   | Username | `crate` | |
   | Password | empty | Optional; CrateDB's Docker default is trust authentication |
   | TLS/SSL Mode | `disable` | `disable`, `require`, `verify-ca`, `verify-full` |
   | TLS/SSL Method | certificate content | Paste PEM content (stored encrypted), or give paths to certificate files readable by the Grafana server (`sslrootcert`/`sslcert`/`sslkey`) |

   *Additional settings:* connection limits, timeouts, a row limit (caps rows read back per
   query — it doesn't stop CrateDB executing an expensive scan or aggregation server-side, only
   how much of the result set reaches Grafana), autocomplete cache TTL, secure SOCKS proxy.

3. Open the bundled **CrateDB Cluster Health** dashboard (provisioned with the plugin) for a
   view of nodes, heap, disk, shards, and query latency (no separate exporter), or start a
   panel of your own. New queries open in a **visual query builder**: pick a table and the
   plugin completes the recommended time-series aggregation (the time column is guessed from
   the table's metadata), generating

   ```sql
   SELECT
     $__timeGroupAlias("ts", $__interval),
     count(*) AS "value"
   FROM "doc"."demo_metrics"
   WHERE $__timeFilter("ts")
   GROUP BY 1
   ORDER BY 1
   ```

   Aggregating by `$__interval` server-side keeps result sets proportional to panel width rather
   than row count, which matters when panels sit over large tables. The **CrateDB Getting
   Started** dashboard is an example of this pattern, including multi-select variables.

   Switch the editor to **SQL** any time to edit the generated query by hand — and back again:
   the builder state travels with the query, and hand-written SQL that fits the builder's model
   converts into builder state.

   In the builder, the result format follows the chosen flavor (*Table*, *Time series*, *Logs*).
   In the SQL editor it defaults to **Auto**: the result renders as a time series when the first
   selected column is aliased `time` (or uses `$__timeGroupAlias`) and more columns follow, and
   as a table otherwise. Pick *Time series*, *Table*, or *Logs* explicitly to override.

4. To browse log tables (e.g. in Explore), pick the builder's **Logs** flavor — time, message,
   and severity column pickers — or, in the SQL editor, switch the query format to **Logs** and
   alias columns to the names Grafana's logs panel detects — the timestamp as `time`, the log
   line as `body`, and optionally a severity string as `level`:

   ```sql
   SELECT "ts" AS time, "message" AS body, "level"
   FROM "doc"."demo_logs"
   WHERE $__timeFilter("ts")
   ORDER BY "ts" DESC
   LIMIT 1000
   ```

## Why this plugin and not just the PostgreSQL data source?

CrateDB works with Grafana's built-in PostgreSQL data source today, but that generic adapter
drives itself from `pg_catalog` and PostgreSQL idioms CrateDB only partly shares. Pointed at
CrateDB, this plugin does what the PostgreSQL data source can't:

1. **Introspection that works on CrateDB.** Autocomplete and schema browsing read
   `information_schema`, not the `pg_catalog` the PostgreSQL data source relies on (and which
   CrateDB only partially emulates) — dependable schema/table/column completion, the `sys`
   schema for cluster monitoring, and a TTL cache so completion popups don't hammer the cluster.
   It imposes no CrateDB `parse_ident()` / `>= 6.3` floor (see Requirements).
2. **CrateDB-native time-series SQL.** `$__timeGroup` expands to CrateDB's `DATE_BIN` and time
   filters to millisecond-precision literals — CrateDB's own idioms rather than the PostgreSQL
   expressions the generic adapter emits — and macros resolve on the backend, so they hold up in
   alerting. A visual query builder that starts from this pattern (above), an in-editor macro
   cheat sheet, and bundled example dashboards come with it.
3. **CrateDB container types, modeled.** `OBJECT` columns render as structured, expandable JSON,
   and arrays, `GEO`, and `FLOAT_VECTOR` get defined handling — CrateDB types the PostgreSQL data
   source has no converter for.
4. **Ad-hoc filters that only offer usable keys.** Filter keys come from `information_schema` and
   skip columns that can't form a CrateDB equality predicate (`OBJECT`, `GEO`, arrays) while
   keeping `OBJECT` sub-columns — where the generic adapter would surface keys that produce
   invalid filters.
5. **CrateDB-specific connection diagnostics.** Auth, TLS, network, and timeout failures come
   back with concrete fixes, and the config page warns when you point it at CrateDB's HTTP port
   (4200) instead of the PostgreSQL wire port (5432) — the most common connection mistake —
   rather than a raw driver error.

## Requirements

- Grafana >= 12.3 — the frontend externalizes `react/jsx-runtime` to use the host's React (18 on
  12.x, 19 on 13.x) rather than bundling its own; 12.3 is the first Grafana version that provides
  that shared external.
- CrateDB: no hard version floor. This plugin introspects `information_schema` directly and
  speaks the PostgreSQL wire protocol, so it does not depend on `parse_ident()`. (The `>= 6.3`
  floor only applies if you instead use Grafana's built-in PostgreSQL datasource, whose query
  builder relies on `parse_ident()`, added in CrateDB 6.3.0.)

## Macros

| Macro | Expands to (CrateDB SQL) |
|---|---|
| `$__timeFilter(col)` | `"col" >= '<from>' AND "col" <= '<to>'` (millisecond-precision RFC 3339 UTC literals) |
| `$__dateFilter(col)` | `"col" >= '<from-date>' AND "col" <= '<to-date>'` (date-only literals) |
| `$__timeFrom()` / `$__timeTo()` | RFC 3339 UTC literal of the panel range boundary |
| `$__fromTime` / `$__toTime` | typed literal `'<boundary>'::TIMESTAMPTZ` (millisecond precision) |
| `$__timeGroup(col, 1m)` | `DATE_BIN('60 seconds'::INTERVAL, "col", 0)` |
| `$__timeGroupAlias(col, 1m)` | `DATE_BIN('60 seconds'::INTERVAL, "col", 0) AS "time"` |
| `$__unixEpochFilter(col)` | `col >= <from-epoch> AND col <= <to-epoch>` (seconds) |
| `$__unixEpochGroup(col, 1m)` | `FLOOR("col"/60)*60` |
| `$__unixEpochGroupAlias(col, 1m)` | `FLOOR("col"/60)*60 AS "time"` |
| `$__interval_s` | the panel interval as whole seconds (minimum 1) |
| `$__conditionalAll(cond, $var)` | `cond` when the multi-select variable `$var` has a selection, `1=1` for *All* (frontend-side) |
| `$__interval`, `$__interval_ms`, `$__table`, `$__column` | provided by the plugin SDK |

Macros pass the column argument through **verbatim**; the examples show a pre-quoted `"col"`.
Quote mixed-case identifiers yourself, since CrateDB lower-cases unquoted ones.

A `$__timeGroup(...)` used as a bare projection (directly followed by a comma) is shorthand
for `$__timeGroupAlias(...)`, matching the built-in PostgreSQL datasource. The final SQL
after macro expansion is shown under **Query Inspector → Query**.

## Template variables and ad-hoc filters

Query variables get the same SQL editor as panels — schema/table/column autocomplete and macro
hover — instead of a plain text box. Variable queries run as table queries: one column becomes the
value list, a `__text`/`__value` column pair becomes label/value entries. Combine multi-select
variables with
`$__conditionalAll(location IN ($location), $location)` so *All* selects everything without a
giant `IN` list. Multi-select values interpolate as quoted literals (`'Berlin','Vienna'`),
matching the built-in PostgreSQL datasource; single-value variables stay unquoted so they also
work in identifier positions (use `${var:sqlstring}` to force quoting).

[Ad-hoc filters](https://grafana.com/docs/grafana/latest/dashboards/variables/add-template-variables/#add-ad-hoc-filters)
work without extra setup: keys are `table.column` pairs from the default schema (columns whose
type can't back an equality filter — OBJECT, GEO, arrays — are left out), values are fetched
with a `DISTINCT` query, and active filters are applied to every query on that table. On large
schemas, add a dashboard constant or textbox variable named `cratedb_adhoc_tables` with a
comma-separated list of table names to narrow which tables feed the key picker.

To add a filter in the UI: on **Grafana ≥ 12.x** the control was renamed from *Ad hoc filters*
to **Filter** and moved out of the variable-type list — use **Edit → + Add → Filter and Group
by**, then pick the CrateDB data source. On older Grafana it appears as the *Ad hoc filters*
variable type. A dashboard-JSON variable of `"type": "adhoc"` works on every version.

## Development

Building, testing, the dev stack, and CI are covered in
[DEVELOPMENT.md](https://github.com/crate/cratedb-grafana-datasource/blob/main/DEVELOPMENT.md).

## Contributing

Issues and pull requests welcome; the issue forms ask for exactly the details that make
triage fast (version triple, executed query). See
[CONTRIBUTING.md](https://github.com/crate/cratedb-grafana-datasource/blob/main/CONTRIBUTING.md)
for etiquette (CLA, PR conventions); everything technical is in
[DEVELOPMENT.md](https://github.com/crate/cratedb-grafana-datasource/blob/main/DEVELOPMENT.md).

## License

SPDX-License-Identifier: `Apache-2.0`.

Adapted from the [QuestDB Grafana plugin](https://github.com/questdb/grafana-questdb-datasource)
(itself derived from the ClickHouse plugin by Grafana Labs & ClickHouse). See `LICENSE` and `NOTICE`.
