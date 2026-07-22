import { expect, test } from '@grafana/plugin-e2e';

import { waitForMonaco } from './helpers';

// The visual builder against the seeded stack: picking a table is enough to
// produce the recommended bucketed time-series query (heuristics fill the time
// column), and the generated SQL executes end to end.
test('picking a seeded table builds a running time-series query', { tag: '@critical' }, async ({ panelEditPage, page }) => {
  // cold-page loads (Monaco, introspection) can eat most of the default budget
  test.slow();
  await panelEditPage.datasource.set('CrateDB');
  await page.getByTestId('data-testid query-tab-add-query').click();
  await expect(page.getByRole('radio', { name: 'Builder' }).last()).toBeChecked({ timeout: 15_000 });

  // type, wait for the filtered option (the introspection fetch is async on a
  // cold page), then Enter — clicking the floating list is unreliable when
  // other query rows' editors overlap it
  const tableInput = page.getByPlaceholder('Table').last();
  await tableInput.click();
  await tableInput.pressSequentially('demo_metrics');
  await expect(page.getByRole('option', { name: 'demo_metrics' })).toBeVisible({ timeout: 15_000 });
  // ArrowDown pins the highlight on the sole filtered option; a bare Enter can
  // land with nothing highlighted
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  // the ts column heuristic completes the recommended template shape
  await expect(page.getByTestId('sql-preview').last()).toContainText('$__timeGroupAlias("ts", $__interval)', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('sql-preview').last()).toContainText('WHERE $__timeFilter("ts")');

  await expect(panelEditPage.refreshPanel()).toBeOK();
});

// Builder → SQL → Builder: the generated SQL lands in Monaco, and switching
// back restores the builder state without a confirmation (the SQL is untouched).
test('builder state survives a round-trip through the SQL editor', async ({ panelEditPage, page }) => {
  await panelEditPage.datasource.set('CrateDB');
  await page.getByTestId('data-testid query-tab-add-query').click();
  // type, wait for the filtered option (the introspection fetch is async on a
  // cold page), then Enter — clicking the floating list is unreliable when
  // other query rows' editors overlap it
  const tableInput = page.getByPlaceholder('Table').last();
  await tableInput.click();
  await tableInput.pressSequentially('demo_metrics');
  await expect(page.getByRole('option', { name: 'demo_metrics' })).toBeVisible({ timeout: 15_000 });
  // ArrowDown pins the highlight on the sole filtered option; a bare Enter can
  // land with nothing highlighted
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sql-preview').last()).toContainText('$__timeGroupAlias', { timeout: 15_000 });

  await page.getByRole('radio', { name: 'SQL' }).last().click();
  await waitForMonaco(page);
  await expect(page.locator('.monaco-editor .view-lines').last()).toContainText('$__timeGroupAlias');

  await page.getByRole('radio', { name: 'Builder' }).last().click();
  // silent restore: no confirmation dialog, state intact
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('sql-preview').last()).toContainText('$__timeGroupAlias("ts", $__interval)');
});
