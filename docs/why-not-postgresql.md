# Why this plugin and not the PostgreSQL data source?

CrateDB speaks the PostgreSQL wire protocol, so Grafana's built-in PostgreSQL data source
connects to it. But that adapter drives itself from `pg_catalog` and PostgreSQL idioms which
CrateDB only partly shares. Pointed at CrateDB, this plugin does what the generic one cannot.

**1. Introspection that works on CrateDB.** Autocomplete and schema browsing read
`information_schema`, not the `pg_catalog` the PostgreSQL data source relies on and which
CrateDB only partially emulates. That yields dependable schema, table and column completion,
keeps the `sys` schema available for cluster monitoring, and puts a TTL cache in front of
introspection so completion popups don't hammer the cluster. It also imposes no CrateDB
`parse_ident()` floor — see [Requirements](../README.md#requirements).

**2. CrateDB-native time-series SQL.** `$__timeGroup` expands to CrateDB's `DATE_BIN` and time
filters to millisecond-precision literals — CrateDB's own idioms rather than the PostgreSQL
expressions the generic adapter emits. Macros resolve on the backend, so they hold up in
alerting. A visual query builder that starts from this pattern, an in-editor macro cheat
sheet, and bundled example dashboards come with it.

**3. CrateDB container types, modeled.** `OBJECT` columns render as structured, expandable
JSON, and arrays get defined handling — types the PostgreSQL data source has no converter for.

**4. Ad-hoc filters that only offer usable keys.** Filter keys come from `information_schema`
and skip columns that cannot form a CrateDB equality predicate (`OBJECT`, `GEO`, arrays) while
keeping `OBJECT` sub-columns. The generic adapter would surface keys that produce invalid
filters.

**5. CrateDB-specific connection diagnostics.** Authentication, TLS, network and timeout
failures come back with a concrete fix rather than a raw driver error, and the config page
warns when the host URL points at CrateDB's HTTP port (4200) instead of the PostgreSQL wire
port (5432) — the most common connection mistake.
