# Roadmap

What is planned for 0.2, and why each item is not in 0.1. Issues and reactions on
[the tracker](https://github.com/crate/cratedb-grafana-datasource/issues) move things up this list.

## Queries and the editor

- **Full-text `MATCH`.** CrateDB's `MATCH` predicate does not fit the builder's filter model, which
  assumes an operator between one column and one value. It needs a filter row of its own; the cheat
  sheet gets a template once the builder can express it.
- **`$__searchFilter` in query variables.** The macro that narrows a variable's own list as you type
  it. The typed prefix has to reach the variable query, which the variable editor does not pass
  today.
- **Value suggestions for the builder's `IN` filter.** Values are typed by hand. Suggesting them
  means a `DISTINCT` lookup per column, which needs a cost guard first.
- **A SQL formatter in the raw editor.** The parser the plugin already uses can read the SQL back,
  but printing it re-renders macros, so a formatter has to be taught to leave them alone.

## Data and panels

- **`GEO_POINT` as coordinates.** Geo points arrive as the text `(lon,lat)` and stay text, so the
  geomap panel cannot read them. A converter has to split them into the fields Grafana expects,
  which is a frame-shape decision.
- **Traces.** Logs and metrics are covered; traces need Grafana's trace frame schema, which has no
  natural CrateDB table shape yet.
- **Explore's filter-for-value and log context.** Both are data source callbacks Explore offers.
  Wiring them needs a way to get from a displayed log row back to its source table and timestamp.
- **A configurable default log table.** Every Explore session starts by picking a table, because
  the Logs flavor has no default. Naming one in the data source config is small, and was left out
  of 0.1 to keep the config surface short.

## Ad-hoc filters

- **Keys across schemas.** Filter keys and values come from the data source's default schema only.
  Widening this means a key format that carries the schema, and a rewrite that qualifies the
  injected predicate accordingly.
- **Cheaper value lookups.** The `DISTINCT` query behind a filter's value list scans the whole
  table. Bounding it by the dashboard time range and caching the result briefly cuts that cost, and
  has to be done without silently hiding values that fall outside the range.

## Build and supply chain

- **Workflow actions pinned by commit SHA.** CI references third-party GitHub Actions by tag.
  Pinning by SHA hardens that against a moved tag, and wants automated bumps in place first so the
  pins do not go stale.

## Signing, the catalog and Grafana Cloud

0.1 ships unsigned, which keeps it out of the plugin catalog and off Grafana Cloud;
[Installation](README.md#installation) covers what stands in the way and how self-hosted Grafana
loads the release archive meanwhile.
