import * as path from "node:path";
import Database from "better-sqlite3";
import { dataDir } from "../config/env.js";
import { ensureDir } from "../util/fs.js";

export type Db = Database.Database;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    brand_config_version TEXT NOT NULL,
    topic TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    estimated_usd REAL NOT NULL DEFAULT 0,
    spent_usd REAL NOT NULL DEFAULT 0,
    run_dir TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stages (
    run_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    status TEXT NOT NULL,
    inputs_hash TEXT,
    started_at TEXT,
    finished_at TEXT,
    duration_ms INTEGER,
    cost_usd REAL NOT NULL DEFAULT 0,
    error TEXT,
    PRIMARY KEY (run_id, stage_id)
  )`,
  `CREATE TABLE IF NOT EXISTS shots (
    run_id TEXT NOT NULL,
    shot_id TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    shot_hash TEXT NOT NULL,
    cost_usd REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, shot_id)
  )`,
  `CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    shot_id TEXT,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    label TEXT,
    prompt_hash TEXT,
    prompt_version TEXT,
    brand_config_version TEXT NOT NULL,
    source_assets TEXT NOT NULL DEFAULT '[]',
    duration_s REAL,
    resolution TEXT,
    retries INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    est_cost_usd REAL NOT NULL DEFAULT 0,
    actual_cost_usd REAL,
    usage TEXT,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS generations_run ON generations(run_id)`,
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    run_id TEXT,
    shot_id TEXT,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    entities TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS qc_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    shot_id TEXT,
    status TEXT NOT NULL,
    report TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

let cached: Db | null = null;

export function openDb(file?: string): Db {
  if (cached && !file) return cached;
  const dbPath = file ?? path.join(ensureDir(dataDir()), "pipeline.db");
  ensureDir(path.dirname(dbPath));
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  for (const sql of MIGRATIONS) db.exec(sql);
  if (!file) cached = db;
  return db;
}

export function closeDb(): void {
  cached?.close();
  cached = null;
}
