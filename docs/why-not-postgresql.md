# Why this plugin and not the PostgreSQL data source?

CrateDB speaks the PostgreSQL wire protocol, so Grafana's built-in PostgreSQL data source
connects to it. But that adapter drives itself from `pg_catalog` and PostgreSQL idioms which
CrateDB only partly shares. Pointed at CrateDB, this plugin does what the generic one cannot.

**1. Introspection that works on CrateDB.** Autocomplete and schema browsing read
`information_schema`; the PostgreSQL data source relies on `pg_catalog`, which CrateDB only
partially emulates. That yields dependable schema, table and column completion,
keeps the `sys` schema available for cluster monitoring, and puts a TTL cache in front of
introspection so completion popups don't hammer the cluster. It also imposes no CrateDB
`parse_ident()` floor — see [Requirements](../README.md#requirements).

**2. CrateDB-native time-series SQL.** `$__timeGroup` expands to CrateDB's `DATE_BIN` and time
filters to millisecond-precision literals, where the generic adapter emits PostgreSQL
expressions CrateDB has to emulate. Macros resolve on the backend, so they hold up in
alerting. A visual query builder that starts from this pattern, an in-editor macro cheat
sheet, and bundled example dashboards come with it.

**3. CrateDB container types, modeled.** `OBJECT` columns render as structured, expandable
JSON, and arrays get defined handling — types the PostgreSQL data source has no converter for.

**4. Ad-hoc filters that only offer usable keys.** Filter keys come from `information_schema`
and skip columns that cannot form a CrateDB equality predicate (`OBJECT`, `GEO`, arrays) while
keeping `OBJECT` sub-columns. The generic adapter would surface keys that produce invalid
filters.

**5. CrateDB-specific connection diagnostics.** Authentication, TLS, network and timeout
failures each come back with a concrete fix in place of the raw driver error, and the config page
warns when the host URL points at CrateDB's HTTP port (4200) instead of the PostgreSQL wire
port (5432) — the most common connection mistake.

## Migrating from the PostgreSQL data source

### Repointing existing dashboards

In the UI, open each panel and pick the CrateDB data source from the query editor's data source
picker; the SQL carries over untouched.

In dashboard JSON, replace the data source reference wherever it appears (panel level, target
level, annotations, template variables):

```json
{ "type": "grafana-postgresql-datasource", "uid": "<postgres-uid>" }
```

becomes

```json
{ "type": "cratedb-cratedb-datasource", "uid": "<cratedb-uid>" }
```

Older dashboards may carry `"type": "postgres"`, the id the built-in data source used before
Grafana 10.

### Configuration fields

| PostgreSQL data source | CrateDB data source |
|---|---|
| Host URL | Host URL, pointing at the PostgreSQL wire port (usually 5432), not CrateDB's HTTP port 4200 |
| Database name | Default schema. CrateDB has a single database and organizes tables by schema, so this field sets `search_path` and defaults to `doc` |
| User, Password | Username, Password. CrateDB's default authentication is trust, so the password may be empty |
| TLS/SSL Mode | TLS/SSL Mode, with the same `disable` / `require` / `verify-ca` / `verify-full` values |
| TLS/SSL Method | TLS/SSL Method, with the same choice between pasted PEM content and server-side file paths |
| Max open, Max idle, Max lifetime | Same three fields under *Additional settings* |
| Min time interval | Min time interval |
| Version, TimescaleDB | no equivalent; this plugin does not vary its SQL by server version |
| — | Row limit, query timeout, autocomplete cache TTL, secure SOCKS proxy |

### Macros

| Macro | Behaviour here |
|---|---|
| `$__time`, `$__timeEpoch` | identical |
| `$__timeFilter`, `$__timeFrom`, `$__timeTo` | same range semantics; the literals carry millisecond precision |
| `$__unixEpochFilter`, `$__unixEpochFrom`, `$__unixEpochTo` | identical |
| `$__unixEpochNanoFilter`, `$__unixEpochNanoFrom`, `$__unixEpochNanoTo` | identical |
| `$__unixEpochGroup`, `$__unixEpochGroupAlias` | identical |
| `$__timeGroup`, `$__timeGroupAlias` | bucket boundaries match, the column type does not: CrateDB's `DATE_BIN` returns a `TIMESTAMPTZ` where PostgreSQL's `floor(extract(epoch from …))` returns a number. A panel plots either; a query that did arithmetic on the bucket value needs adjusting |
| `$__searchFilter` | unsupported, planned for 0.2. Grafana leaves the token in the query as literal text, so the usual `LIKE '$__searchFilter'` pattern compares against that string and returns no rows |

The plugin also adds macros the built-in data source has no equivalent for — `$__dateFilter`,
`$__fromTime`, `$__toTime`, `$__interval_s` and `$__conditionalAll`. They are covered in
[Macros](macros.md).
