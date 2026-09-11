import * as path from "node:path";
import Database from "better-sqlite3";
import { dataDir } from "../config/env.js";
import { ensureDir } from "../util/fs.js";

export type Db = Database.Database;

/**
 * Idempotent DDL, replayed on every open. Tables are created with IF NOT EXISTS; columns added
 * later are declared in COLUMN_ADDITIONS and applied only when PRAGMA table_info lacks them.
 */
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
  // ---- Studio: budget ledger, jobs, audit, brand versions ---------------------------------
  `CREATE TABLE IF NOT EXISTS budget_settings (
    brand_id TEXT PRIMARY KEY,
    currency TEXT NOT NULL DEFAULT 'INR',
    wallet_amount REAL,
    daily_amount REAL,
    two_day_amount REAL,
    wallet_since TEXT,
    count_mock_runs INTEGER NOT NULL DEFAULT 1,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS budget_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    job_id TEXT,
    hold_usd REAL NOT NULL,
    initial_hold_usd REAL NOT NULL,
    provider_mode TEXT NOT NULL DEFAULT 'live',
    status TEXT NOT NULL CHECK (status IN ('active','released')),
    reason TEXT,
    created_at TEXT NOT NULL,
    released_at TEXT,
    release_reason TEXT,
    actual_usd REAL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS budget_reservations_active
     ON budget_reservations(run_id) WHERE status = 'active'`,
  `CREATE TABLE IF NOT EXISTS budget_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id TEXT NOT NULL,
    run_id TEXT,
    generation_id INTEGER,
    reservation_id INTEGER,
    kind TEXT NOT NULL CHECK (kind IN ('spend','topup','adjustment','settings_change','hold','release')),
    amount_usd REAL NOT NULL,
    amount_display REAL,
    currency TEXT,
    fx_rate REAL,
    fx_rate_id INTEGER,
    provider_mode TEXT NOT NULL DEFAULT 'live',
    actor TEXT NOT NULL DEFAULT 'system',
    note TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS budget_ledger_brand_time ON budget_ledger(brand_id, kind, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS budget_ledger_generation
     ON budget_ledger(generation_id) WHERE generation_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS fx_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base TEXT NOT NULL,
    quote TEXT NOT NULL,
    rate REAL NOT NULL,
    effective_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    note TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS fx_rates_pair ON fx_rates(base, quote, effective_at)`,
  `CREATE TABLE IF NOT EXISTS studio_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    brand_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('start','resume','rerun')),
    args TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    pid INTEGER,
    reservation_id INTEGER,
    log_path TEXT,
    current_stage TEXT,
    current_shot TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    heartbeat_at TEXT,
    pause_requested_at TEXT,
    cancel_requested_at TEXT,
    exit_code INTEGER,
    result_status TEXT,
    message TEXT,
    error TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS jobs_live_per_run ON jobs(run_id)
     WHERE status IN ('queued','running','pausing','cancelling')`,
  `CREATE INDEX IF NOT EXISTS jobs_brand_created ON jobs(brand_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'local-user',
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    run_id TEXT,
    shot_id TEXT,
    details TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS audit_log_run ON audit_log(run_id, ts)`,
  `CREATE TABLE IF NOT EXISTS brand_versions (
    brand_id TEXT NOT NULL,
    version TEXT NOT NULL,
    file TEXT,
    product_id TEXT,
    actor TEXT NOT NULL DEFAULT 'local-user',
    note TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (brand_id, version)
  )`,
];

/** Columns added after the first release; applied only when missing. */
const COLUMN_ADDITIONS: Array<[table: string, column: string, ddl: string]> = [
  ["generations", "started_at", "TEXT"],
  ["generations", "completed_at", "TEXT"],
  ["generations", "request_id", "TEXT"],
  ["generations", "attempt", "INTEGER"],
  ["generations", "retry_of", "INTEGER"],
  ["generations", "cost_source", "TEXT"],
  ["generations", "provider_cost_usd", "REAL"],
  ["generations", "pricing_version", "TEXT"],
  ["generations", "fx_rate", "REAL"],
  ["generations", "fx_rate_id", "INTEGER"],
  ["generations", "provider_mode", "TEXT"],
  ["generations", "job_id", "TEXT"],
  ["generations", "reservation_id", "INTEGER"],
  ["generations", "reconciled", "TEXT"],
  ["generations", "outcome", "TEXT"],
  ["runs", "goal", "TEXT"],
  ["runs", "product_id", "TEXT"],
  ["runs", "title", "TEXT"],
  ["runs", "provider_mode", "TEXT"],
  ["runs", "qc_status", "TEXT"],
  ["runs", "duration_s", "REAL"],
  ["runs", "created_by", "TEXT"],
  ["runs", "hard_cap_usd", "REAL"],
];

export function applyMigrations(db: Db): void {
  for (const sql of MIGRATIONS) db.exec(sql);
  for (const [table, column, ddl] of COLUMN_ADDITIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }
}

let cached: Db | null = null;

export function dbPath(): string {
  return path.join(ensureDir(dataDir()), "pipeline.db");
}

/**
 * Open the index/ledger database. Without a file argument the process-wide connection is reused.
 * The busy timeout lets the studio API, job processes and the CLI share one file: writers wait
 * instead of failing with SQLITE_BUSY.
 */
export function openDb(file?: string, opts: { timeoutMs?: number } = {}): Db {
  if (cached && !file) return cached;
  const target = file ?? dbPath();
  ensureDir(path.dirname(target));
  const db = new Database(target, { timeout: opts.timeoutMs ?? 10_000 });
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  applyMigrations(db);
  if (!file) cached = db;
  return db;
}

export function closeDb(): void {
  cached?.close();
  cached = null;
}
