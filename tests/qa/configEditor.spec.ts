import type { Page } from '@playwright/test';

import { pickComboboxOption } from '../smoke/helpers';
import { test, expect } from './qa';

const NEW_DATASOURCE = '/connections/datasources/new';

// A fresh data source page for the CrateDB plugin, without touching the
// provisioned one the other specs read from. Returns the uid Grafana assigned,
// which is what the cleanup deletes: the page names the data source itself.
async function createDatasource(page: Page): Promise<string> {
  await page.goto(NEW_DATASOURCE);
  await page.getByText('CrateDB', { exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Host URL' })).toBeVisible({ timeout: 30_000 });
  const uid = new URL(page.url()).pathname.split('/').pop();
  expect(uid).toBeTruthy();
  return uid as string;
}

async function deleteDatasource(page: Page, uid: string) {
  await page.request.delete(`/api/datasources/uid/${uid}`);
}

test('the config page walks its fields, sections and warnings', async ({ page, shot, browserProblems }) => {
  const uid = await createDatasource(page);
  try {
    await shot('fresh');

    // CrateDB's HTTP port is the classic mistake; the field says so inline.
    const host = page.getByRole('textbox', { name: 'Host URL' });
    await host.fill('localhost:4200');
    await expect(page.getByText(/is CrateDB's HTTP port/).first()).toBeVisible();
    await shot('http-port-warning');

    await host.fill('cratedb:5432');
    await expect(page.getByText(/is CrateDB's HTTP port/)).toHaveCount(0);

    // TLS details appear only once a mode needs them.
    await expect(page.getByText('TLS/SSL Auth Details')).toBeHidden();
    const tlsMode = page.getByRole('combobox', { name: 'TLS/SSL Mode' });
    await pickComboboxOption(page, tlsMode, 'verify-full');
    await expect(page.getByText('TLS/SSL Auth Details')).toBeVisible();
    await shot('tls-verify-full');

    // Certificate content is the default method; the file-path variant and the
    // toggle between them are the smoke suite's business.
    await expect(page.getByPlaceholder('-----BEGIN CERTIFICATE-----').first()).toBeVisible();

    await pickComboboxOption(page, tlsMode, 'disable');
    await expect(page.getByText('TLS/SSL Auth Details')).toBeHidden();

    for (const section of ['User Permissions', 'Additional settings']) {
      await page.getByRole('button', { name: section }).click();
    }
    await shot('sections-open');

    expect(browserProblems).toEqual([]);
  } finally {
    await deleteDatasource(page, uid);
  }
});

test('the health check reports what is wrong', async ({ page, shot }) => {
  const uid = await createDatasource(page);
  try {
    await page.getByRole('textbox', { name: 'Host URL' }).fill('cratedb:5432');
    await page.getByRole('textbox', { name: 'Username' }).fill('crate');
    await page.getByRole('button', { name: 'Save & test' }).click();
    await expect(page.getByTestId(/Alert success/)).toBeVisible({ timeout: 60_000 });
    await shot('health-ok');

    // The PostgreSQL wire port is not the HTTP one, and the message says which.
    await page.getByRole('textbox', { name: 'Host URL' }).fill('cratedb:4200');
    await page.getByRole('button', { name: 'Save & test' }).click();
    const failure = page.getByTestId(/Alert error/);
    await expect(failure).toBeVisible({ timeout: 60_000 });
    await shot('health-http-port');
    expect(await failure.innerText()).not.toMatch(/goroutine|panic:|\*errors\./);

    await page.getByRole('textbox', { name: 'Host URL' }).fill('nosuchhost.invalid:5432');
    await page.getByRole('button', { name: 'Save & test' }).click();
    await expect(failure).toBeVisible({ timeout: 60_000 });
    await expect(failure).toContainText(/resolve|reach/i);
    await shot('health-unresolvable');
  } finally {
    await deleteDatasource(page, uid);
  }
});
