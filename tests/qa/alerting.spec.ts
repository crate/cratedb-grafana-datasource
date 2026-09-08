import { test, expect, setEditorSql } from './qa';

// sys.jobs_log records every statement the cluster runs, so the rule has rows
// inside the form's default evaluation window however old the demo seed is.
const RULE_SQL =
  "SELECT $__timeGroupAlias(ended, '1m'), count(*) AS value " +
  'FROM sys.jobs_log WHERE $__timeFilter(ended) GROUP BY 1 ORDER BY 1';

test('an alert rule on a CrateDB query previews and evaluates', async ({ page, shot, browserProblems }) => {
  await page.goto('/alerting/new/alerting');
  await page.getByRole('textbox').first().fill('QA CrateDB job rate');

  // The form opens on the org default data source, which is the provisioned
  // CrateDB one; the preview below proves it.

  // The rule form hosts the same editor as a panel; new queries open in the builder.
  // The rule form re-renders on a timer, so a normal click waits forever for
  // the switch to hold still; drive the radio directly.
  const sql = page.getByRole('radio', { name: 'SQL' }).last();
  await sql.check({ force: true });
  await expect(sql).toBeChecked({ timeout: 30_000 });
  await setEditorSql(page, RULE_SQL);
  await shot('rule-query');

  await page.getByRole('button', { name: /Preview alert rule condition/i }).click();

  const graph = page.getByText('Graph', { exact: true });
  await expect(graph).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Firing|Normal/).first()).toBeVisible({ timeout: 60_000 });
  await shot('rule-preview');

  expect(browserProblems).toEqual([]);
});
