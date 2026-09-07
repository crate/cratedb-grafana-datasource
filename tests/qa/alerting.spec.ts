import { test, expect, setEditorSql } from './qa';

// sys.jobs_log records every statement the cluster runs, so the rule has rows
// inside the form's default evaluation window however old the demo seed is.
const RULE_SQL =
  "SELECT $__timeGroupAlias(ended, '1m'), count(*) AS value " +
  'FROM sys.jobs_log WHERE $__timeFilter(ended) GROUP BY 1 ORDER BY 1';

test('an alert rule on a CrateDB query previews and evaluates', async ({ page, shot, browserProblems }) => {
  await page.goto('/alerting/new/alerting');
  await page.getByRole('textbox').first().fill('QA CrateDB job rate');

  // The form picks a data source of its own accord; name the provisioned one.
  const picker = page.getByRole('combobox', { name: 'Select a data source' });
  await picker.click();
  await picker.fill('CrateDB');
  await page.getByRole('option', { name: 'CrateDB', exact: true }).first().click();

  // The rule form hosts the same editor as a panel; new queries open in the builder.
  await page.getByRole('radio', { name: 'SQL' }).last().click({ force: true });
  await setEditorSql(page, RULE_SQL);
  await shot('rule-query');

  await page.getByRole('button', { name: /Preview alert rule condition/i }).click();

  const graph = page.getByText('Graph', { exact: true });
  await expect(graph).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Firing|Normal/).first()).toBeVisible({ timeout: 60_000 });
  await shot('rule-preview');

  expect(browserProblems).toEqual([]);
});
