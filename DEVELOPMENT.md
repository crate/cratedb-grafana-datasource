# Development

## Try it locally

```bash
git clone https://github.com/crate/cratedb-grafana-datasource.git
cd cratedb-grafana-datasource
docker compose up
```

That builds the plugin, starts a single-node CrateDB, seeds demo tables, and brings up Grafana on
<http://localhost:3000> with anonymous admin access, the **CrateDB** data source provisioned, and
both bundled dashboards populated:

- **CrateDB Cluster Health** — cluster monitoring straight from the `sys` schema. Container caveat:
  `sys.nodes` reports `os.cpu` as `-1` under Docker, so CPU panels stay empty.
- **CrateDB Getting Started** — the demo tables (`doc.demo_metrics`, `doc.demo_logs`,
  `doc.demo_events`) covering time-series aggregation, `OBJECT` columns, multi-select variables,
  logs, and annotations.

CrateDB is exposed on `:5432` (PostgreSQL wire) and `:4200` (HTTP/admin UI). The first run pulls
images and builds the frontend bundle and backend binary, so allow a few minutes; later runs reuse
both. `docker compose down -v` removes everything.

## Working on the plugin

```bash
make install   # yarn install + go mod download
make build     # backend binaries (all platforms) + frontend bundle → dist/
make check     # lint (gofmt, go vet, golangci-lint, actionlint, eslint, tsc) + unit tests
make up        # dev stack: Grafana (:3000, anonymous admin) + CrateDB (:4200 HTTP, :5432 pg)
make seed      # re-seed the demo tables (metrics, logs, events) in a running stack
```

Grafana loads the plugin from the bind-mounted `dist/`, so `make build` output takes precedence
and the container build is skipped once one exists — delete `dist/` (or `make clean`) to force it.

`make help` lists all targets (watch mode, signing, …). Three verification tiers beyond `check`
(ARM hosts get the `nightly` CrateDB image automatically, since release images are amd64-only):

```bash
make test-integration  # in-process driver tests against a real CrateDB (testcontainers)
make e2e               # deployed-plugin tests: boots CrateDB + Grafana with dist/ mounted,
                       # exercises health, queries, macros and autocomplete over Grafana's API.
                       # Needs `make build` first. Set GRAFANA_URL=http://localhost:3000 to
                       # attach to a running `make up` stack instead (~0.5s).
make e2e-browser       # Playwright smoke tests (config editor, query editor, bundled
                       # dashboards): boots + seeds the compose stack, downloads Chromium
                       # on first run
```

The Makefile handles the toolchain quirks: Yarn 4 is required by `@grafana/plugin-ui` and
resolved via a pinned `npx` fallback when no local yarn 4 exists, and `mage` falls back to
`go run` when not installed. Grafana ≥13 restricts anonymous auth to Viewer, so the admin
APIs (and the e2e test) use `admin:admin`.

CI (GitHub Actions) runs on every PR: lint, unit tests, build, integration and e2e across the
CrateDB version matrix, and a `@critical` browser smoke on current Grafana — uploading an
installable plugin zip per run. The full Grafana version matrix and browser suite run on a
monthly cron. The release flow is in
[RELEASE.md](https://github.com/crate/cratedb-grafana-datasource/blob/main/RELEASE.md).

One gap the tiers do not close: client-certificate authentication is configurable (PEM content or
file paths, in the UI and via provisioning) but no tier exercises a CrateDB HBA `method: cert`
setup.

Note: `src/img/logo.svg` is a placeholder; replace it with the official CrateDB brand asset
before any release.
