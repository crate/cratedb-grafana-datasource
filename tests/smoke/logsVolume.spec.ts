import { expect, test } from '@grafana/plugin-e2e';

import { pickBuilderTable } from './helpers';

// The LogsVolume supplementary query: a builder logs query in Explore gets a
// full-range histogram instead of the client-side fallback (which Grafana
// flags with a "does not support full-range histograms" notice).
test('a logs query in Explore gets a full-range logs-volume histogram', async ({ explorePage, page }) => {
  test.slow();
  await explorePage.datasource.set('CrateDB');

  await page.getByRole('radio', { name: 'Logs' }).click();

  await pickBuilderTable(page, 'demo_logs');

  // heuristics fill time/message/level and the query auto-runs
  await expect(page.getByTestId('sql-preview')).toContainText('ORDER BY "ts" DESC', { timeout: 15_000 });
  await expect(page.getByText(/berlin-01|vienna-01|zurich-01/).first()).toBeVisible({ timeout: 20_000 });

  // the supplementary query replaced the partial client-side histogram
  await expect(page.getByText(/does not support full-range histograms/)).toHaveCount(0);
});
