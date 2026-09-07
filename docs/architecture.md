# Architecture

How the CrateDB data source plugin is put together, which decisions shaped it, and how it is
verified. For what the plugin does rather than how, start at the [README](../README.md); for the
case against using Grafana's built-in PostgreSQL data source instead, see
[why-not-postgresql.md](why-not-postgresql.md).

- [1. Summary](#1-summary)
- [2. Why a full plugin rather than a wrapper](#2-why-a-full-plugin-rather-than-a-wrapper)
- [3. Structure](#3-structure)
- [4. CrateDB-specific design](#4-cratedb-specific-design)
- [5. Licensing and attribution](#5-licensing-and-attribution)
- [6. Distribution and CI/CD](#6-distribution-and-cicd)
- [7. Verification](#7-verification)
- [8. Open questions](#8-open-questions)

## 1. Summary

A Grafana data source plugin for CrateDB: mostly declarative glue on top of Grafana's published,
Apache-2.0, officially supported SQL-plugin framework (`grafana-plugin-sdk-go`, `sqlds/v5`,
`@grafana/plugin-ui`) and the `pgx/v5` PostgreSQL driver. It steers every new query toward
server-side time-bucket aggregation, and bundles two dashboards: cluster monitoring from the `sys`
schema, and a Getting Started walkthrough of the query pattern.

CrateDB's earlier HTTP-based Grafana plugins were retired in favour of pointing users at the
built-in PostgreSQL data source, which left CrateDB without a plugin catalog entry and without any
CrateDB-aware guidance in the query editor. This plugin covers both.

## 2. Why a full plugin rather than a wrapper

Wrapping Grafana's own PostgreSQL data source is not available as an implementation strategy:

- **The backend cannot be imported.** Grafana core's postgres backend
  (`pkg/tsdb/grafana-postgresql-datasource`) has no `go.mod` of its own. It is part of the Grafana
  monolith module, and its `standalone/` entry point builds only inside that monorepo.
- **The frontend can be imported, at a licensing cost.** `@grafana/sql` is on npm and the core
  postgres frontend is a thin shim over it, but it is AGPL-3.0-only, versioned in lockstep with
  Grafana core, and has no external adopters. Copyleft into an Apache-2.0 codebase, on an unproven
  seam.
- **Copying the core code** would mean both a fork to maintain and the same AGPL obligation.

What the plugin uses instead is Grafana Labs' published plugin framework, the same stack behind the
QuestDB, Redshift, Athena and Yugabyte data sources:

| Layer | Package | License | What it provides |
|---|---|---|---|
| Plugin protocol | `grafana-plugin-sdk-go` | Apache-2.0 | gRPC lifecycle, macro engine (`sqlutil.Interpolate`), frame marshaling |
| SQL framework | `sqlds/v5` | Apache-2.0 | `Driver`/`Completable` interfaces, query flow, health check, autocomplete resource routes |
| Driver | `pgx/v5` | MIT | The same PostgreSQL wire driver Grafana core uses against CrateDB |
| Frontend | `@grafana/plugin-ui` | Apache-2.0 | SQL editor (Monaco), completion provider plumbing, config components |

Wire-protocol and driver bugs therefore live upstream, in projects their owners maintain. What this
repository owns is the CrateDB-specific surface: macros, type converters, introspection SQL, the
query builder, and the config UI.

**Why Go.** Backend plugins are compiled binaries Grafana spawns over the hashicorp go-plugin gRPC
protocol, and `grafana-plugin-sdk-go` is the only official SDK. Community SDKs in other languages do
not implement the plugin protocol itself; the one non-Go precedent (Materialize, in Rust) had to
write an SDK before it could write a plugin. Go also keeps the integration and end-to-end harnesses
on a single toolchain (testcontainers).

## 3. Structure

```
┌───────────────────────────── Grafana ─────────────────────────────┐
│  panel / explore / alerting                                       │
│      │ SQLQuery {rawSql, format}                                  │
│  frontend plugin (src/)                                           │
│   ├─ datasource.ts     extends DataSourceWithBackend              │
│   │    getDefaultQuery() → visual builder, seeded aggregation     │
│   ├─ QueryEditor.tsx   builder ⇄ SQL shell (stash / reparse)      │
│   │    queryBuilder/*  builderOptions → sqlGenerator → rawSql     │
│   │    SqlEditor.tsx   @grafana/plugin-ui SQLEditor + Monaco      │
│   │    completionProvider → postResource('schemas'|'tables'|      │
│   │                                       'columns')              │
│   ├─ ConfigEditor.tsx  postgres-style layout, CrateDB defaults    │
│   └─ CheatSheet.tsx    macro table + template click-through       │
└──────────────│────────────────────────────────│──────────────────┘
               │ gRPC (plugin protocol)         │ resource routes
┌──────────────▼────────────────────────────────▼──────────────────┐
│  backend plugin binary gpx_cratedb (pkg/)                         │
│   sqlds.SQLDatasource                                             │
│    ├─ Driver (pkg/plugin/driver.go)                               │
│    │    Connect: pgx DSN + search_path + TLS + socks proxy        │
│    │    Macros  ────────► pkg/macros    ($__timeFilter, DATE_BIN) │
│    │    Converters ─────► pkg/converters (pg types → frames)      │
│    └─ Completable (pkg/plugin/completable.go)                     │
│         information_schema queries (incl. sys)                    │
└──────────────────────────────│────────────────────────────────────┘
                               │ PostgreSQL wire protocol (pgx/v5)
                        ┌──────▼──────┐
                        │   CrateDB   │  :5432
                        └─────────────┘
```

**Query lifecycle.** The frontend sends `{rawSql, format}` (`format` encoded numerically, matching
`sqlutil.FormatQueryOption`) → sqlds parses the query model → a wrapped `Interpolator`
(`pkg/main.go`) first rewrites the `$__timeGroup(...),` trailing-comma shorthand in the `SELECT`
list into the aliased form (postgres parity, `pkg/macros/rewrite.go`), then `sqlutil.Interpolate`
expands macros backend-side, so alerting behaves identically → pgx executes → sqlds converts rows to
frames through the plugin's converters → time-series wide-format conversion per `format`, with
missing buckets filled in where `$__timeGroup` asked for a fill value. On the way back, the
frontend's `query()` override stamps an info notice on frames whose SQL carries no time-range macro
(`src/data/queryHints.ts`); queries against `sys.*` are exempt, since those cluster tables are
point-in-time views with no range to filter.

The query model also carries `selectedFormat`, the user's picker choice, which may be *Auto* (the
default for new queries). Auto is resolved into a concrete `format` at **edit time** by a frontend
heuristic (`src/data/formatDetection.ts`, ported from QuestDB): time series when the first
projection is aliased `time` (or uses `$__timeGroupAlias`/`$__unixEpochGroupAlias`, or is a bare
`$__timeGroup(...)` that the backend shorthand aliases) and more columns follow, table otherwise;
`EXPLAIN` always resolves to table. The backend and every query-time path (dashboards, alerting) see
only the resolved value; queries saved before `selectedFormat` existed keep behaving per their
explicit `format`.

Builder queries add two frontend-only fields (`src/types.ts`): `editorType` marks which surface
edits the query, where unset means SQL so pre-builder queries keep working, and `builderOptions`
holds the visual state from which `src/data/sqlGenerator.ts` regenerates `rawSql` on every edit. The
backend contract stays `{rawSql, format}`; the builder's flavor (table / time series / logs) is
written straight into `format`. Switching to SQL stashes `builderOptions` in `meta`; switching back
restores the stash when the SQL is untouched, otherwise `src/data/sqlParser.ts` (pgsql-ast-parser)
re-derives builder state from the SQL, accepting a conversion only when regenerating SQL from it
parses back to the same normalized AST. SQL that neither path can account for prompts before being
replaced.

**Autocomplete lifecycle.** Monaco completion provider → `postResource('tables', {schema})` →
sqlds' auto-registered resource route → `Completable.Tables()` → `information_schema` query →
`["t1","t2",...]` back to the editor. Ad-hoc filter keys ride the same machinery through a custom
`/adhoc-keys` route (`pkg/plugin/adhoc.go`, registered via `sqlds.CustomRoutes`) that excludes
column types an equality filter can't target (OBJECT, GEO, arrays). The query builder's typed
pickers use a second custom route, `/column-meta` (`pkg/plugin/columnmeta.go`), returning name and
data type pairs so filter value editors and the time/log column heuristics know what they are
looking at. Every introspection query runs under the data source's configured query timeout, so an
unresponsive cluster cannot hang an editor session.

## 4. CrateDB-specific design

### Macros (`pkg/macros/macros.go`, mirrored in `src/editor/macros.ts` and `docs/macros.md`)

| Macro | Emitted CrateDB SQL |
|---|---|
| `$__time(ts)` | `"ts" AS "time"` |
| `$__timeEpoch(ts)` | `EXTRACT(EPOCH FROM "ts") AS "time"` |
| `$__timeFilter(ts)` | `"ts" >= '2026-07-03T10:00:00.000Z' AND "ts" <= '2026-07-03T16:00:00.000Z'` (millisecond precision) |
| `$__dateFilter(day)` | `"day" >= '2026-07-03' AND "day" <= '2026-07-04'` (date-only literals) |
| `$__timeFrom()` / `$__timeTo()` | RFC 3339 UTC literal |
| `$__fromTime` / `$__toTime` | `'…'::TIMESTAMPTZ` typed literal, usable in expressions |
| `$__timeGroup(ts, 1m[, fill])` | `DATE_BIN('60 seconds'::INTERVAL, "ts", 0)` |
| `$__timeGroupAlias(ts, 1m[, fill])` | … `AS "time"` |
| `$__unixEpochFilter(ts)` | `ts >= 1783072800 AND ts <= 1783094400` |
| `$__unixEpochFrom()` / `$__unixEpochTo()` | the range boundary as epoch seconds |
| `$__unixEpochNanoFilter(ts)` | the same bound in nanoseconds |
| `$__unixEpochNanoFrom()` / `$__unixEpochNanoTo()` | the range boundary as epoch nanoseconds |
| `$__unixEpochGroup(Alias)(ts, 1m[, fill])` | `FLOOR(ts/60)*60` (… `AS "time"`) |
| `$__interval_s` | panel interval as whole seconds (min 1) |
| `$__conditionalAll(cond, $var)` | `cond`, or `1=1` when `$var` is *All* (see `src/datasource.ts`; backend fallback on the alerting path) |

Design notes:

- Macros pass the column argument through verbatim (the examples show a pre-quoted `"ts"`); a
  mixed-case identifier must be quoted by the author, since CrateDB lower-cases unquoted ones.
- `$__timeFilter` emits millisecond-precision literals: CrateDB timestamps are ms-resolution, so
  second-precision bounds would drop the newest sub-second of rows on live dashboards.
- `DATE_BIN` returns a real `TIMESTAMPTZ`, unlike the epoch-float arithmetic Redshift's macros emit.
  The integer origin literal `0` casts to the epoch, and `DATE_BIN` exists since CrateDB 4.7.0, so
  it is emitted unconditionally and sets the plugin's CrateDB floor. The manual equivalent for older
  clusters, `FLOOR(EXTRACT(EPOCH FROM ts)/N)*N`, returns epoch seconds and is documented but never
  emitted.
- The third argument to the four group macros follows the postgres convention:
  `NULL`, a number, or `previous`. CrateDB cannot generate the missing buckets in SQL, so the
  backend fills them into the frame after the query, across the whole panel range rather than only
  between the first and last returned row.
- A bare `$__timeGroup(...)` followed by a comma is rewritten to the aliased form, matching
  Grafana's built-in PostgreSQL data source. The rewrite is scoped to the `SELECT` list: the same
  text inside `GROUP BY`, or inside an expression, expands as written.
- `$__conditionalAll` and the group macros are normally interpolated frontend-side (template-
  variable state lives in the browser), but each is also registered as a backend macro: on the
  alerting path, where frontend interpolation never ran, `$__conditionalAll` drops to `1=1` and the
  group macros fall back to the query model's interval.

### Type mapping (`pkg/converters/converters.go`)

pg-wire type names as reported by pgx (`DatabaseTypeName`) → frame field types. Notable CrateDB
divergences from stock PostgreSQL:

- **`OBJECT` columns arrive as `JSON`** and are surfaced as structured JSON fields
  (`FieldTypeJSON`), so table panels render them expandable instead of as flat text.
- **Arrays** (including `FLOAT_VECTOR`, which arrives as `_FLOAT4`) are read as their PostgreSQL
  text representation, a pg array literal like `{"1","2","3"}` rather than JSON.
- **Timestamps** are millisecond-precision; converters normalize to UTC.
- `NUMERIC` is arbitrary-precision in CrateDB, read as float64 (frames have no decimal type; pgx
  scans it into `*float64` directly).
- `IP` reports as `VARCHAR` (plain string); `GEO_POINT` reports as `POINT`, which is unmapped and
  falls through to the sqlutil default (string, e.g. `(9.74,47.41)`).

A time-series query whose time column is numeric is still plottable: a column named `time` holding
numbers is read at the resolution its magnitude implies (the 1e9 decade as seconds, 1e18 as
nanoseconds, anything else as milliseconds), the same reading Grafana's built-in SQL data sources
apply.

### Introspection (`pkg/plugin/completable.go`)

Targets `information_schema`: CrateDB's `pg_catalog` emulation is partial while its
`information_schema` is complete, which is why the plugin does not reuse Grafana core's
`parse_ident()`-based `postgresMetaQuery.ts` queries. The `sys` schema is included on purpose:
cluster-monitoring dashboards on `sys.nodes` / `sys.shards` / `sys.jobs_log` are a useful CrateDB
feature; only `information_schema`, `pg_catalog`, and `blob` are hidden. Side effect: CrateDB lists
`OBJECT` sub-columns (`tags['source']`) as rows of `information_schema.columns`, so subscript paths
appear in autocomplete as directly queryable columns.

Results sit behind a TTL cache (`pkg/plugin/schema_cache.go`, default 60s, configurable and
disableable per datasource): Monaco fires completion requests per keystroke, and without a cache
each popup round-trips to `information_schema`.

### Connection settings (`pkg/plugin/settings.go`, `pkg/plugin/driver.go`)

Settings arrive in two shapes and both have to load: the config UI writes JSON numbers, while a
provisioning file may quote them or template them in from an environment variable. Numeric options
accept either, parsed as base 10 so a zero-padded value is not read as octal. An empty `tlsMode`
reads as `disable`, which is what an incompletely provisioned data source produces.

The password never enters the DSN string; it is applied to the parsed pgx config, so an error
message or log line carrying the connection string cannot leak it. Inline PEM certificate material
is applied the same way in `configureTLS`, a CA certificate included under `require` mode, which
lets a `require` connection be pinned to a known CA even though `require` does not verify the
hostname.

### Cluster protection

Four mechanisms keep dashboards from hurting the cluster:

1. The default-query template, which aggregates server-side (see [Query guidance](#query-guidance)).
2. A configurable **row limit** enforced by sqlds while reading result sets
   (`DriverSettings.RowLimit`; `0` falls through to `GF_DATAPROXY_ROW_LIMIT` / the instance's
   `dataproxy.row_limit`).
3. Pool bounds, defaulting to 100 open and 100 idle connections with a 14400-second lifetime, so a
   dashboard full of panels cannot open connections without limit and long-lived connections get
   recycled.
4. The autocomplete schema cache above, plus the query timeout that bounds every introspection
   query.

### Ad-hoc filters and error classification

Dashboard-wide ad-hoc filters (`src/data/adHocFilter.ts`) are injected into the query's own
top-level `WHERE` via a `pgsql-ast-parser` rewrite (`src/data/ast.ts`), so they constrain the raw
rows *before* any `GROUP BY`. Grafana macros are not valid SQL, so they are swapped for
equal-length placeholder identifiers only to locate the clause; the predicate is spliced into the
original string, leaving the macros untouched. An existing `WHERE` is wrapped as
`WHERE (orig) AND (…)` to preserve precedence. Escaping follows PostgreSQL rules, `~`/`!~` map
Grafana's regex operators, and the operator is allowlisted, since it is interpolated verbatim and
settable by a viewer. Keys are `table.column` pairs from the default schema, values from a
`DISTINCT` query (`getTagKeys`/`getTagValues` in `src/datasource.ts`).

Injection needs one unambiguous table to attach the predicate to, so a query whose `FROM` is
anything else runs unfiltered: joins (explicit or comma-separated), CTEs, `UNION`, subqueries, and a
table name supplied by a template variable. The skip is silent: a dashboard that mixes such
queries with single-table ones shows some panels responding to a filter and others not.

Connection failures are classified (`pkg/plugin/connection_error.go`) so "Save & test" and query
inspectors show, e.g., "authentication failed: check the username and password" instead of a raw
SQLSTATE. Auth, TLS (CA/hostname/handshake), DNS, timeout, and refused-connection cases each get an
actionable message, and `MutateQueryError` tags database/network errors as downstream for Grafana's
error attribution.

### Bundled dashboards (`src/dashboards/`, `includes` in `plugin.json`)

Two dashboards ship inside the plugin; Grafana registers `includes` automatically, so users
provision nothing:

- **CrateDB Cluster Health**: nodes, heap, disk, shard states, and slow queries read directly from
  `sys.nodes` / `sys.shards` / `sys.jobs_log`, which is monitoring without a separate exporter and
  the reason the `sys` schema is kept in autocomplete. One CrateDB quirk the queries encode:
  timestamp subtraction yields an `INTERVAL`, which panels cannot plot, so `sys.jobs_log` durations
  are computed as `ended::bigint - started::bigint`.
- **CrateDB Getting Started**: a runnable example of the recommended pattern, where every panel uses
  the `$__timeGroupAlias`/`$__timeFilter` template plus `$__conditionalAll` with a multi-select
  variable. `make seed` loads matching demo tables: `doc.demo_metrics` (partitioned by day, with an
  OBJECT `tags` column), `doc.demo_logs` for the Logs format, `doc.demo_events` for annotations.

Both dashboards double as the plugin screenshots (`src/img/screenshots/`, regenerated via
`make screenshots`).

### Query guidance

Naive queries pull raw rows and can overload a cluster, so four things point the other way:

1. New queries open in the visual builder, seeded with the recommended aggregation: picking a table
   completes a `$__timeGroupAlias` + `$__timeFilter` time series, with the time column guessed from
   column metadata, so the safe pattern is the path of least resistance rather than `SELECT *`.
2. The cheat sheet (query editor help) explains why result sets stay proportional to panel width
   rather than row count, with one-click templates for the SQL editor.
3. Autocomplete works against CrateDB directly, removing the incentive to hand-write unaggregated
   exploratory queries elsewhere.
4. The bundled Getting Started dashboard is a runnable example of the same pattern.

## 5. Licensing and attribution

| Dependency | License | Used |
|---|---|---|
| grafana-plugin-sdk-go | Apache-2.0 | ✔ backend |
| grafana/sqlds/v5 | Apache-2.0 | ✔ backend |
| jackc/pgx/v5 | MIT | ✔ backend |
| testcontainers-go | MIT | ✔ tests |
| @grafana/plugin-ui | Apache-2.0 | ✔ frontend |
| @grafana/data, /runtime, /ui | Apache-2.0 | ✔ frontend |
| **Grafana core** | **AGPL-3.0** | ✘ **no code copied or imported** |
| **@grafana/sql** | **AGPL-3.0** | ✘ **not a dependency** |

The plugin itself is Apache-2.0. Code is adapted from three Apache-2.0 Grafana data source plugins:
QuestDB (pg-wire connection layer, converters, ad-hoc filtering), ClickHouse (visual query builder),
and Redshift (SQL macros, completion provider). `NOTICE` maps each adapted area to its upstream.

## 6. Distribution and CI/CD

- **Plugin id:** `cratedb-cratedb-datasource`, following the catalog convention
  `<orgSlug>-<name>-<type>`. The `cratedb-` prefix has to match Crate.io's verified grafana.com org
  slug.
- **Repo naming:** `cratedb-grafana-datasource`, per the Crate.io ecosystem convention
  (`cratedb-prometheus-adapter`, `cratedb-tableau-connector`); the plugin id is constrained by the
  catalog convention independently of the repo name.
- **Distribution:** an unsigned release archive, installed on self-hosted Grafana by listing the
  plugin id in `allow_loading_unsigned_plugins`; what stands between the plugin and a signature is
  in [the README](../README.md#installation). `@grafana/sign-plugin` is wired up (`make sign`, and
  the `GRAFANA_ACCESS_POLICY_TOKEN` secret in the release workflow) and inert until a token
  exists.
- **Grafana floor:** `>=12.3.0`. All plugins share the host's single React instance; the frontend
  externalizes `react/jsx-runtime` so it uses the host's React (18 on 12.x, 19 on 13.x) instead of
  bundling its own JSX runtime, and 12.3 is the first version that provides that external. QuestDB
  requires 12.3 for the same reason. The npm `@grafana/*` packages track current (13.x) while the
  runtime floor stays 12.3, which is standard practice since those packages are webpack externals
  provided by the user's Grafana at runtime. The discipline it imposes: don't call a 13-only API
  without raising the floor.

**CI/CD.** The workflows are self-owned, built from `grafana/plugin-actions` blocks. The reusable
`grafana/plugin-ci-workflows` pipeline is Grafana-org-internal (custom runner labels, GAR/GCS
infrastructure, no external adopters), so it is not usable from another org; QuestDB sets the
external precedent.

- `ci.yml` — per PR: lint/unit/build → testcontainers integration and e2e across a CrateDB version
  matrix → a `@critical` Playwright browser smoke on current Grafana, uploading an installable zip
  per run (`make package`, a convenience artifact for test-driving PRs, not a release). The full
  Grafana version matrix and browser suite run on a monthly drift cron.
- `codeql.yml`, `secret-scan.yml` (Trufflehog), `bundle-stats.yml` (PR bundle-size report) — code,
  secret, and bundle-size scanning.
- `cp-update.yml` — opens a PR when `@grafana/create-plugin` ships tooling updates.
- Release (tag-driven, gated): `v*` tag → verify job (build + integration + e2e) →
  `grafana/plugin-actions/build-plugin` → plugin-validator → **draft** GitHub release with zip +
  sha1 and release notes from the tagged CHANGELOG section. `build-plugin` skips signing when
  `GRAFANA_ACCESS_POLICY_TOKEN` is absent, which is how releases ship; adding the secret activates
  signing. Publishing the draft stays manual (see `RELEASE.md`).

## 7. Verification

Four automated tiers, all wired into CI (see `Makefile` / `.github/workflows/ci.yml`):

| Tier | Command | Covers |
|---|---|---|
| Unit | `make test` | Macro emissions (golden strings plus a full `sqlutil.Interpolate` round trip), converters, settings/DSN parsing, error classification, schema cache, ad-hoc filter SQL generation, `$__conditionalAll`. No containers. |
| Integration | `make test-integration` | The driver in-process against a real CrateDB (testcontainers): connect and execute the interpolated default template, no Grafana or `dist/` needed. Runs across a CrateDB version matrix in CI (6.3, latest, nightly). |
| Go e2e | `make e2e` | The **deployed** plugin through Grafana's API: health checks, `/api/ds/query` with macros (including the backend-side `$__interval` alerting path and a provisioned alert rule), autocomplete resource routes (asserting empty results serialize as `[]`, not `null`), frame field types (incl. OBJECT as structured JSON), time-series frame shape. Hermetic (testcontainers boots CrateDB + Grafana with `dist/` mounted) or attached to a `make up` stack via `GRAFANA_URL`. |
| Browser smoke | `make e2e-browser` | Playwright and `@grafana/plugin-e2e` against the compose stack (boots and seeds it), in CI across a Grafana version matrix (the `12.3` floor and current stable): config editor renders and "Save & test" succeeds (and fails actionably for an unreachable host), query editor loads Monaco with the default template, a seeded query returns data, bundled dashboards provision and render. |

Two release gates complement the tiers: `make validate` packages `dist/` and runs
`@grafana/plugin-validator` on the zip, the same checks grafana.com applies on catalog submission
and the release workflow runs, and `make screenshots` regenerates the plugin screenshots from the
seeded dev stack.

Design decisions the tiers encode:

- CrateDB accepts plaintext connections even with `ssl.psql.enabled` unless HBA demands `ssl: on`,
  so TLS mode semantics are enforced client-side by sslmode.
- Grafana ≥13 restricts anonymous auth to Viewer, so admin-API interactions (e2e, screenshots)
  authenticate as `admin:admin`.
- The browser-smoke matrix confirms rendering on both 12.3 (React 18) and current (React 19), which
  is what the `react/jsx-runtime` external in [§6](#6-distribution-and-cicd) buys.
- mTLS (HBA `method: cert`) is supported in configuration but not covered by a test tier.

## 8. Open questions

- **mTLS (client-certificate authentication)**: the plugin can send a client cert/key pair (PEM
  content or file paths, configurable in the UI and via provisioning), but no test tier exercises a
  CrateDB HBA `method: cert` setup. Low priority; password with TLS covers the common deployment.
- **`sys` schema in autocomplete**: included by design; revisit as a config toggle if users find it
  noisy.
- **sqlds release cadence**: the API surface consumed (Driver, Completable, DriverSettings) is small
  and stable across v4→v5.

Planned work, and the reason each item is not in this release, is in [ROADMAP.md](../ROADMAP.md).
