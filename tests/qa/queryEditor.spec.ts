import { test, expect, setEditorSql, waitForMonaco } from './qa';
import type { PanelEditPage } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';

// A panel editor on the provisioned data source, query row switched to SQL.
async function openSqlPanel(panelEditPage: PanelEditPage, page: Page) {
  await panelEditPage.datasource.set('CrateDB');
  await page.getByRole('radio', { name: 'SQL' }).last().click();
  await waitForMonaco(page);
}

async function runQuery(panelEditPage: PanelEditPage, page: Page) {
  await panelEditPage.refreshPanel();
  await page.waitForTimeout(3_000);
}

test('a new query opens in the builder and produces runnable SQL', async ({ panelEditPage, page, shot, browserProblems }) => {
  await panelEditPage.datasource.set('CrateDB');
  await page.getByTestId('data-testid query-tab-add-query').click();
  await expect(page.getByRole('radio', { name: 'Builder' }).last()).toBeChecked({ timeout: 15_000 });
  await shot('builder-empty');

  const table = page.getByPlaceholder('Table').last();
  await table.click();
  await table.pressSequentially('demo_metrics');
  await page.getByRole('option', { name: 'demo_metrics' }).first().click();
  await page.waitForTimeout(3_000);
  await shot('builder-table-picked');

  // Picking a table is enough: the time column is guessed and the SQL bounded.
  await expect(page.getByText(/\$__timeGroupAlias/).first()).toBeVisible();
  await expect(page.getByText(/\$__timeFilter/).first()).toBeVisible();

  await page.getByRole('radio', { name: 'SQL' }).last().click();
  await waitForMonaco(page);
  await runQuery(panelEditPage, page);
  await shot('sql-after-switch');
  expect(browserProblems).toEqual([]);
});

test('the format selector reports what Auto resolved to', async ({ panelEditPage, page, shot }) => {
  await openSqlPanel(panelEditPage, page);
  // The label is the control; the radio input behind it takes no click on 12.x.
  const formats = page.getByRole('radiogroup').filter({ hasText: 'Time series' }).last();
  await page.waitForTimeout(300);
  await formats.getByText('Auto', { exact: true }).click({ force: true });
  const resolved = page.getByTestId('resolved-format').last();

  await setEditorSql(
    page,
    "SELECT $__timeGroupAlias(ts, '5m'), avg(temperature) AS value FROM doc.demo_metrics WHERE $__timeFilter(ts) GROUP BY 1 ORDER BY 1"
  );
  await runQuery(panelEditPage, page);
  await shot('auto-time-series');
  await expect(resolved).toContainText('Time series');

  await setEditorSql(page, 'SELECT ts, location FROM doc.demo_metrics LIMIT 5');
  await runQuery(panelEditPage, page);
  await shot('auto-table');
  await expect(resolved).toContainText('Table');
});

test('a query without a time macro is flagged, and a sys query is not', async ({ panelEditPage, page, shot }) => {
  await openSqlPanel(panelEditPage, page);
  // In the panel editor a frame notice rides on the query row as an info
  // badge, and its text appears once the badge is opened.
  const notice = page.getByText(/^\d+ info$/).last();

  await setEditorSql(page, 'SELECT ts, temperature FROM doc.demo_metrics LIMIT 10');
  await runQuery(panelEditPage, page);
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await notice.click();
  await expect(page.getByText(/no time-range macro/i)).toBeVisible();
  await shot('time-bound-notice');

  // Cluster tables are not partitioned by time, so the advice would be noise.
  await setEditorSql(page, 'SELECT id, name FROM sys.nodes LIMIT 5');
  await runQuery(panelEditPage, page);
  await expect(notice).toHaveCount(0);
  await shot('sys-exempt');
});

test('a broken query reports CrateDB, not the driver', async ({ panelEditPage, page, shot }) => {
  await openSqlPanel(panelEditPage, page);
  const error = panelEditPage.panel.getErrorIcon();

  await setEditorSql(page, 'SELCT 1');
  await runQuery(panelEditPage, page);
  await expect(error).toBeVisible({ timeout: 20_000 });
  await shot('syntax-error');

  await setEditorSql(page, 'SELECT * FROM doc.no_such_table LIMIT 1');
  await runQuery(panelEditPage, page);
  await expect(error).toBeVisible({ timeout: 20_000 });
  await shot('missing-table');
});

test('EXPLAIN renders as a table', async ({ panelEditPage, page, shot }) => {
  await openSqlPanel(panelEditPage, page);
  await setEditorSql(page, 'EXPLAIN SELECT * FROM doc.demo_metrics WHERE location = \'Berlin\'');
  await runQuery(panelEditPage, page);
  await shot('explain');
  await expect(panelEditPage.panel.getErrorIcon()).toBeHidden();
});

test('autocomplete offers schemas, tables and macros', async ({ panelEditPage, page, shot }) => {
  await openSqlPanel(panelEditPage, page);
  await setEditorSql(page, 'SELECT * FROM ');
  await page.keyboard.press('ControlOrMeta+ ');
  await page.waitForTimeout(2_500);
  await expect(page.getByRole('option', { name: /sys/ }).first()).toBeVisible({ timeout: 20_000 });
  await shot('schema-suggestions');

  await page.keyboard.press('Escape');
  await setEditorSql(page, 'SELECT * FROM doc.demo_metrics WHERE $__');
  await page.waitForTimeout(2_500);
  await expect(page.getByRole('option', { name: /timeFilter/ }).first()).toBeVisible({ timeout: 20_000 });
  await shot('macro-suggestions');
});
