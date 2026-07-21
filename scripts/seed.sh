#!/bin/sh
# Seeds the demo tables the "CrateDB Getting Started" dashboard reads from:
#
#   doc.demo_metrics — 24h of per-minute sensor readings for three locations,
#                      with an OBJECT column (autocomplete of sub-columns,
#                      JSON rendering, ad-hoc filter typing) on a table
#                      PARTITIONED BY day ($__timeFilter prunes partitions)
#   doc.demo_logs    — 24h of ingest logs for the Logs query format
#   doc.demo_events  — a handful of events for annotation queries
#
# Tables are dropped and recreated, so re-running yields the same row counts.
#
# Usage: ./scripts/seed.sh [cratedb-http-url]   (default http://localhost:4200)
set -eu

CRATEDB_URL="${1:-${CRATEDB_URL:-http://localhost:4200}}"

sql() {
  # CrateDB's HTTP endpoint takes {"stmt": "..."} JSON; jq-free encoding via sed.
  stmt=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')
  curl --silent --show-error --fail \
    -H 'Content-Type: application/json' \
    -X POST "${CRATEDB_URL}/_sql" \
    -d "{\"stmt\": \"${stmt}\"}" > /dev/null
}

echo "Seeding demo tables at ${CRATEDB_URL} ..."

sql 'DROP TABLE IF EXISTS doc.demo_metrics'
sql "CREATE TABLE doc.demo_metrics (
  ts TIMESTAMP WITH TIME ZONE NOT NULL,
  location TEXT NOT NULL,
  temperature DOUBLE PRECISION,
  humidity DOUBLE PRECISION,
  tags OBJECT(DYNAMIC) AS (
    sensor_id TEXT,
    firmware TEXT
  ),
  day TIMESTAMP WITH TIME ZONE GENERATED ALWAYS AS date_trunc('day', ts)
) PARTITIONED BY (day)"

sql "INSERT INTO doc.demo_metrics (ts, location, temperature, humidity, tags)
SELECT
  g.ts,
  l.location,
  15 + 10 * sin(extract(epoch FROM g.ts) / 7200.0) + random() * 3,
  60 + 20 * sin(extract(epoch FROM g.ts) / 10800.0) + random() * 5,
  {sensor_id = lower(l.location) || '-01',
   firmware = CASE l.location WHEN 'Berlin' THEN '1.3.1' ELSE '1.2.0' END}
FROM generate_series(now() - '24 hours'::INTERVAL, now(), '1 minute'::INTERVAL) AS g (ts),
     unnest(['Berlin', 'Vienna', 'Zurich']) AS l (location)"

sql 'REFRESH TABLE doc.demo_metrics'

sql 'DROP TABLE IF EXISTS doc.demo_logs'
sql 'CREATE TABLE doc.demo_logs (
  ts TIMESTAMP WITH TIME ZONE NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  service TEXT NOT NULL
)'

sql "INSERT INTO doc.demo_logs (ts, level, message, service)
SELECT
  t.ts,
  CASE WHEN t.r < 0.06 THEN 'ERROR' WHEN t.r < 0.25 THEN 'WARN' ELSE 'INFO' END,
  CASE
    WHEN t.r < 0.06 THEN 'write rejected for ' || t.sensor || ': shard not available'
    WHEN t.r < 0.25 THEN 'slow ingest from ' || t.sensor || ': batch took ' || t.n || ' ms'
    ELSE 'accepted ' || t.n || ' readings from ' || t.sensor
  END,
  t.service
FROM (
  SELECT
    g.ts,
    random() AS r,
    lower(['Berlin', 'Vienna', 'Zurich'][cast(floor(random() * 3) AS INT) + 1]) || '-01' AS sensor,
    cast(cast(floor(random() * 400) + 20 AS INT) AS TEXT) AS n,
    ['ingest', 'api', 'scheduler'][cast(floor(random() * 3) AS INT) + 1] AS service
  FROM generate_series(now() - '24 hours'::INTERVAL, now(), '30 seconds'::INTERVAL) AS g (ts)
) t"

sql 'REFRESH TABLE doc.demo_logs'

sql 'DROP TABLE IF EXISTS doc.demo_events'
sql 'CREATE TABLE doc.demo_events (
  ts TIMESTAMP WITH TIME ZONE NOT NULL,
  title TEXT NOT NULL,
  tags ARRAY(TEXT)
)'

sql "INSERT INTO doc.demo_events (ts, title, tags) VALUES
  (now() - '22 hours'::INTERVAL, 'Firmware 1.2.0 rollout (Vienna, Zurich)', ['deploy', 'firmware']),
  (now() - '18 hours'::INTERVAL, 'Maintenance window: ingest paused', ['maintenance']),
  (now() - '14 hours'::INTERVAL, 'Firmware 1.3.1 rollout (Berlin)', ['deploy', 'firmware']),
  (now() - '9 hours'::INTERVAL, 'Ingest pipeline restarted', ['ops']),
  (now() - '5 hours'::INTERVAL, 'Retention policy applied to demo_logs', ['ops']),
  (now() - '90 minutes'::INTERVAL, 'Alert rule enabled: temperature > 28', ['alerting'])"

sql 'REFRESH TABLE doc.demo_events'

echo "Done. The Getting Started dashboard has data now."
