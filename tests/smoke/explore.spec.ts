import { expect, test } from '@grafana/plugin-e2e';

// The Logs query format end to end in Explore: the seeded doc.demo_logs rows
// render as log lines and the level column drives per-line coloring.
test('the logs format renders level-tagged log lines in Explore', async ({ page }) => {
  const query = {
    refId: 'A',
    datasource: { type: 'cratedb-cratedb-datasource', uid: 'cratedb-dev' },
    rawSql:
      'SELECT "ts" AS time, "message" AS body, "level" FROM "doc"."demo_logs" WHERE $__timeFilter("ts") ORDER BY "ts" DESC LIMIT 100',
    format: 2,
  };
  const left = {
    datasource: 'cratedb-dev',
    queries: [query],
    range: { from: 'now-24h', to: 'now' },
  };
  await page.goto(`/explore?left=${encodeURIComponent(JSON.stringify(left))}`);

  // the logs panel renders rows (format 2 → preferredVisualisationType=logs);
  // seeded INFO lines always name a sensor, WARN lines are "slow ingest"
  await expect(page.getByText(/(berlin|vienna|zurich)-01/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/slow ingest|accepted \d+ readings/).first()).toBeVisible();
});
