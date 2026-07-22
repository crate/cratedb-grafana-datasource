import { expect, test } from '@grafana/plugin-e2e';

test('query editor renders the SQL editor and defaults new queries to Auto format', { tag: '@critical' }, async ({ panelEditPage, page }) => {
  await panelEditPage.datasource.set('CrateDB');

  // The Monaco-based SQL editor lazy-loads — generously on a cold Grafana.
  await page.waitForFunction(() => (window as any).monaco, { timeout: 30_000 });

  // EditorRow is a flex row, so the Monaco editor collapses to a ~5px sliver
  // unless its wrapper stretches and it is laid out. Assert it fills real width.
  // Measure the widest .monaco-editor to skip Monaco's hidden 0px rename widget.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Math.max(0, ...Array.from(document.querySelectorAll('.monaco-editor')).map((el) => el.clientWidth))
        ),
      { timeout: 15_000 }
    )
    .toBeGreaterThan(300);

  // Grafana applies getDefaultQuery when a query row is created for the
  // datasource. On a fresh instance the auto-created row A can predate the
  // datasource selection (sole datasource, no change event) — adding a row
  // exercises the defaults deterministically.
  await page.getByTestId('data-testid query-tab-add-query').click();

  // New queries open blank and default to the Auto format.
  await expect(page.getByRole('radio', { name: 'Auto' }).last()).toBeChecked({ timeout: 15_000 });
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
