# Template variables and ad-hoc filters

## Query variables

A query variable gets the same SQL editor as a panel — schema, table and column autocomplete
plus macro hover — rather than a plain text box.

Variable queries run as table queries and resolve two ways:

- **one column** — its values become the list, used as both label and value
- **a `__text` / `__value` column pair** — `__text` is shown, `__value` is submitted

```sql
SELECT DISTINCT "location" FROM "doc"."demo_metrics" ORDER BY 1
```

```sql
SELECT "name" AS __text, "id" AS __value FROM "doc"."sensors" ORDER BY 1
```

## How values interpolate

Following Grafana's built-in PostgreSQL data source:

- **multi-select or *All*-capable variables** quote every value — `'Berlin','Vienna'` — so
  they drop straight into an `IN (...)` list
- **single-value variables** stay unquoted, so they also work in identifier positions such as
  a table or column name (embedded quotes are still escaped)
- numbers pass through unquoted

Use `${var:sqlstring}` when you need a single-value variable quoted as a literal.

## Multi-select and *All*

`$__conditionalAll` keeps *All* from expanding into a giant `IN` list:

```sql
WHERE $__timeFilter("ts")
  AND $__conditionalAll("location" IN ($location), $location)
```

With a selection this is the condition as written. On *All* it collapses to `1=1`. The
frontend resolves it before the query is sent; the backend applies the same rule for alert
rules, where no frontend interpolation happens.

## Ad-hoc filters

Ad-hoc filters work without setup. Keys are `table.column` pairs read from
`information_schema` in the default schema, values come from a `DISTINCT` query (capped at
1000), and an active filter is injected into the `WHERE` clause of every query that reads
that table.

Columns whose type cannot back an equality predicate — `OBJECT`, `GEO_POINT`, `GEO_SHAPE` and
arrays — are left out of the key list, so the picker only offers filters that produce valid
CrateDB SQL. `OBJECT` sub-columns are kept, since those are individually comparable.

On a large schema, add a dashboard **constant** or **textbox** variable named
`cratedb_adhoc_tables` holding a comma-separated list of table names to narrow which tables
feed the key picker. Names may be schema-qualified.

### Adding the control

On **Grafana 12 and later** the control is called **Filter** and no longer appears in the
variable-type list: use **Edit → + Add → Filter and Group by**, then pick the CrateDB data
source. On older versions it is the *Ad hoc filters* variable type. A dashboard-JSON variable
of `"type": "adhoc"` works on every version.
