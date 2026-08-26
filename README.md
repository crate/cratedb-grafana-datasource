# CrateDB data source for Grafana

[![CI](https://github.com/crate/cratedb-grafana-datasource/actions/workflows/ci.yml/badge.svg)](https://github.com/crate/cratedb-grafana-datasource/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/crate/cratedb-grafana-datasource?include_prereleases)](https://github.com/crate/cratedb-grafana-datasource/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/crate/cratedb-grafana-datasource/blob/main/LICENSE)

Query and visualize [CrateDB](https://cratedb.com) in Grafana over the PostgreSQL wire protocol —
time-series panels, cluster monitoring from the `sys` schema, logs in Explore, alerting,
annotations, and dashboard variables.

Pick a table and the visual query builder completes the time-series query CrateDB wants,
`DATE_BIN` bucketing and partition-pruning time filter included:

![The visual query builder: a table pick produces a bucketed time-series query, and the panel renders it](https://raw.githubusercontent.com/crate/cratedb-grafana-datasource/main/src/img/screenshots/query-builder.png)

> **Early release.** Version 0.1.0 is the plugin's first public version. It is exercised by an
> automated test suite against several CrateDB and Grafana versions, but it has not yet seen wide
> production use — bug reports and feedback are especially welcome.

## Overview

- **Visual query builder and SQL, both ways.** New queries open in a builder with *Table*, *Time
  series* and *Logs* flavors — schema and table pickers, typed filter rows, aggregations with
  grouping, ordering and limits. Switch to SQL to edit by hand and back again: builder state
  travels with the query, and hand-written SQL that fits the builder's model converts back into
  builder state.
- **A SQL editor that knows your cluster.** Schema, table and column autocomplete from
  `information_schema` (including `sys`), macro completion and hover documentation, an in-editor
  cheat sheet, and Ctrl/Cmd+Enter to run.
- **CrateDB-native time-series macros.** `$__timeGroup` becomes `DATE_BIN`, time filters become
  millisecond-precision literals. Macros resolve on the backend, so alert rules expand them the
  same way panels do.
- **Cluster monitoring with no exporter.** The bundled *CrateDB Cluster Health* dashboard reads
  `sys.nodes`, `sys.shards` and `sys.jobs_log` directly.
- **CrateDB types, modeled.** `OBJECT` columns surface as structured, expandable JSON; arrays,
  `GEO` and `FLOAT_VECTOR` come through in their CrateDB text form rather than as errors.
- **Template variables and ad-hoc filters.** Variable queries get the full SQL editor;
  dashboard-wide filters offer only columns that can back a valid CrateDB predicate.
- **Diagnostics that name the fix.** Authentication, TLS, network and timeout failures come back
  as actionable messages, and the config page catches the classic mistake of pointing at CrateDB's
  HTTP port instead of the PostgreSQL one.

Two dashboards ship with the plugin.

![CrateDB Cluster Health dashboard](https://raw.githubusercontent.com/crate/cratedb-grafana-datasource/main/src/img/screenshots/cluster-health.png)

*CrateDB Cluster Health* — nodes, heap, disk, shards and query latency, read straight from `sys`.

![CrateDB Getting Started dashboard](https://raw.githubusercontent.com/crate/cratedb-grafana-datasource/main/src/img/screenshots/getting-started.png)

*CrateDB Getting Started* — the recommended query pattern end to end, including an `OBJECT`
column, a logs panel and annotations.

## Requirements

- **Grafana 12.3 or later.** The frontend uses the host's React through the shared
  `react/jsx-runtime` external (React 18 on Grafana 12.x, 19 on 13.x) rather than bundling its own;
  12.3 is the first version to provide it.
- **Any CrateDB version.** The plugin introspects `information_schema` directly and speaks the
  PostgreSQL wire protocol, so it has no `parse_ident()` dependency and no version floor. (The
  `>= 6.3` floor applies only to Grafana's built-in PostgreSQL data source, whose query builder
  needs `parse_ident()`.)

## Installation

The plugin is not yet listed in the Grafana plugin catalog, so it installs from a release archive
and Grafana has to be told to load it unsigned. That works on **self-hosted Grafana (OSS or
Enterprise)**; **Grafana Cloud does not run unsigned plugins**, and offers no override.

<details>
<summary><b>Install on self-hosted Grafana</b></summary>

1. Download the archive from [Releases](https://github.com/crate/cratedb-grafana-datasource/releases)
   and extract it into Grafana's plugin directory (default `/var/lib/grafana/plugins`).

2. Allow the plugin id — in `grafana.ini`:

   ```ini
   [plugins]
   allow_loading_unsigned_plugins = cratedb-cratedb-datasource
   ```

   or, for the Docker image:

   ```
   GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=cratedb-cratedb-datasource
   ```

3. Restart Grafana.

The plugin page carries an *unsigned* badge, and updates do not arrive through the Grafana UI —
watch this repository's releases. Grafana's
[plugin signatures](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-sign/)
documentation covers the mechanics.

</details>

<details>
<summary><b>Why unsigned, and what about Grafana Cloud?</b></summary>

Grafana's [plugin policy](https://grafana.com/legal/plugins/) places a plugin offered by a
for-profit business at the *Commercial* signature level, which requires a paid Commercial Plugin
Subscription with Grafana Labs. That isn't in place yet. Until it is, there are no signed builds,
and so no Grafana Cloud support either.

[Private signing](https://grafana.com/developers/plugin-tools/publish-a-plugin/sign-a-plugin) is
tied to a single instance's `root_url` and accepts no wildcards, so no build can be pre-signed for
everyone. Where a security policy demands a signature, sign the plugin against your own instance
with a free Grafana Cloud token.

If Grafana Cloud support matters to you, say so in an
[issue](https://github.com/crate/cratedb-grafana-datasource/issues) — demand is what would justify
a signed, catalog-listed release.

</details>

## Getting started

**1. [Install the plugin](#installation)** and restart Grafana.

**2. Add the data source** at *Connections → Data sources → Add data source → CrateDB*.

| Option | Default | Notes |
|---|---|---|
| Host URL | — | CrateDB node or load balancer as `host:port`. Use the **PostgreSQL wire port, usually 5432** — not the HTTP port 4200 |
| Default schema | `doc` | Applied as `search_path`. `doc` is where CrateDB puts tables created without a schema, but tables can live anywhere |
| Username | `crate` | |
| Password | empty | Optional — CrateDB's Docker default is trust authentication |
| TLS/SSL Mode | `disable` | `disable`, `require`, `verify-ca`, `verify-full` |
| TLS/SSL Method | certificate content | Paste PEM content (stored encrypted), or give paths to certificate files readable by the Grafana server |

Under *Additional settings*: connection limits, timeouts, autocomplete cache TTL, secure SOCKS
proxy, and a row limit. The row limit caps how much of a result set reaches Grafana; it does not
stop CrateDB from executing an expensive scan or aggregation server-side.

A panel can run any SQL the connected user is allowed to, including writes and DDL. Connect with a
read-only user — `GRANT DQL ON SCHEMA doc TO grafana;`.

**3. Build a query.** New panels open in the builder. Choosing a table is enough to produce the
recommended aggregation — the time column is inferred from the table's metadata:

```sql
SELECT
  $__timeGroupAlias("ts", $__interval),
  count(*) AS "value"
FROM "doc"."demo_metrics"
WHERE $__timeFilter("ts")
GROUP BY 1
ORDER BY 1
```

Bucketing by `$__interval` server-side keeps the result set proportional to panel width rather
than to row count, which is what makes panels over large tables viable. `$__timeFilter` is what
lets CrateDB prune partitions.

The result format follows the builder flavor you pick. In the SQL editor it defaults to **Auto**:
a time series when the first column is aliased `time` (or uses `$__timeGroupAlias`) and more
columns follow, a table otherwise. Override with *Time series*, *Table* or *Logs* at any time.

**4. Browse logs** in Explore with the builder's *Logs* flavor — time, message and severity column
pickers — or in SQL by aliasing columns to `time`, `body` and optionally `level`.

**5. Open the bundled dashboards.** *CrateDB Cluster Health* and *CrateDB Getting Started* ship
with the plugin and appear under the data source's *Dashboards* tab.

To see all of it running against seeded demo data without installing anything but Docker, follow
[Try it locally](https://github.com/crate/cratedb-grafana-datasource/blob/main/DEVELOPMENT.md#try-it-locally).

## Documentation

- [Macros](https://github.com/crate/cratedb-grafana-datasource/blob/main/docs/macros.md) — the full
  set, what each expands to, and the query templates
- [Template variables and ad-hoc filters](https://github.com/crate/cratedb-grafana-datasource/blob/main/docs/variables.md)
- [Why this plugin and not the PostgreSQL data source?](https://github.com/crate/cratedb-grafana-datasource/blob/main/docs/why-not-postgresql.md)
- [CrateDB documentation](https://cratedb.com/docs)
- [Development](https://github.com/crate/cratedb-grafana-datasource/blob/main/DEVELOPMENT.md) —
  building, the test tiers, the dev stack, CI

## Contributing

Bug reports, feature requests and pull requests are all welcome. The issue forms ask for exactly
the details that make triage fast — the plugin/Grafana/CrateDB version triple and the executed
query. If you are not sure something is a bug, the
[CrateDB community forum](https://community.cratedb.com) is a good first stop.

See [CONTRIBUTING.md](https://github.com/crate/cratedb-grafana-datasource/blob/main/CONTRIBUTING.md)
for the CLA and pull-request conventions, and
[SECURITY.md](https://github.com/crate/cratedb-grafana-datasource/blob/main/SECURITY.md) for
reporting vulnerabilities privately.

## License

Apache-2.0. Adapted from the
[QuestDB](https://github.com/questdb/grafana-questdb-datasource),
[ClickHouse](https://github.com/grafana/clickhouse-datasource) and
[Redshift](https://github.com/grafana/redshift-datasource) Grafana data source plugins — see
[NOTICE](https://github.com/crate/cratedb-grafana-datasource/blob/main/NOTICE) for what came from
where.
