import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BudgetLedger } from "../budget/ledger.js";
import { closeDb, openDb } from "../db/sqlite.js";
import { createRun } from "../pipeline/run.js";
import { nowIso } from "../util/fs.js";
import { executeJob } from "./job.js";
import { JobSupervisor } from "./jobs.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicp-jobs-"));

beforeAll(() => {
  process.env.AICP_RUNS_DIR = path.join(tmp, "runs");
  process.env.AICP_DATA_DIR = path.join(tmp, "data");
});
afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const options = {
  provider_mode: "mock" as const,
  approve_keyframes: true,
  budget_override_usd: null,
  ai_video_seconds_override: null,
  until: null,
  dry_run: true,
  brand_source: "snapshot" as const,
};

function supervisor(): JobSupervisor {
  return new JobSupervisor(openDb(), {
    runner: async (id) => {
      await executeJob(id, { log: () => undefined });
    },
  });
}

describe("job supervisor + job runner (in-process)", () => {
  it("plans a run under a budget hold, stops at the storyboard gate and releases the hold", async () => {
    const ledger = new BudgetLedger(openDb());
    ledger.saveSettings("bachalogy", {
      currency: "USD",
      wallet_amount: 20,
      daily_amount: 10,
      timezone: "UTC",
    });
    const run = createRun({
      brandId: "bachalogy",
      topic: "first steps",
      options,
      quiet: true,
      createdBy: "studio",
      title: "Domino test",
    });
    const sup = supervisor();
    const job = await sup.enqueue("start", run.runId, "bachalogy", { reason: "test" });
    expect(job.status).toBe("stopped");
    expect(job.result_status).toBe("stopped");
    expect(job.message).toMatch(/dry run/);
    expect(job.reservation_id).not.toBeNull();
    const res = ledger.reservationsForRun(run.runId);
    expect(res).toHaveLength(1);
    expect(res[0]?.status).toBe("released");
    expect(res[0]?.initial_hold_usd).toBeCloseTo(2.5, 6);
    expect(res[0]?.actual_usd ?? 0).toBeGreaterThan(0);
    const st = ledger.status("bachalogy");
    expect(st.wallet.spent_usd).toBeGreaterThan(0);
    expect(st.wallet.held_usd).toBe(0);
    // Every planning call booked a spend row with the mock provider mode.
    const rows = ledger.ledgerRows("bachalogy").filter((r) => r.kind === "spend");
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.every((r) => r.provider_mode === "mock")).toBe(true);
    expect(sup.liveForRun(run.runId)).toBeNull();
  }, 120_000);

  it("refuses to start when a budget rule blocks the hold, and names it", async () => {
    const ledger = new BudgetLedger(openDb());
    ledger.saveSettings("mindcode", { currency: "USD", daily_amount: 1, timezone: "UTC" });
    const run = createRun({ brandId: "mindcode", topic: "why habits stick", options, quiet: true });
    const job = await supervisor().enqueue("start", run.runId, "mindcode");
    expect(job.status).toBe("budget_conflict");
    expect(job.error).toMatch(/"daily"/);
    expect(ledger.reservationsForRun(run.runId)).toHaveLength(0);
  }, 60_000);

  it("honours a cancel flag at the next checkpoint and leaves the run resumable", async () => {
    const ledger = new BudgetLedger(openDb());
    ledger.saveSettings("bachalogy", { currency: "USD", wallet_amount: 100, daily_amount: 100 });
    const run = createRun({ brandId: "bachalogy", topic: "first steps", options, quiet: true });
    const db = openDb();
    const sup = new JobSupervisor(db, {
      runner: async (id) => {
        // Cancel is requested before the job starts: the first checkpoint must honour it.
        db.prepare(`UPDATE jobs SET cancel_requested_at = ? WHERE id = ?`).run(nowIso(), id);
        await executeJob(id, { log: () => undefined });
      },
    });
    const job = await sup.enqueue("start", run.runId, "bachalogy");
    expect(job.status).toBe("cancelled");
    expect(ledger.reservationsForRun(run.runId)[0]?.status).toBe("released");
    expect(ledger.reservationsForRun(run.runId)[0]?.release_reason).toBe("stopped");
    // Nothing was paid: the cancel landed before the first reservation.
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM generations WHERE run_id = ?`).get(run.runId),
    ).toEqual({ n: 0 });
    // A fresh resume completes the plan.
    const resumed = await supervisor().enqueue("resume", run.runId, "bachalogy");
    expect(resumed.status).toBe("stopped");
    expect(resumed.message).toMatch(/dry run/);
  }, 120_000);

  it("orphans a job whose process is gone and reconciles in-flight calls conservatively", () => {
    const db = openDb();
    const ledger = new BudgetLedger(db);
    const run = createRun({ brandId: "bachalogy", topic: "t", options, quiet: true });
    const sup = new JobSupervisor(db);
    const hold = ledger.admit({
      brandId: "bachalogy",
      runId: run.runId,
      jobId: "job-dead",
      holdUsd: 2,
      providerMode: "mock",
      label: "dead",
    });
    db.prepare(
      `INSERT INTO jobs (id, run_id, brand_id, kind, args, status, pid, reservation_id, created_at, started_at, heartbeat_at)
       VALUES ('job-dead', ?, 'bachalogy', 'start', '{}', 'running', 999999, ?, ?, ?, ?)`,
    ).run(
      run.runId,
      hold.reservationId,
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );
    const genId = run.repos.insertGeneration({
      run_id: run.runId,
      stage_id: "animate",
      shot_id: "shot_03",
      kind: "video",
      provider: "fal",
      model: "minimax/h3-max/image-to-video",
      label: "video:shot_03:v1",
      prompt_hash: null,
      prompt_version: null,
      brand_config_version: run.manifest.brand_config_version,
      source_assets: [],
      duration_s: 5,
      resolution: "768P",
      retries: 0,
      latency_ms: null,
      est_cost_usd: 0.4,
      actual_cost_usd: null,
      usage: null,
      status: "reserved",
      error: null,
    });
    const { orphaned } = sup.reconcile();
    expect(orphaned).toEqual(["job-dead"]);
    expect(sup.get("job-dead")?.status).toBe("orphaned");
    const gen = run.repos.getGeneration(genId);
    expect(gen?.status).toBe("failed");
    expect(gen?.reconciled).toBe("unknown_killed");
    expect(gen?.actual_cost_usd).toBeCloseTo(0.4, 6);
    expect(ledger.activeReservationForRun(run.runId)).toBeNull();
  });
});
