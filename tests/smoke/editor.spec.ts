import { expect, test } from '@grafana/plugin-e2e';

import { openSuggestions, setEditorSql, waitForMonaco } from './helpers';

// Real-Monaco behaviours the jsdom unit tests can't reach: live autocomplete
// against the cluster (schemas/tables/OBJECT sub-columns) and the cheat sheet.

test('autocomplete lists the sys monitoring schema tables', { tag: '@critical' }, async ({ panelEditPage, page }) => {
  await panelEditPage.datasource.set('CrateDB');
  await waitForMonaco(page);

  await setEditorSql(page, 'SELECT * FROM sys.');

  const items = await openSuggestions(page);
  // sys stays in autocomplete on purpose — cluster monitoring without an exporter.
  // the suggest widget is virtualized, so assert on early rows that are rendered.
  expect(items).toEqual(expect.arrayContaining(['cluster', 'jobs_log', 'nodes']));
});

test('autocomplete offers OBJECT sub-columns as their own keys', async ({ panelEditPage, page }) => {
  await panelEditPage.datasource.set('CrateDB');
  await waitForMonaco(page);

  await setEditorSql(page, 'SELECT * FROM doc.demo_metrics WHERE ta');

  const items = await openSuggestions(page);
  // CrateDB lists tags['sensor_id'] in information_schema.columns; the plugin
  // surfaces it as a completion (and escapes the subscript when used)
  expect(items.some((i) => i.includes("tags['sensor_id']"))).toBe(true);
});

test('the cheat sheet loads the recommended template into the editor', async ({ panelEditPage, page }) => {
  await panelEditPage.datasource.set('CrateDB');
  await waitForMonaco(page);
  await setEditorSql(page, 'SELECT 1');

  await page.getByTestId('data-testid Show data source help').click();
  await expect(page.getByRole('heading', { name: /CrateDB time series queries/ })).toBeVisible();
  await page.getByRole('button', { name: /recommended template/i }).click();

  // onClickExample replaces the query with the aggregation template
  await expect(page.getByText('$__timeGroupAlias').first()).toBeVisible({ timeout: 10_000 });
});
