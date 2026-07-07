# CrateDB data source for Grafana

Grafana data source plugin for [CrateDB](https://cratedb.com), the distributed SQL database for
time series, documents, and vectors.

CrateDB speaks the PostgreSQL wire protocol, and this plugin builds on the same foundations
Grafana's own SQL data sources use — the [Grafana plugin SDK](https://github.com/grafana/grafana-plugin-sdk-go),
the [sqlds](https://github.com/grafana/sqlds) SQL data source framework, and the
[pgx](https://github.com/jackc/pgx) driver — with CrateDB-specific type mapping, time-series
macros, and schema autocomplete on top.

> **Status: skeleton / pre-alpha.** The Go backend compiles and its unit tests pass; the
> frontend typechecks, lints and builds a production bundle. Nothing has run against a live
> CrateDB/Grafana yet — see [docs/architecture.md](docs/architecture.md) for the design and
> the spike plan.

## Why a dedicated plugin?

CrateDB works with Grafana's built-in PostgreSQL data source today. This plugin exists to:

1. Give CrateDB a first-class, discoverable presence in the Grafana plugin catalog.
2. Guide users toward cluster-friendly time-series queries: every new query starts from a
   template that aggregates server-side via `$__timeGroupAlias`, instead of pulling raw rows.
3. Provide autocomplete tuned to CrateDB's `information_schema` (including the `sys` schema
   for cluster monitoring dashboards).

## Requirements

- Grafana >= 11.6
- CrateDB >= 6.3 (earlier versions work, but query-builder-style column introspection in the
  PostgreSQL-compatible tooling relies on `parse_ident()`, added in 6.3.0)

## Configuration

| Option | Default | Notes |
|---|---|---|
| Server address | — | Hostname of a CrateDB node (or load balancer) |
| Port | `5432` | CrateDB's PostgreSQL wire protocol port |
| Username | `crate` | |
| Password | empty | Optional; CrateDB's Docker default is trust authentication |
| Default schema | `doc` | Used as `search_path`; CrateDB user tables live in `doc` |
| TLS mode | `disable` | `disable`, `require`, `verify-ca`, `verify-full` |

## Macros

| Macro | Expands to (CrateDB SQL) |
|---|---|
| `$__timeFilter(col)` | `"col" >= '<from>' AND "col" <= '<to>'` (RFC 3339 UTC literals) |
| `$__timeFrom()` / `$__timeTo()` | RFC 3339 UTC literal of the panel range boundary |
| `$__timeGroup(col, 1m)` | `DATE_BIN('60 seconds'::INTERVAL, "col", 0)` |
| `$__timeGroupAlias(col, 1m)` | `DATE_BIN('60 seconds'::INTERVAL, "col", 0) AS "time"` |
| `$__unixEpochFilter(col)` | `col >= <from-epoch> AND col <= <to-epoch>` (seconds) |
| `$__unixEpochGroup(col, 1m)` | `FLOOR("col"/60)*60` |
| `$__unixEpochGroupAlias(col, 1m)` | `FLOOR("col"/60)*60 AS "time"` |
| `$__interval`, `$__interval_ms`, `$__table`, `$__column` | provided by the plugin SDK |

The default query for new panels:

```sql
SELECT
  $__timeGroupAlias("ts", $__interval),
  count(*) AS value
FROM "doc"."my_table"
WHERE $__timeFilter("ts")
GROUP BY 1
ORDER BY 1
```

Aggregating by `$__interval` server-side keeps result sets proportional to pixels, not rows —
important when panels sit on top of billions of records.

## Development

```bash
make install   # yarn install + go mod download
make build     # backend binaries (all platforms) + frontend bundle → dist/
make check     # lint (gofmt, vet, eslint, tsc) + unit tests
make up        # dev stack: Grafana (:3000, anonymous admin) + CrateDB (:4200 HTTP, :5432 pg)
```

`make help` lists all targets (watch mode, integration tests, signing, …). The Makefile
handles the toolchain quirks: Yarn 4 is required by `@grafana/plugin-ui` and resolved via a
pinned `npx` fallback when no local yarn 4 exists, and `mage` falls back to `go run` when not
installed.

The compose stack provisions the plugin from `./dist` (unsigned loading enabled) and a
datasource pointing at the CrateDB container. On ARM machines use
`CRATEDB_VERSION=nightly` (release images are amd64-only).

Note: `src/img/logo.svg` is a placeholder — replace with the official CrateDB brand asset
before any release.

## License

Apache-2.0. Adapted from the [QuestDB Grafana plugin](https://github.com/questdb/grafana-questdb-datasource)
(itself derived from the ClickHouse plugin by Grafana Labs & ClickHouse). Contains no code from
the Grafana core repository (AGPL-3.0). See `LICENSE` and `NOTICE`.
