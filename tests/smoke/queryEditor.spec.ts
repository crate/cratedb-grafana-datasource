import { expect, test } from '@grafana/plugin-e2e';

import { waitForMonaco } from './helpers';

test('new queries open in the builder; the SQL editor is one switch away', { tag: '@critical' }, async ({ panelEditPage, page }) => {
  await panelEditPage.datasource.set('CrateDB');

  // Grafana applies getDefaultQuery when a query row is created for the
  // datasource. On a fresh instance the auto-created row A can predate the
  // datasource selection (sole datasource, no change event) — adding a row
  // exercises the defaults deterministically.
  await page.getByTestId('data-testid query-tab-add-query').click();

  // New queries open in the visual builder, not yet runnable (no table picked).
  await expect(page.getByRole('radio', { name: 'Builder' }).last()).toBeChecked({ timeout: 15_000 });
  await expect(page.getByTestId('sql-preview').last()).toBeVisible();

  // Switching to SQL hands over to Monaco, which must lazy-load and lay out
  // with real width (EditorRow is a flex row, so the editor collapses to a
  // ~5px sliver unless its wrapper stretches).
  await page.getByRole('radio', { name: 'SQL' }).last().click();
  await waitForMonaco(page);
});

// Full query path through the deployed plugin: the provisioned Getting
// Started dashboard queries the seeded demo table with the macro template
// ($__timeGroupAlias/$__timeFilter/$__conditionalAll), so data appearing in
// its panels proves editor-authored SQL executes end to end.
test('the seeded getting-started dashboard returns data', async ({ gotoDashboardPage }) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'cratedb-getting-started' });

  const stat = dashboardPage.getPanelByTitle('Rows in demo table');
  await expect(stat.locator).toBeVisible();
  await expect(stat.locator).toContainText(/\d/);

  const timeseries = dashboardPage.getPanelByTitle('Temperature by location');
  await expect(timeseries.locator).toBeVisible();
  await expect(timeseries.getErrorIcon()).not.toBeVisible();
});

// The Logs query format end to end: the dashboard's logs panel runs the cheat
// sheet's logs template verbatim against the seeded doc.demo_logs table.
test('the seeded logs panel renders log lines', async ({ gotoDashboardPage }) => {
  const dashboardPage = await gotoDashboardPage({ uid: 'cratedb-getting-started' });

  const logs = dashboardPage.getPanelByTitle('Demo logs (Logs format)');
  await expect(logs.locator).toBeVisible();
  // the panel sits below the fold and Grafana lazy-renders offscreen panels
  await logs.locator.scrollIntoViewIfNeeded();
  // seeded messages always name a sensor
  await expect(logs.locator).toContainText(/berlin-01|vienna-01|zurich-01/);
  await expect(logs.getErrorIcon()).not.toBeVisible();
});

test('a concrete Location selection filters the dashboard instead of erroring', { tag: '@critical' }, async ({ gotoDashboardPage }) => {
  const dashboardPage = await gotoDashboardPage({
    uid: 'cratedb-getting-started',
    queryParams: new URLSearchParams({ 'var-location': 'Berlin' }),
  });

  const timeseries = dashboardPage.getPanelByTitle('Temperature by location');
  await expect(timeseries.locator).toBeVisible();
  await expect(timeseries.getErrorIcon()).not.toBeVisible();
  // only the selected series remains
  await expect(timeseries.locator).toContainText('temperature Berlin');
  await expect(timeseries.locator).not.toContainText('temperature Vienna');
});
