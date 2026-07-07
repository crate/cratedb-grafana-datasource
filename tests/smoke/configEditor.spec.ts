import { expect, test } from '@grafana/plugin-e2e';

import { CrateDBOptions, CrateDBSecureOptions } from '../../src/types';

test('config editor renders and health check succeeds against the dev stack', { tag: '@critical' }, async ({
  gotoDataSourceConfigPage,
  readProvisionedDataSource,
  page,
}) => {
  const datasource = await readProvisionedDataSource<CrateDBOptions, CrateDBSecureOptions>({
    fileName: 'cratedb.yaml',
    name: 'CrateDB',
  });
  const configPage = await gotoDataSourceConfigPage(datasource.uid);

  // the provisioned server + port keys display as a joined Host URL
  await expect(page.locator('input[name="host"]')).toBeVisible();
  await expect(page.locator('input[name="host"]')).toHaveValue(/:5432$/);

  await expect(configPage.saveAndTest()).toBeOK();
});

test('TLS/SSL method toggles between file paths and certificate content', async ({
  createDataSourceConfigPage,
  page,
}) => {
  await createDataSourceConfigPage({ type: 'cratedb-cratedb-datasource' });

  // TLS disabled by default: no method selector, no cert details
  await expect(page.getByText('TLS/SSL Auth Details')).toBeHidden();

  // accessible names include the field descriptions; Playwright matches substrings
  const tlsMode = page.getByRole('combobox', { name: 'TLS/SSL Mode' });
  await tlsMode.click();
  await tlsMode.fill('require');
  await page.getByRole('option', { name: 'require' }).click();

  // certificate-content is the default method: textareas, no path inputs
  await expect(page.getByText('TLS/SSL Auth Details')).toBeVisible();
  await expect(page.locator('input[name="tlsCACertFile"]')).toBeHidden();

  const tlsMethod = page.getByRole('combobox', { name: 'TLS/SSL Method' });
  await tlsMethod.click();
  await page.getByRole('option', { name: 'File system path' }).click();
  await expect(page.locator('input[name="tlsCACertFile"]')).toBeVisible();
  await expect(page.locator('input[name="tlsClientKeyFile"]')).toBeVisible();

  await tlsMethod.click();
  await page.getByRole('option', { name: 'Certificate content' }).click();
  await expect(page.locator('input[name="tlsCACertFile"]')).toBeHidden();
});

test('health check reports an actionable error for an unreachable server', { tag: '@critical' }, async ({
  createDataSourceConfigPage,
  page,
}) => {
  const configPage = await createDataSourceConfigPage({ type: 'cratedb-cratedb-datasource' });

  await page.locator('input[name="host"]').fill('nowhere.invalid');
  await expect(configPage.saveAndTest()).not.toBeOK();
  // The classified message (pkg/plugin/connection_error.go), not a raw pgx error.
  await expect(page.getByText(/could not (resolve|reach)/i).first()).toBeVisible();
});
