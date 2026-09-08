import { expect, Page } from '@grafana/plugin-e2e';
import type { Locator } from '@playwright/test';

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

// Bring the last query row to the SQL surface — new queries open in the visual
// builder — and wait for Monaco. A row already in SQL mode is left alone.
export async function openSqlEditor(page: Page) {
  const sqlRadio = page.getByRole('radio', { name: 'SQL' }).last();
  if (!(await sqlRadio.isChecked())) {
    await sqlRadio.click();
  }
  await waitForMonaco(page);
}

// Pick a table in the last query row's builder. Prefers typing + ArrowDown +
// Enter (the floating option list can be overlapped by other rows' editors),
// falls back to clicking the option, and retries — on a cold page either
// commit path can be swallowed. Every attempt is verified against the input.
export async function pickBuilderTable(page: Page, table: string) {
  const input = page.getByPlaceholder('Table').last();
  const option = page.getByRole('option', { name: table }).first();
  const committed = () =>
    expect(input)
      .toHaveValue(table, { timeout: 2_000 })
      .then(
        () => true,
        () => false
      );

  for (let attempt = 0; attempt < 3; attempt++) {
    await input.click();
    await input.press('ControlOrMeta+A');
    await input.pressSequentially(table);
    await expect(option).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    if (await committed()) {
      return;
    }
    await input.click();
    await option.click({ force: true }).catch(() => {});
    if (await committed()) {
      return;
    }
    await page.keyboard.press('Escape');
  }
  await expect(input).toHaveValue(table);
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

// Grafana's combobox re-renders its list as it filters, so an option can move
// out from under a pointer between the actionability check and the click. The
// keyboard path commits the highlighted option without touching the list, but
// the highlighted index lags one render behind the filtered-in option: acting
// the instant it appears re-selects whatever was highlighted before filtering,
// or catches the list mid-render and hangs the tab. The pause lets that index
// catch up before ArrowDown moves it.
export async function pickComboboxOption(page: Page, combobox: Locator, option: string) {
  const entry = page.getByRole('option', { name: option }).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    await combobox.click();
    await combobox.press('ControlOrMeta+A');
    await combobox.pressSequentially(option);
    await expect(entry).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    if (await combobox.inputValue().then((value) => value === option)) {
      return;
    }
    await page.keyboard.press('Escape');
  }
  await expect(combobox).toHaveValue(option);
}

// Grafana renders a panel when it scrolls into view; a locator for one that
// has never been on screen resolves to nothing, so walk the page first.
export async function scrollDashboardToBottom(page: Page) {
  for (let step = 0; step < 6; step++) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(600);
  }
}

// Assert every panel on the current dashboard rendered without an error icon.
// The title list is the caller's; the length guard keeps an empty list from passing vacuously.
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
