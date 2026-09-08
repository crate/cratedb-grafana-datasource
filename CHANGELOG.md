# Changelog

## 0.1.0 (unreleased)

Initial release.

- **Data source**: CrateDB over the PostgreSQL wire protocol (pgx), with trust/password auth,
  TLS (`disable`/`require`/`verify-ca`/`verify-full`, inline PEM material or server-side
  certificate file paths), connection pool tuning with the PostgreSQL data source's defaults
  (100 open, 100 idle, 4-hour lifetime), and secure SOCKS proxy support. The config
  screen mirrors the built-in PostgreSQL data source's layout (Connection / Authentication /
  TLS/SSL Auth Details / Additional settings) so postgres users feel at home.
- **Time-series macros**: `$__timeFilter` (millisecond precision), `$__dateFilter`,
  `$__timeFrom`/`$__timeTo`, `$__fromTime`/`$__toTime`, `$__time`, `$__timeEpoch`,
  `$__timeGroup(Alias)` (DATE_BIN-based, with an optional fill argument: `NULL`, a number, or
  `previous` fills the buckets a query returned no rows for), `$__unixEpochFilter`,
  `$__unixEpochFrom`/`To`, `$__unixEpochGroup(Alias)`, the nanosecond `$__unixEpochNano*` forms,
  `$__interval_s`, and `$__conditionalAll`. A numeric column named `time` in a time-series query
  becomes the time axis, its unit read from its magnitude as in the PostgreSQL data source, and
  a label column beside it splits the result into one series per label. Most macros resolve
  backend-side, so alerting works identically.
- **Visual query builder**: new queries open in a builder with Table, Time series, and Logs
  flavors — schema/table pickers backed by `information_schema`, typed filter rows, aggregations
  with grouping, order/limit. Picking a table is enough to produce the recommended
  `$__timeGroupAlias`/`$__timeFilter` aggregation: the time column (and, for logs, the
  message/level columns) is guessed from column metadata. Builder ⇄ SQL switching is two-way:
  the builder state rides along the query, and hand-written SQL is parsed back into builder
  state when it fits the builder's model — anything it can't represent asks before being
  replaced.
- **Query editor**: SQL editor with schema/table/column autocomplete (CrateDB
  `information_schema`, including `sys`), macro completion, hover docs on macros, a cheat
  sheet, and Ctrl/Cmd+Enter to run. The result
  format defaults to *Auto*, which infers time series vs. table from the query shape and
  shows what it resolved to; explicit overrides remain available. A `$__timeGroup(...)`
  used as a bare projection is shorthand for the aliased form, and `EXPLAIN` queries
  render as tables.
- **Query guidance**: an info notice on panels whose query has no time-range macro (no
  partition pruning; `sys` tables are exempt), a fallback message when autocomplete
  introspection fails, and a config-page warning when the host URL points at CrateDB's HTTP
  port instead of the PostgreSQL port.
- **Template variables & ad-hoc filters**: query variables use the same SQL editor as panels
  (autocomplete + macro hover, via `CustomVariableSupport`) rather than a bare text box, and
  resolve as value or text/value (`__text`/`__value`) pairs;
  multi-select via `$__conditionalAll`, and dashboard-wide ad-hoc filters applied to queries
  that read one plain table. Filter keys skip
  column types that can't back an equality filter (OBJECT, GEO, arrays), and a
  `cratedb_adhoc_tables` dashboard variable narrows the key picker on large schemas.
- **Type mapping**: CrateDB `OBJECT` columns surface as structured JSON fields, which a table
  panel's cell inspector opens in full; arrays keep their PostgreSQL text form.
- **Logs**: a *Logs* query format renders rows as log lines (e.g. in Explore); alias columns
  as `time`, `body`, and optionally `level` (see the cheat sheet's logs template). Explore's
  logs-volume histogram runs as a full-range aggregation (severity-bucketed when a level
  column is present) instead of bucketing only the returned lines — for hand-written SQL too,
  via the SQL-to-builder parser.
- **Bundled dashboards**: *CrateDB Cluster Health* (`sys`-schema monitoring, no separate
  exporter) and *CrateDB Getting Started* (the recommended query pattern plus an OBJECT
  column, a Logs-format panel, and an annotation query — all runnable against the dev
  stack's seeded demo tables).
- **Turnkey demo stack**: `docker compose up` on a clone builds the plugin, starts CrateDB,
  seeds the demo tables, and serves Grafana with the data source provisioned and both bundled
  dashboards populated. Docker is the only host requirement.
- **Cluster protection**: configurable row limit and a TTL cache for autocomplete
  introspection.
- **Diagnostics**: actionable connection error messages (auth / TLS / network / timeout) on
  the config page and downstream error attribution for queries.
- **Documentation**: provisioning reference, annotation column convention, a migration guide
  from the PostgreSQL data source, the design document, and a roadmap.
