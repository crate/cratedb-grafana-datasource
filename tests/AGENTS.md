# Agent guide — end-to-end tests

This plugin has **two** e2e tiers. Don't confuse them:

- **Browser smoke tests** (this folder, `tests/smoke/*.spec.ts`) — Playwright + `@grafana/plugin-e2e`
  driving a real Grafana against the compose stack. Run with `make e2e-browser`.
- **In-process backend e2e** (`pkg/plugin/*_test.go`, `//go:build e2e`) — the Go driver against a
  real CrateDB via testcontainers. Run with `make e2e`. Not covered here.

## Running the browser tests

```bash
make e2e-browser
```

It boots (or reuses) the `docker compose` stack, seeds demo data (`scripts/seed.sh`), installs
Chromium, and runs `yarn e2e:browser` (`playwright test`). Tests tagged `@critical` are the subset
CI runs on every PR; the full suite runs on cron/release.

## Conventions in this suite

- Import `test` and `expect` from **`@grafana/plugin-e2e`**, never from `@playwright/test`
  directly. (This repo has no `./fixtures` re-export — import straight from the package.)
- Specs are `tests/smoke/<area>.spec.ts`; shared setup lives in `tests/smoke/helpers.ts`
  (`waitForMonaco`, `setEditorSql`, `openSuggestions`).
- Tag anything that must run on PRs with `{ tag: '@critical' }`.
- Each test is independent and assumes fresh state.
- If tests break against a newer Grafana, bump `@grafana/plugin-e2e` first — it tracks Grafana
  core's selector/API changes.

## Fixtures and provisioning

Use the plugin-e2e page-model fixtures instead of raw navigation — they absorb Grafana version
differences. The ones this suite relies on:

- `readProvisionedDataSource` — read the datasource from `provisioning/datasources/` instead of
  hardcoding a UID/name. Example (`configEditor.spec.ts`):
  ```typescript
  const datasource = await readProvisionedDataSource<CrateDBOptions, CrateDBSecureOptions>({
    fileName: 'cratedb.yaml',
  });
  ```
- `panelEditPage` — a fresh panel for query-editor / autocomplete tests.
- `gotoDashboardPage` — an existing provisioned dashboard (used for the bundled cluster-health and
  getting-started dashboards).

Never hardcode UIDs or credentials; provision them under `provisioning/` and read them back.

## Selecting elements

- Prefer Grafana selectors via the `selectors` fixture + `getByGrafanaSelector(...)` (handles the
  `aria-label` vs `data-testid` drift across versions). Never import `@grafana/e2e-selectors` directly.
- Scope locators to the narrowest wrapper rather than matching page-wide text.
- Config-editor fields are labelled `Field`s — target them by role and label, e.g.:
  ```typescript
  await page.getByRole('textbox', { name: 'Host URL' }).fill('localhost:5432');
  await page.getByRole('textbox', { name: 'Default schema' }).fill('doc');
  await page.getByRole('combobox', { name: 'TLS mode' }).click();
  ```

## Custom matchers

`@grafana/plugin-e2e` extends `expect`:

- `toBeOK()` — for `saveAndTest()`, `runQuery()`, `refreshPanel()`. The config-editor health check uses it:
  ```typescript
  await expect(configPage.saveAndTest()).toBeOK();
  ```
- `toHaveAlert(severity, { hasText })` — assert an alert box (e.g. the actionable connection-error message).
- `toDisplayPreviews([...])` — for `variableEditPage` query previews.

## Grafana version matrix

CI runs the browser suite across Grafana versions; the minimum is `grafanaDependency` in
`src/plugin.json` (currently `>=12.3.0-0`). To run against a specific version locally, set
`GRAFANA_VERSION` / `GRAFANA_IMAGE` when starting the stack (see the compose file and `make up`).
