-- ── TimescaleDB: Convert causal_nodes to a hypertable ────────────
-- This enables fast time-window range queries for auto-linking strategy 2.
-- Must run AFTER 001_init.sql

CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- create_hypertable omitted for local dev: TimescaleDB requires all unique
-- indexes to include the partition key (timestamp), which conflicts with the
-- TEXT PRIMARY KEY on id. In production, drop the PK constraint first and
-- use a composite PK (id, timestamp) before enabling the hypertable.

-- Continuous aggregate omitted for local dev.
