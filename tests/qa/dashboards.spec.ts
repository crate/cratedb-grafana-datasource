import { test, expect, renderWholePage } from './qa';
import type { Page } from '@playwright/test';

const RANGES = ['now-5m', 'now-6h', 'now-24h', 'now-7d'];

// A panel in trouble shows its error in the header corner; "No data" is a
// legitimate state on ranges the demo tables do not cover.
async function panelErrors(page: Page): Promise<string[]> {
  const errors = page.getByTestId(/panel-status-error/);
  const count = await errors.count();
  const messages: string[] = [];
  for (let i = 0; i < count; i++) {
    messages.push((await errors.nth(i).getAttribute('aria-label')) ?? 'panel error');
  }
  return messages;
}

async function waitForPanels(page: Page, shot?: (name: string) => Promise<void>, label?: string) {
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(3_000);
  await renderWholePage(page, shot, label);
}

for (const [uid, name] of [
  ['cratedb-getting-started', 'getting started'],
  ['cratedb-cluster-health', 'cluster health'],
] as const) {
  test(`${name}: every panel renders across the usual time ranges`, async ({ page, shot, browserProblems }) => {
    for (const from of RANGES) {
      await page.goto(`/d/${uid}?from=${from}&to=now&var-DS_CRATEDB=cratedb-dev`);
      await waitForPanels(page, shot, from);
      expect(await panelErrors(page), `panel errors on ${from}`).toEqual([]);
    }
    expect(browserProblems).toEqual([]);
  });

  test(`${name}: renders in light theme`, async ({ page, shot }) => {
    await page.goto(`/d/${uid}?theme=light&var-DS_CRATEDB=cratedb-dev`);
    await waitForPanels(page, shot, 'light');
    expect(await panelErrors(page)).toEqual([]);
  });

  test(`${name}: renders at a narrow viewport`, async ({ page, shot }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`/d/${uid}?var-DS_CRATEDB=cratedb-dev`);
    await waitForPanels(page, shot, 'narrow');
    expect(await panelErrors(page)).toEqual([]);
  });
}

test('getting started: the location variable filters instead of erroring', async ({ page, shot }) => {
  await page.goto('/d/cratedb-getting-started?var-DS_CRATEDB=cratedb-dev&var-location=Berlin');
  await waitForPanels(page, shot, 'location-berlin');
  expect(await panelErrors(page)).toEqual([]);

  await page.goto('/d/cratedb-getting-started?var-DS_CRATEDB=cratedb-dev&var-location=Berlin&var-location=Vienna');
  await waitForPanels(page, shot, 'location-two');
  expect(await panelErrors(page)).toEqual([]);
});
