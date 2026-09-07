import { test, expect, setEditorSql, waitForMonaco } from './qa';
import type { Page } from '@playwright/test';

const LOGS_SQL =
  'SELECT ts AS time, message AS body, level FROM doc.demo_logs WHERE $__timeFilter(ts) ORDER BY ts DESC LIMIT 200';

async function openExplore(page: Page) {
  await page.goto('/explore?left=' + encodeURIComponent(JSON.stringify({ datasource: 'cratedb-dev', range: { from: 'now-24h', to: 'now' } })));
  await page.getByRole('radio', { name: 'SQL' }).last().click();
  await waitForMonaco(page);
}

async function run(page: Page) {
  await page.getByTestId('data-testid RefreshPicker run button').click();
  await page.waitForTimeout(5_000);
}

test('Explore renders a time series and a table', async ({ page, shot, browserProblems }) => {
  await openExplore(page);
  await setEditorSql(
    page,
    "SELECT $__timeGroupAlias(ts, '5m'), location, avg(temperature) AS temperature FROM doc.demo_metrics WHERE $__timeFilter(ts) GROUP BY 1, location ORDER BY 1"
  );
  await run(page);
  await shot('time-series');
  await expect(page.getByText(/Berlin|Vienna|Zurich/).first()).toBeVisible({ timeout: 30_000 });

  // A row-shaped result needs the Table format; left on Time series, Grafana
  // rejects it for not being sorted by time.
  await page.getByRole('radio', { name: 'Table' }).last().click();
  await setEditorSql(page, 'SELECT ts, location, temperature FROM doc.demo_metrics WHERE $__timeFilter(ts) LIMIT 20');
  await run(page);
  await shot('table');
  expect(browserProblems).toEqual([]);
});

test('a logs query renders log lines and a full-range volume histogram', async ({ page, shot }) => {
  await openExplore(page);
  await page.getByRole('radio', { name: 'Logs' }).last().click();
  await setEditorSql(page, LOGS_SQL);
  await run(page);
  await shot('logs');

  // The histogram is a separate, unlimited query: it covers the whole range,
  // not just the rows the LIMIT returned, and splits by severity because the
  // query carries a level column.
  await expect(page.getByText(/Logs volume/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/accepted \d+ readings/).first()).toBeVisible({ timeout: 30_000 });
  for (const severity of ['error', 'warning', 'info']) {
    await expect(page.getByText(severity, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  }
  await shot('logs-volume');
});
