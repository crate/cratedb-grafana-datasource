import { expect, test } from '@grafana/plugin-e2e';

import { pickBuilderTable, waitForMonaco } from './helpers';

// The visual builder against the seeded stack: picking a table is enough to
// produce the recommended bucketed time-series query (heuristics fill the time
// column), and the generated SQL executes end to end.
test('picking a seeded table builds a running time-series query', { tag: '@critical' }, async ({ panelEditPage, page }) => {
  // cold-page loads (Monaco, introspection) can eat most of the default budget
  test.slow();
  await panelEditPage.datasource.set('CrateDB');
  await page.getByTestId('data-testid query-tab-add-query').click();
  await expect(page.getByRole('radio', { name: 'Builder' }).last()).toBeChecked({ timeout: 15_000 });

  await pickBuilderTable(page, 'demo_metrics');

  // the ts column heuristic completes the recommended template shape
  await expect(page.getByTestId('sql-preview').last()).toContainText('$__timeGroupAlias("ts", $__interval)', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('sql-preview').last()).toContainText('WHERE $__timeFilter("ts")');

  // the pick auto-ran the generated SQL; the panel must have rendered it cleanly
  await expect(panelEditPage.panel.getErrorIcon()).not.toBeVisible();
});

// Builder → SQL → Builder: the generated SQL lands in Monaco, and switching
// back restores the builder state without a confirmation (the SQL is untouched).
test('builder state survives a round-trip through the SQL editor', async ({ panelEditPage, page }) => {
  await panelEditPage.datasource.set('CrateDB');
  await page.getByTestId('data-testid query-tab-add-query').click();
  await pickBuilderTable(page, 'demo_metrics');
  await expect(page.getByTestId('sql-preview').last()).toContainText('$__timeGroupAlias', { timeout: 15_000 });

  await page.getByRole('radio', { name: 'SQL' }).last().click();
  await waitForMonaco(page);
  await expect(page.locator('.monaco-editor .view-lines').last()).toContainText('$__timeGroupAlias');

  await page.getByRole('radio', { name: 'Builder' }).last().click();
  // silent restore: no confirmation dialog, state intact
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('sql-preview').last()).toContainText('$__timeGroupAlias("ts", $__interval)');
});
