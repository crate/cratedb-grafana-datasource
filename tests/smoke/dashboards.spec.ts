import { expect, test } from '@grafana/plugin-e2e';

import { expectAllPanelsHealthy } from './helpers';

// The dev stack provisions the dashboards bundled with the plugin
// (provisioning/dashboards/dashboards.yaml → dist/dashboards). This doubles
// as a parse check on the dashboard JSON.
test('bundled dashboards are provisioned', async ({ page }) => {
  await page.goto('/dashboards');
  await expect(page.getByRole('link', { name: /CrateDB Cluster Health/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /CrateDB Getting Started/ })).toBeVisible();
});

// Every panel is a live query against sys.* / the seeded tables, so "renders
// without an error icon" is a real end-to-end check of the converters, macros
// and dashboard SQL — not just a JSON parse.
test('cluster health: all panels render without errors', { tag: '@critical' }, async ({ gotoDashboardPage, page }) => {
  await gotoDashboardPage({ uid: 'cratedb-cluster-health' });
  await expectAllPanelsHealthy(page, [
    'Cluster health',
    'Nodes',
    'Missing shards',
    'Underreplicated shards',
    'Pending tasks',
    'Data size',
    'Total documents',
    'Shards started',
    'Shards by state',
    'Unassigned shard explanations',
    'CPU used per node (%)',
    'Heap used per node (%)',
    'Disk used per node (%)',
    'Load average per node',
    'Connections per node',
    'Thread pool rejections',
    'Query latency (from sys.jobs_log)',
    'Query throughput & errors',
    'Currently running queries',
    'Slowest statements in range',
    'Failed checks',
  ]);
});

test('getting started: all panels render without errors', { tag: '@critical' }, async ({ gotoDashboardPage, page }) => {
  await gotoDashboardPage({ uid: 'cratedb-getting-started' });
  await expectAllPanelsHealthy(page, [
    'Temperature by location',
    'Rows in demo table',
    'Humidity by location',
    'Latest raw readings',
    'Demo logs (Logs format)',
  ]);
});
