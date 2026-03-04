-- ── TimescaleDB: Convert causal_nodes to a hypertable ────────────
-- This enables fast time-window range queries for auto-linking strategy 2.
-- Must run AFTER 001_init.sql

SELECT create_hypertable(
  'causal_nodes',
  'timestamp',
  if_not_exists => TRUE,
  chunk_time_interval => INTERVAL '7 days'
);

-- ── Continuous aggregate: incident rate per hour ──────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS incident_rate_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', timestamp) AS bucket,
  org_id,
  COUNT(*) AS incident_count
FROM causal_nodes
WHERE layer = 'INCIDENT'
GROUP BY bucket, org_id;

-- Refresh policy: refresh last 24 hours every 15 minutes
SELECT add_continuous_aggregate_policy(
  'incident_rate_hourly',
  start_offset => INTERVAL '24 hours',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes',
  if_not_exists => TRUE
);
