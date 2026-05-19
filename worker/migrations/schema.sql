-- FlowBoard D1 Schema
-- Run once: wrangler d1 execute flowboard-db --file=schema.sql

-- Legacy full-state boards (POST /api/board/get|put|touch)
CREATE TABLE IF NOT EXISTS boards (
  key_hash   TEXT PRIMARY KEY,       -- SHA-256(boardId:password)
  data       TEXT NOT NULL,          -- JSON board blob
  updated_at INTEGER NOT NULL        -- unix ms, for TTL cleanup
);

-- CRDT op log
CREATE TABLE IF NOT EXISTS crdt_ops (
  op_id      TEXT NOT NULL,
  key_hash   TEXT NOT NULL,
  type       TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  client_id  TEXT,
  payload    TEXT NOT NULL,          -- JSON
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (key_hash, op_id)
);
CREATE INDEX IF NOT EXISTS crdt_ops_ts ON crdt_ops (key_hash, ts);

-- CRDT snapshots (materialized map-state)
CREATE TABLE IF NOT EXISTS crdt_snapshots (
  key_hash   TEXT PRIMARY KEY,
  snap       TEXT NOT NULL,          -- JSON map-state
  snap_ts    INTEGER NOT NULL,       -- ts of last op included
  updated_at INTEGER NOT NULL
);
