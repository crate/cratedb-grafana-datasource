import { expect, test } from '@grafana/plugin-e2e';

// Ad-hoc filtering end to end: getTagKeys → the adhoc variable → the filter
// spliced into the query's own WHERE → the backend. Driven through a dashboard
// created via the API so it is robust across Grafana versions (the *creation*
// UI for ad-hoc filters moved/renamed between 12.x and 13.x, but a JSON
// `type: "adhoc"` variable works the same everywhere).
const DASHBOARD = {
  dashboard: {
    uid: 'e2e-adhoc',
    title: 'E2E AdHoc',
    schemaVersion: 39,
    templating: {
      list: [{ type: 'adhoc', name: 'Filters', datasource: { type: 'cratedb-cratedb-datasource', uid: 'cratedb-dev' } }],
    },
    panels: [
      {
        id: 1,
        type: 'table',
        title: 'Locations',
        datasource: { type: 'cratedb-cratedb-datasource', uid: 'cratedb-dev' },
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
        targets: [{ refId: 'A', format: 1, rawSql: 'SELECT DISTINCT location FROM doc.demo_metrics ORDER BY 1' }],
      },
    ],
  },
  overwrite: true,
};

test('an ad-hoc filter narrows every query that targets the table', { tag: '@critical' }, async ({ page }) => {
  const create = await page.request.post('/api/dashboards/db', { data: DASHBOARD });
  expect(create.ok()).toBeTruthy();

  try {
    // no filter: all three seeded locations are present
    await page.goto('/d/e2e-adhoc/e2e-adhoc?orgId=1&from=now-24h&to=now');
    const unfiltered = page.getByTestId('data-testid Panel header Locations');
    await expect(unfiltered).toContainText('Berlin');
    await expect(unfiltered).toContainText('Vienna');

    // filter demo_metrics.location = Berlin — the predicate lands inside the
    // query's WHERE, so DISTINCT now returns only Berlin
    const filter = encodeURIComponent('demo_metrics.location|=|Berlin');
    await page.goto(`/d/e2e-adhoc/e2e-adhoc?orgId=1&from=now-24h&to=now&var-Filters=${filter}`);
    const filtered = page.getByTestId('data-testid Panel header Locations');
    await expect(filtered).toContainText('Berlin');
    await expect(filtered).not.toContainText('Vienna');
    await expect(filtered).not.toContainText('Zurich');
    await expect(filtered.getByTestId('data-testid Panel status error')).toHaveCount(0);
  } finally {
    await page.request.delete('/api/dashboards/uid/e2e-adhoc');
  }
});
