import { expect, Page } from '@grafana/plugin-e2e';

// Monaco doesn't run under jsdom, so these behaviours (real autocomplete, the
// editor filling its flex container) only exist in the browser tier.

// Wait for the Monaco global the SQLEditor lazy-loads.
export async function waitForMonaco(page: Page) {
  await page.waitForFunction(() => (window as unknown as { monaco?: unknown }).monaco, { timeout: 30_000 });
  // the visible editor (not Monaco's 0px rename widget) must have real width
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Math.max(0, ...Array.from(document.querySelectorAll('.monaco-editor')).map((el) => el.clientWidth))
        ),
      { timeout: 15_000 }
    )
    .toBeGreaterThan(300);
}

// Replace the editor contents with `sql`, leaving the cursor at the end.
export async function setEditorSql(page: Page, sql: string) {
  const lines = page.locator('.monaco-editor .view-lines').first();
  await lines.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(sql, { delay: 20 });
}

// The labels of the currently-open autocomplete suggestions.
export async function openSuggestions(page: Page): Promise<string[]> {
  const widget = page.locator('.suggest-widget.visible');
  await widget.waitFor({ timeout: 10_000 });
  return widget.locator('.monaco-list-row').allInnerTexts();
}

// Assert every panel on the current dashboard rendered without an error icon.
// Iterates the panel titles found in the DOM so it can't silently pass on zero.
export async function expectAllPanelsHealthy(page: Page, titles: string[]) {
  expect(titles.length).toBeGreaterThan(0);
  for (const title of titles) {
    const header = page.getByTestId(`data-testid Panel header ${title}`);
    await header.scrollIntoViewIfNeeded();
    await expect(header, `panel "${title}" should render`).toBeVisible();
    await expect(
      header.getByTestId('data-testid Panel status error'),
      `panel "${title}" should have no error`
    ).toHaveCount(0);
  }
}
