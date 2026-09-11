import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { BudgetLedger } from "../budget/ledger.js";
import { dataDir, repoRoot } from "../config/env.js";
import type { Db } from "../db/sqlite.js";
import { findRunDir, loadManifest, saveManifest } from "../pipeline/manifest.js";
import { ensureDir, nowIso } from "../util/fs.js";

/**
 * Job supervisor. A job is one execution of the pipeline for a run (start, resume or rerun),
 * carried out by a separate `node --import tsx src/studio/job.ts <id>` process so a crash inside
 * Remotion or ffmpeg never takes the studio down and a studio restart never kills a run. The
 * jobs table is the contract between the two: the child heartbeats and reads pause/cancel
 * flags; the supervisor reconciles anything that died.
 */

export type JobKind = "start" | "resume" | "rerun";
export type JobStatus =
  | "queued"
  | "running"
  | "pausing"
  | "cancelling"
  | "paused"
  | "cancelled"
  | "done"
  | "stopped"
  | "waiting_approval"
  | "budget_conflict"
  | "failed"
  | "orphaned";

export const LIVE_JOB_STATUSES: JobStatus[] = ["queued", "running", "pausing", "cancelling"];

export interface JobArgs {
  /** Stage to reset from (rerun only). */
  from_stage?: string;
  /** Force the brand source for this open. */
  brand_source?: "live" | "snapshot";
  /** Option patch applied before running (e.g. dry_run false after storyboard approval). */
  options?: Record<string, unknown>;
  budget_override_usd?: number | null;
  /** Why the job exists, for the audit trail and the UI. */
  reason?: string;
}

export interface JobRow {
  id: string;
  run_id: string;
  brand_id: string;
  kind: JobKind;
  args: JobArgs;
  status: JobStatus;
  pid: number | null;
  reservation_id: number | null;
  log_path: string | null;
  current_stage: string | null;
  current_shot: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  pause_requested_at: string | null;
  cancel_requested_at: string | null;
  exit_code: number | null;
  result_status: string | null;
  message: string | null;
  error: string | null;
}

export const HEARTBEAT_STALE_MS = 45_000;

function parseJob(r: Record<string, unknown>): JobRow {
  return {
    ...(r as unknown as JobRow),
    args: JSON.parse((r.args as string) ?? "{}") as JobArgs,
  };
}

export function newJobId(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `job-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
}

export function pidAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface SpawnOptions {
  /** Test hook: run the job in-process instead of spawning (returns when it finished). */
  runner?: (jobId: string) => Promise<void>;
}

export class JobSupervisor {
  readonly ledger: BudgetLedger;
  constructor(
    readonly db: Db,
    private readonly opts: SpawnOptions = {},
  ) {
    this.ledger = new BudgetLedger(db);
  }

  logDir(): string {
    return ensureDir(path.join(dataDir(), "job-logs"));
  }

  get(id: string): JobRow | null {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? parseJob(row) : null;
  }

  liveForRun(runId: string): JobRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM jobs WHERE run_id = ? AND status IN ('queued','running','pausing','cancelling') ORDER BY created_at DESC LIMIT 1`,
      )
      .get(runId) as Record<string, unknown> | undefined;
    return row ? parseJob(row) : null;
  }

  latestForRun(runId: string): JobRow | null {
    const row = this.db
      .prepare(`SELECT * FROM jobs WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(runId) as Record<string, unknown> | undefined;
    return row ? parseJob(row) : null;
  }

  list(filter: { brandId?: string; live?: boolean; limit?: number } = {}): JobRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.brandId) {
      where.push("brand_id = ?");
      params.push(filter.brandId);
    }
    if (filter.live) where.push("status IN ('queued','running','pausing','cancelling')");
    const rows = this.db
      .prepare(
        `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params, filter.limit ?? 50) as Array<Record<string, unknown>>;
    return rows.map(parseJob);
  }

  /** Create the job row and start its process. One live job per run is enforced by the DB. */
  async enqueue(
    kind: JobKind,
    runId: string,
    brandId: string,
    args: JobArgs = {},
  ): Promise<JobRow> {
    const live = this.liveForRun(runId);
    if (live) throw new Error(`Run ${runId} already has a live job (${live.id}, ${live.status})`);
    const id = newJobId();
    const logPath = path.join(this.logDir(), `${id}.log`);
    this.db
      .prepare(
        `INSERT INTO jobs (id, run_id, brand_id, kind, args, status, log_path, created_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
      )
      .run(id, runId, brandId, kind, JSON.stringify(args), logPath, nowIso());
    this.db
      .prepare(
        `INSERT INTO audit_log (ts, actor, action, target_type, target_id, run_id, details) VALUES (?, 'local-user', ?, 'run', ?, ?, ?)`,
      )
      .run(nowIso(), `job.${kind}`, runId, runId, JSON.stringify({ job_id: id, ...args }));
    if (this.opts.runner) {
      await this.opts.runner(id);
    } else {
      this.spawn(id, logPath);
    }
    const job = this.get(id);
    if (!job) throw new Error(`job ${id} vanished`);
    return job;
  }

  private spawn(jobId: string, logPath: string): void {
    const root = repoRoot();
    const out = fs.openSync(logPath, "a");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(root, "src/studio/job.ts"), jobId],
      {
        cwd: root,
        env: { ...process.env, AICP_ROOT: root },
        detached: true,
        stdio: ["ignore", out, out],
      },
    );
    child.unref();
    fs.closeSync(out);
    this.db
      .prepare(
        `UPDATE jobs SET pid = ?, status = 'running', started_at = ? WHERE id = ? AND status = 'queued'`,
      )
      .run(child.pid ?? null, nowIso(), jobId);
    child.on("exit", (code) => {
      // The child normally finalises its own row; this only catches crashes before it could.
      const job = this.get(jobId);
      if (job && LIVE_JOB_STATUSES.includes(job.status)) {
        this.markOrphaned(job, `process exited with code ${code ?? "?"} before finishing`);
      }
    });
  }

  requestPause(jobId: string): JobRow | null {
    this.db
      .prepare(
        `UPDATE jobs SET pause_requested_at = COALESCE(pause_requested_at, ?), status = CASE WHEN status IN ('queued','running') THEN 'pausing' ELSE status END WHERE id = ?`,
      )
      .run(nowIso(), jobId);
    return this.get(jobId);
  }

  requestCancel(jobId: string): JobRow | null {
    this.db
      .prepare(
        `UPDATE jobs SET cancel_requested_at = COALESCE(cancel_requested_at, ?), status = CASE WHEN status IN ('queued','running','pausing') THEN 'cancelling' ELSE status END WHERE id = ?`,
      )
      .run(nowIso(), jobId);
    return this.get(jobId);
  }

  /** In-flight paid calls of a job (a `reserved` ledger row) — what cancel cannot interrupt. */
  inFlightCalls(runId: string): Array<{
    id: number;
    label: string | null;
    started_at: string | null;
    provider: string;
    model: string;
    est_cost_usd: number;
    shot_id: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT id, label, started_at, provider, model, est_cost_usd, shot_id FROM generations WHERE run_id = ? AND status = 'reserved' ORDER BY id`,
      )
      .all(runId) as ReturnType<JobSupervisor["inFlightCalls"]>;
  }

  markOrphaned(job: JobRow, reason: string): void {
    const ts = nowIso();
    this.db
      .prepare(
        `UPDATE jobs SET status = 'orphaned', finished_at = ?, error = ? WHERE id = ? AND status IN ('queued','running','pausing','cancelling')`,
      )
      .run(ts, reason, job.id);
    // Calls that were in flight when the process died: the vendor may have charged them. Keep the
    // estimate as a conservative figure and flag the row for the operator.
    this.db
      .prepare(
        `UPDATE generations SET status = 'failed', reconciled = 'unknown_killed', actual_cost_usd = est_cost_usd, completed_at = ?, error = ?
         WHERE run_id = ? AND status = 'reserved'`,
      )
      .run(
        ts,
        `job ${job.id} died while this call was in flight; charge unknown, estimate kept`,
        job.run_id,
      );
    this.ledger.releaseForRun(job.run_id, "orphaned");
    const runDir = findRunDir(job.run_id);
    if (runDir) {
      try {
        const m = loadManifest(runDir);
        if (m.status === "running") {
          m.status = "stopped";
          m.stop_reason = null;
          m.last_error = `Interrupted: ${reason}`;
          for (const st of Object.values(m.stages))
            if (st.status === "running") st.status = "pending";
          saveManifest(runDir, m);
          this.db
            .prepare(`UPDATE runs SET status = ?, updated_at = ? WHERE run_id = ?`)
            .run(m.status, ts, job.run_id);
        }
      } catch {
        // manifest unreadable: nothing more to do
      }
    }
  }

  /** On boot and periodically: adopt live children that are still alive, orphan the dead ones. */
  reconcile(now = Date.now()): { orphaned: string[]; alive: string[] } {
    const orphaned: string[] = [];
    const alive: string[] = [];
    for (const job of this.list({ live: true, limit: 500 })) {
      const hb = job.heartbeat_at ? Date.parse(job.heartbeat_at) : Date.parse(job.created_at);
      const stale = now - hb > HEARTBEAT_STALE_MS;
      if (pidAlive(job.pid) && !stale) {
        alive.push(job.id);
        continue;
      }
      if (
        job.status === "queued" &&
        !job.pid &&
        now - Date.parse(job.created_at) < HEARTBEAT_STALE_MS
      ) {
        alive.push(job.id);
        continue;
      }
      this.markOrphaned(job, pidAlive(job.pid) ? "no heartbeat" : "process is gone");
      orphaned.push(job.id);
    }
    return { orphaned, alive };
  }
}
