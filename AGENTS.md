## What this is

A Grafana **data source plugin** for [CrateDB](https://cratedb.com), connecting over the
**PostgreSQL wire protocol**. TypeScript/React frontend in `src/`, Go backend in `pkg/`, both
building into a single `dist/`. CrateDB is Postgres-wire-compatible, so the plugin reuses the
Postgres driver (pgx) and mirrors Grafana's built-in PostgreSQL data source where it makes sense.

Derived from the QuestDB, ClickHouse, and Redshift data source plugins (Apache-2.0) — keep the
attributions in `NOTICE` intact when you touch code adapted from them.

## Commands — use the Makefile, not `npm`/`yarn` directly

`make help` lists everything. The common ones:

| Task | Command |
|------|---------|
| Build backend + frontend into `dist/` | `make build` |
| Frontend watch | `make dev` |
| Lint (gofmt, go vet, golangci-lint, actionlint, eslint, tsc) | `make lint` |
| Auto-format Go + TS | `make format` |
| Unit tests (go + jest) | `make test` |
| Lint + unit tests | `make check` |
| Driver tests vs real CrateDB (testcontainers) | `make test-integration` |
| Deployed-plugin tests (CrateDB + Grafana) | `make e2e` |
| Browser smoke tests (Playwright) | `make e2e-browser` |
| Dev stack up / seed demo data | `make up` / `make seed` |
| Package + run the catalog validator | `make validate` |

Toolchain notes: **Yarn 4** is required (`@grafana/plugin-ui` hard-fails on Yarn 1) and the
backend builds with **mage** — the Makefile falls back to a pinned `npx` / `go run` when either
is missing, so you rarely install them yourself. See `CONTRIBUTING.md` for dev-environment setup.

## Architecture

**Frontend (`src/`)**
- `data/` — the query-rewriting core: `adHocFilter` (inject dashboard filters into WHERE),
  `ast` (pgsql-ast-parser splicing), `formatDetection` (time series/table/logs), `escape`
  (identifier/literal quoting — SQL-injection surface), `conditionalAll`, `interpolate`, `cache`.
- `editor/` — Monaco: `completionProvider` (schema/table/column autocomplete), `macroHover`, `macros`.
- `components/` — `ConfigEditor`, `QueryEditor`, `VariableQueryEditor`, `CheatSheet`.
- `datasource.ts`, `variables.ts`, `module.ts` (registrations), `types.ts`, `constants.ts`.

**Backend (`pkg/`)**
- `plugin/` — `driver` (pgx connect + TLS), `completable` + `adhoc` (`information_schema`
  introspection), `settings` (`GenerateDSN`), `connection_error` (actionable messages), `schema_cache`.
- `macros/` — Grafana SQL macros expanded to CrateDB SQL (e.g. `$__timeGroup` → `DATE_BIN`).
- `converters/` — CrateDB → Grafana frame type mapping. `main.go` wires it into `sqlds`.

## What lands in the code

Everything left in the tree — comments, names, docstrings, test titles — must read as if the code
had always been written that way. Document what the code **is** and the constraints it honors, never
the edit that produced it or the problem a session just solved.

- **No change-narration.** Drop "now / before / previously", "X before Y so the old case can't
  happen", and any wording pitched at a reviewer of the diff. Litmus: if a line only makes sense to
  someone who watched the change happen, rewrite it as the durable fact — or delete it. (This is why
  the comments here are terse.)
- **Tests pin a behavior, not a change.** Don't add a test reflexively per edit; if the behavior is
  already covered, extend the existing test (e.g. add a case to a table-driven one) rather than a
  near-duplicate. Name a test for the invariant it locks (`rejects an expired token`), never the
  bug or change that prompted it (`regression for …`, `fixes #123`).
- **The tree reads as one coherent design**, not a sediment of edits: no dead or commented-out code,
  no guard for a state the callers make impossible, no second copy of a helper that already exists,
  no bug/issue/PR ids in code or fixtures, and **no data or identifiers named after a unit of work**.
  `CHANGELOG.md` is the one place that narrates changes — keep that narration out of the code.

## Conventions

- **Comments are concise** — state constraints the code can't show; don't narrate the obvious.
- **Secrets go in `secureJsonData`**, never `jsonData` (see `ConfigEditor.tsx` / `settings.go`).
- **Don't edit `.config/`** — it's managed by Grafana plugin tools (`create-plugin`). To extend
  webpack/eslint/etc., layer on top per the Grafana docs.
- **Don't change the plugin `id` or `type`** in `src/plugin.json`. Any `plugin.json` change needs
  a **Grafana server restart** to take effect — remind the user.
- Backend builds with mage; frontend with the provided webpack config — don't swap either out.

## CrateDB gotchas

- Connect over the **PostgreSQL port 5432**, not the HTTP port 4200 (a common mix-up; the config
  editor even warns on 4200-range ports).
- Time bucketing is `$__timeGroup(col, interval)` → `DATE_BIN(...)`; there is no `SAMPLE BY`.
- Schema introspection uses **`information_schema`**, not `pg_catalog` (CrateDB's `pg_catalog`
  emulation is partial). `sys.*` holds cluster-monitoring tables and is intentionally kept.
- CrateDB has `OBJECT` and array types; auth defaults to **trust** (password optional).
- Subtracting two timestamps yields an `INTERVAL`, which panels cannot plot — the `sys.jobs_log`
  dashboard queries compute durations as `ended::bigint - started::bigint` instead.
- CrateDB accepts plaintext connections even with `ssl.psql.enabled` unless HBA demands
  `ssl: on`, so TLS mode is enforced client-side by sslmode (`configureTLS` in `driver.go`).

## Grafana docs

Your training data on the Grafana plugin API may be stale — prefer the live docs. Index:
`https://grafana.com/developers/plugin-tools/llms.txt`. Any page is plain-text markdown by
appending `.md` (e.g. `https://grafana.com/developers/plugin-tools/reference.md`).

For end-to-end tests, read `tests/AGENTS.md`.
