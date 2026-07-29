# Development

```bash
make install   # yarn install + go mod download
make build     # backend binaries (all platforms) + frontend bundle → dist/
make check     # lint (gofmt, go vet, golangci-lint, actionlint, eslint, tsc) + unit tests
make up        # dev stack: Grafana (:3000, anonymous admin) + CrateDB (:4200 HTTP, :5432 pg)
make seed      # demo tables (metrics, logs, events) for the Getting Started dashboard
```

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
monthly cron. The verification tiers are described in
[docs/architecture.md](https://github.com/crate/cratedb-grafana-datasource/blob/main/docs/architecture.md#9-verification),
the release flow in
[RELEASE.md](https://github.com/crate/cratedb-grafana-datasource/blob/main/RELEASE.md).

Note: `src/img/logo.svg` is a placeholder; replace it with the official CrateDB brand asset
before any release.
