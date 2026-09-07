# Annotations

An annotation query is a SQL query whose rows Grafana draws as event markers across a panel's time
axis. Add one under *Dashboard settings → Annotations → New annotation query*, pick the CrateDB
data source, and write the query in the same editor panels use.

Switch that editor to SQL and set *Format* to *Table*: an annotation is a row set read by column
name. A new query opens in the visual builder with the *Time series* format, which reshapes the
result into a series.

## Columns

Grafana reads the annotation by column name, so the query has to alias its projections:

| Column | Required | Meaning |
|---|---|---|
| `time` | yes | event timestamp, or the start of a region |
| `timeEnd` | no | end of a region; omit it and the event draws as a single marker |
| `text` | no | body of the tooltip |
| `tags` | no | comma-separated tag string |

Column order does not matter and extra columns are ignored. Filter by the panel range with
`$__timeFilter`, the same as in a panel query.

## Tags from a CrateDB array

`tags` has to arrive as a single comma-separated string. A CrateDB `ARRAY` column comes through in
its PostgreSQL text form (`{alpha,beta}`), which Grafana reads as one tag, so convert it in SQL:

```sql
array_to_string("tags", ',') AS tags
```

## Example

The query behind the *Demo events* annotation in the bundled *CrateDB Getting Started* dashboard,
over a `doc.demo_events` table holding `ts`, `title` and a `tags` array:

```sql
SELECT
  ts AS time,
  title AS text,
  array_to_string(tags, ',') AS tags
FROM doc.demo_events
WHERE $__timeFilter(ts)
```
