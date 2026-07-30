import { expect, test, Page } from '@grafana/plugin-e2e';
import type { Locator } from '@playwright/test';

import { pickBuilderTable } from '../smoke/helpers';

// Catalog screenshots referenced by src/plugin.json. Dashboard views are
// captured by `playwright screenshot` against kiosk URLs; this file covers the
// views that need a signed-in session and interaction.

const CAPTURE_DIR = 'src/img/screenshots';

// Grafana's Combobox commits on option click; typing narrows the list first so
// the option is in view regardless of how long the column list is. Column
// options carry their type as a description, so the match is a substring one.
async function pickOption(page: Page, input: Locator, value: string) {
  await input.click();
  await input.press('ControlOrMeta+A');
  await input.pressSequentially(value);
  await page.getByRole('option', { name: value }).first().click();
}

test('visual query builder', async ({ panelEditPage, page }) => {
  test.slow();
  await page.setViewportSize({ width: 1600, height: 1600 });
  await panelEditPage.datasource.set('CrateDB');
  // the nav menu is docked open on a fresh Grafana; it is not part of the shot
  const closeMenu = page.getByLabel('Close menu');
  if (await closeMenu.isVisible()) {
    await closeMenu.click();
  }
  await panelEditPage.timeRange.set({ from: 'now-24h', to: 'now' });
  await expect(page.getByRole('radio', { name: 'Builder' }).last()).toBeChecked({ timeout: 15_000 });

  // the table pick alone yields count(*); avg over a metric grouped by location
  // gives the chart the shape that makes the aggregation legible
  await pickBuilderTable(page, 'demo_metrics');
  await expect(page.getByTestId('sql-preview').last()).toContainText('$__timeGroupAlias("ts", $__interval)', {
    timeout: 15_000,
  });

  const aggregateArg = page.getByPlaceholder('Column').last();
  // the function combobox is the input immediately before the argument one
  await pickOption(page, aggregateArg.locator('xpath=preceding::input[1]'), 'avg');
  await pickOption(page, aggregateArg, 'temperature');
  await pickOption(page, page.getByPlaceholder('(none)').last(), 'location');

  await expect(page.getByTestId('sql-preview').last()).toContainText('avg("temperature")');
  await expect(page.getByTestId('sql-preview').last()).toContainText('"location"');
  await page.keyboard.press('Escape');
  await expect(panelEditPage.panel.getErrorIcon()).not.toBeVisible();
  await page.getByTestId('sql-preview').last().scrollIntoViewIfNeeded();
  // let the chart finish animating in before the shutter
  await page.waitForTimeout(4000);

  // the visualization-options pane is editor chrome, not the plugin — the shot
  // ends where it begins
  const content = (await page.getByTestId('data-testid Panel editor content').boundingBox())!;
  const dataPane = (await page.getByTestId('data-testid Panel editor data pane content').boundingBox())!;
  await page.screenshot({
    path: `${CAPTURE_DIR}/query-builder.png`,
    clip: { ...content, width: dataPane.x + dataPane.width - content.x },
  });
});
