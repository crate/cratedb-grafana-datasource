# Changelog

## 0.1.0 (unreleased)

Initial release.

- **Data source**: CrateDB over the PostgreSQL wire protocol (pgx), with trust/password auth,
  TLS (`disable`/`require`/`verify-ca`/`verify-full`, inline PEM material or server-side
  certificate file paths), connection pool tuning, and secure SOCKS proxy support. The config
  screen mirrors the built-in PostgreSQL data source's layout (Connection / Authentication /
  TLS/SSL Auth Details / Additional settings) so postgres users feel at home.
- **Time-series macros**: `$__timeFilter` (millisecond precision), `$__dateFilter`,
  `$__timeFrom`/`$__timeTo`, `$__fromTime`/`$__toTime`, `$__timeGroup(Alias)`
  (DATE_BIN-based), `$__unixEpochFilter`/`Group(Alias)`, `$__interval_s`, and
  `$__conditionalAll`. Most resolve backend-side, so alerting works identically.
- **Query editor**: SQL editor with schema/table/column autocomplete (CrateDB
  `information_schema`, including `sys`), macro completion, hover docs on macros, a cheat
  sheet, Ctrl/Cmd+Enter to run, and a cluster-friendly default query template. The result
  format defaults to *Auto*, which infers time series vs. table from the query shape and
  shows what it resolved to; explicit overrides remain available. A `$__timeGroup(...)`
  used as a bare projection is shorthand for the aliased form, and `EXPLAIN` queries
  render as tables.
- **Query guidance**: an info notice on panels whose query has no time-range macro (no
  partition pruning), a fallback message when autocomplete introspection fails, and a
  config-page warning when the host URL points at CrateDB's HTTP port instead of the
  PostgreSQL port.
- **Template variables & ad-hoc filters**: query variables use the same SQL editor as panels
  (autocomplete + macro hover, via `CustomVariableSupport`) rather than a bare text box, and
  resolve as value or text/value (`__text`/`__value`) pairs;
  multi-select via `$__conditionalAll`, and dashboard-wide ad-hoc filters. Filter keys skip
  column types that can't back an equality filter (OBJECT, GEO, arrays), and a
  `cratedb_adhoc_tables` dashboard variable narrows the key picker on large schemas.
- **Type mapping**: CrateDB `OBJECT` columns surface as structured JSON fields (expandable
  in table panels); arrays keep their PostgreSQL text form.
- **Logs**: a *Logs* query format renders rows as log lines (e.g. in Explore); alias columns
  as `time`, `body`, and optionally `level` (see the cheat sheet's logs template).
- **Bundled dashboards**: *CrateDB Cluster Health* (`sys`-schema monitoring, no separate
  exporter) and *CrateDB Getting Started* (the recommended query pattern plus an OBJECT
  column, a Logs-format panel, and an annotation query — all runnable against the dev
  stack's seeded demo tables).
- **Cluster protection**: configurable row limit and a TTL cache for autocomplete
  introspection.
- **Diagnostics**: actionable connection error messages (auth / TLS / network / timeout) on
  the config page and downstream error attribution for queries.
