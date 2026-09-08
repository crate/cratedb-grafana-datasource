# Agent guide — end-to-end tests

This plugin has **two** e2e tiers. Don't confuse them:

- **Browser smoke tests** (this folder, `tests/smoke/*.spec.ts`) — Playwright + `@grafana/plugin-e2e`
  driving a real Grafana against the compose stack. Run with `make e2e-browser`.
- **In-process backend e2e** (`pkg/plugin/*_test.go`, `//go:build e2e`) — the Go driver against a
  real CrateDB via testcontainers. Run with `make e2e`. Not covered here.

`tests/screenshots/` is a third Playwright project, not a test tier: it drives the same stack to
regenerate the catalog images in `src/img/screenshots/`. `SCREENSHOTS=1` admits it, which only
`make screenshots` sets — a capture writes into `src/img/`, so no unqualified run should schedule
it.

`tests/qa/` is a fourth project, `make qa`: a slower walk over every user-facing surface in a real
Chrome, written to be read as much as run. It asserts what can be asserted (no panel errors, no
console or HTTP failures the plugin caused, health-check messages that name the actual problem) and
leaves a screenshot per step under `qa-artifacts/` for a person to look through before a release.
`QA=1` is what admits the project into the Playwright run, so CI — which runs `playwright test`
unqualified — never schedules it.

Three things bite in that suite. Grafana renders a panel only once it scrolls into view, so a
screenshot or an error check taken without scrolling reports blank space for everything below the
fold; `renderWholePage` in `tests/qa/qa.ts` handles it. The bundled dashboards bind their
datasource variable to the org default, so a spec that runs while some other datasource of this type
exists must pin `var-DS_CRATEDB` in the URL. And on Grafana 12.x a combobox's highlighted option
lags a render behind its filtered list while a radio input takes no click at all, so both are
driven through the helpers rather than directly.

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
