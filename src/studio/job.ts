import { BudgetLedger } from "../budget/ledger.js";
import { loadEnv } from "../config/env.js";
import { openDb } from "../db/sqlite.js";
import { attachProviders } from "../pipeline/attach.js";
import { openRun, type RunContext } from "../pipeline/run.js";
import { type RunResult, resetFrom, runStages } from "../pipeline/runner.js";
import { ALL_STAGES } from "../pipeline/stages/index.js";
import { BudgetWindowError, errorMessage, RunInterruptedError } from "../util/errors.js";
import { nowIso } from "../util/fs.js";
import { type JobRow, type JobStatus, LIVE_JOB_STATUSES } from "./jobs.js";

/**
 * One pipeline execution, in its own process. Opens the run, admits the budget hold, wires the
 * cooperative control surface (pause/cancel flags from the jobs table, SIGINT/SIGTERM as pause),
 * runs the stages and records the outcome. Everything the UI shows comes from what this process
 * writes to SQLite and the run directory.
 */

export interface JobOutcome {
  status: JobStatus;
  result: RunResult | null;
  error: string | null;
}

export async function executeJob(
  jobId: string,
  opts: { log?: (m: string) => void } = {},
): Promise<JobOutcome> {
  const log = opts.log ?? ((m: string) => console.log(`[job ${jobId}] ${m}`));
  const db = openDb();
  const ledger = new BudgetLedger(db);
  const get = (): JobRow => {
    const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as
      | (Omit<JobRow, "args"> & { args: string })
      | undefined;
    if (!row) throw new Error(`job ${jobId} not found`);
    return { ...row, args: JSON.parse(row.args ?? "{}") };
  };
  const job = get();
  if (!LIVE_JOB_STATUSES.includes(job.status)) {
    return { status: job.status, result: null, error: `job is ${job.status}` };
  }
  db.prepare(
    `UPDATE jobs SET status = CASE WHEN status = 'queued' THEN 'running' ELSE status END, pid = ?, started_at = COALESCE(started_at, ?), heartbeat_at = ? WHERE id = ?`,
  ).run(process.pid, nowIso(), nowIso(), jobId);

  let localPause = false;
  const onSignal = () => {
    localPause = true;
    log("signal received: pausing after the current paid operation");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let flagsAt = 0;
  let flags: { pause: boolean; cancel: boolean } = { pause: false, cancel: false };
  const readFlags = () => {
    const now = Date.now();
    if (now - flagsAt < 750) return flags;
    flagsAt = now;
    const row = db
      .prepare(`SELECT pause_requested_at, cancel_requested_at FROM jobs WHERE id = ?`)
      .get(jobId) as { pause_requested_at: string | null; cancel_requested_at: string | null };
    flags = { pause: !!row.pause_requested_at || localPause, cancel: !!row.cancel_requested_at };
    return flags;
  };
  const heartbeat = setInterval(() => {
    try {
      db.prepare(`UPDATE jobs SET heartbeat_at = ? WHERE id = ?`).run(nowIso(), jobId);
    } catch {
      // ignore transient lock errors; the next beat will land
    }
  }, 3000);
  heartbeat.unref();

  const finalize = (
    status: JobStatus,
    patch: { result?: RunResult | null; error?: string | null; exit?: number },
  ) => {
    db.prepare(
      `UPDATE jobs SET status = ?, finished_at = ?, heartbeat_at = ?, exit_code = ?, result_status = ?, message = ?, error = ?, current_stage = NULL, current_shot = NULL WHERE id = ?`,
    ).run(
      status,
      nowIso(),
      nowIso(),
      patch.exit ?? 0,
      patch.result?.status ?? null,
      patch.result?.message ?? null,
      patch.error ?? null,
      jobId,
    );
  };

  let run: RunContext | null = null;
  let reservationId: number | null = null;
  try {
    const args = job.args;
    run = openRun(job.run_id, {
      quiet: false,
      brandSource: args.brand_source,
      options: {
        until: null,
        ...(args.options ?? {}),
        ...(args.budget_override_usd != null
          ? { budget_override_usd: args.budget_override_usd }
          : {}),
      },
    });
    run.jobId = jobId;
    run.control = {
      checkpoint(at) {
        const f = readFlags();
        if (f.cancel) throw new RunInterruptedError("cancelled", at);
        if (f.pause) throw new RunInterruptedError("paused", at);
      },
      progress(info) {
        db.prepare(
          `UPDATE jobs SET current_stage = ?, current_shot = ?, heartbeat_at = ? WHERE id = ?`,
        ).run(info.stage, info.shot ?? null, nowIso(), jobId);
      },
    };
    attachProviders(run, run.options.provider_mode, { warn: log });
    if (job.kind === "rerun" && args.from_stage) {
      const reset = resetFrom(run, ALL_STAGES, args.from_stage);
      log(`reset stages: ${reset.join(", ")}`);
    }
    const hold = Math.max(0, run.manifest.cost.hard_cap_usd - run.budget.spentUsd);
    const admitted = ledger.admit({
      brandId: run.manifest.brand_id,
      runId: run.runId,
      jobId,
      holdUsd: hold,
      providerMode: run.options.provider_mode,
      label: `${job.kind} ${run.runId}`,
    });
    reservationId = admitted.reservationId;
    run.budgetHold = { reservationId };
    db.prepare(`UPDATE jobs SET reservation_id = ? WHERE id = ?`).run(reservationId, jobId);
    log(`hold $${hold.toFixed(3)} admitted (reservation ${reservationId}); running`);

    const result = await runStages(run, ALL_STAGES);
    const spent = run.budget.spentUsd;
    ledger.release(reservationId, result.status, spent);
    const status: JobStatus =
      result.status === "stopped"
        ? run.manifest.stop_reason === "paused"
          ? "paused"
          : run.manifest.stop_reason === "cancelled"
            ? "cancelled"
            : "stopped"
        : result.status;
    finalize(status, { result, exit: 0 });
    log(`finished: ${status}${result.message ? ` — ${result.message}` : ""}`);
    return { status, result, error: null };
  } catch (err) {
    const message = errorMessage(err);
    if (reservationId != null)
      ledger.release(reservationId, "failed", run?.budget.spentUsd ?? null);
    if (run) {
      // Errors before/outside runStages (missing keys, budget window): leave the run resumable.
      if (run.manifest.status === "running") {
        run.manifest.status = "stopped";
        run.manifest.stop_reason = null;
        run.manifest.last_error = message;
        run.save();
      }
    }
    const status: JobStatus = err instanceof BudgetWindowError ? "budget_conflict" : "failed";
    finalize(status, { error: message, exit: 1 });
    log(`failed: ${message}`);
    return { status, result: null, error: message };
  } finally {
    clearInterval(heartbeat);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

const isMain = process.argv[1]?.endsWith("job.ts") || process.argv[1]?.endsWith("job.js");
if (isMain) {
  loadEnv();
  const id = process.argv[2];
  if (!id) {
    console.error("usage: job.ts <job_id>");
    process.exit(2);
  }
  executeJob(id)
    .then((o) => process.exit(o.error ? 1 : 0))
    .catch((err) => {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      process.exit(1);
    });
}
