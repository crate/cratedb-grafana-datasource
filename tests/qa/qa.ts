import { test as base, expect } from '@grafana/plugin-e2e';
import type { ConsoleMessage, Page, Request, Response } from '@playwright/test';
import { mkdirSync } from 'node:fs';

export const ARTIFACT_DIR = 'qa-artifacts';

// Failures of the dev stack itself, not of the plugin: endpoints an anonymous
// session cannot read, icons Grafana's bundle asks for and does not ship, and
// the grafana.com catalog lookup for a plugin that is not published there.
const IGNORED_FAILURES = [
  /\/api\/user\/(stars|teams)/,
  /\/api\/live\//,
  /\/public\/build\/img\//,
  /\/api\/gnet\//,
];

type QAFixtures = {
  // Writes a numbered screenshot per step into qa-artifacts/<spec>/, for review by eye.
  shot: (name: string) => Promise<void>;
  // Console errors, page errors and failed responses seen since the test started.
  browserProblems: string[];
};

export const test = base.extend<QAFixtures>({
  browserProblems: async ({ page }, use) => {
    const problems: string[] = [];
    page.on('console', (m: ConsoleMessage) => {
      // A failed request logs here without its URL; the response handler below
      // records the same failure with one, so this line is noise.
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
        problems.push(`console: ${m.text()}`);
      }
    });
    page.on('pageerror', (e: Error) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r: Request) => {
      if (!IGNORED_FAILURES.some((re) => re.test(r.url()))) {
        problems.push(`request failed: ${r.url()}`);
      }
    });
    page.on('response', (r: Response) => {
      if (r.status() >= 400 && !IGNORED_FAILURES.some((re) => re.test(r.url()))) {
        problems.push(`http ${r.status()}: ${r.url()}`);
      }
    });
    await use(problems);
  },

  shot: async ({ page }, use, testInfo) => {
    const slug = testInfo.titlePath
      .join('-')
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    const dir = `${ARTIFACT_DIR}/${slug}`;
    mkdirSync(dir, { recursive: true });
    let n = 0;
    await use(async (name: string) => {
      const file = `${dir}/${String(++n).padStart(2, '0')}-${name}.png`;
      await page.screenshot({ path: file, fullPage: true });
      await testInfo.attach(name, { path: file, contentType: 'image/png' });
    });
  },
});

export { expect };

// Monaco is lazy-loaded and lays out asynchronously; a click before that lands
// in a zero-width editor and the keystrokes go nowhere.
export async function waitForMonaco(page: Page) {
  await page.waitForFunction(() => (window as unknown as { monaco?: unknown }).monaco, { timeout: 30_000 });
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Math.max(0, ...Array.from(document.querySelectorAll('.monaco-editor')).map((el) => el.clientWidth))
        ),
      { timeout: 20_000 }
    )
    .toBeGreaterThan(300);
}

// Grafana renders a panel when it scrolls into view, so a screenshot or an
// error check taken without scrolling reports blank space for the lower half of
// a dashboard.
export async function renderWholePage(page: Page, shot?: (name: string) => Promise<void>, label = 'view') {
  const height = page.viewportSize()?.height ?? 900;
  for (let step = 0; step < 6; step++) {
    if (shot) {
      await shot(`${label}-${step + 1}`);
    }
    const atBottom = await page.evaluate((h) => {
      const scroller =
        Array.from(document.querySelectorAll('*')).find(
          (el) => el.scrollHeight > el.clientHeight + h && getComputedStyle(el).overflowY !== 'visible'
        ) ?? document.scrollingElement;
      if (!scroller) {
        return true;
      }
      const before = scroller.scrollTop;
      scroller.scrollTop = before + h;
      return scroller.scrollTop === before;
    }, height);
    await page.waitForTimeout(900);
    if (atBottom) {
      break;
    }
  }
}

export async function setEditorSql(page: Page, sql: string) {
  await waitForMonaco(page);
  // The text surface, not the editor wrapper: the last .monaco-editor can be
  // Monaco's zero-size rename widget.
  await page.locator('.monaco-editor .view-lines').last().click({ force: true });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(sql);
}
