import * as path from "node:path";
import type { z } from "zod";
import type { StageState } from "../schema/manifest.js";
import {
  BudgetConflictError,
  BudgetExceededError,
  errorMessage,
  RunInterruptedError,
} from "../util/errors.js";
import { nowIso, shortHash, writeJsonAtomic } from "../util/fs.js";
import type { RunContext } from "./run.js";
import { OUTPUT_FILE } from "./run.js";
import type { StageContext, StageDef, StageOutcome } from "./stage.js";

export interface RunResult {
  status: "done" | "stopped" | "waiting_approval" | "budget_conflict" | "failed";
  lastStage: string | null;
  message?: string;
}

function emptyState(): StageState {
  return {
    status: "pending",
    inputs_hash: null,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    cost_usd: 0,
    attempt: 0,
    error: null,
  };
}

export function computeInputsHash(run: RunContext, stage: StageDef, all: StageDef[]): string {
  const byId = new Map(all.map((s) => [s.id, s]));
  const upstream: Record<string, string | null> = {};
  for (const dep of stage.dependsOn) {
    const def = byId.get(dep);
    upstream[dep] = def ? run.outputHash(def.dir) : null;
  }
  return shortHash({
    stage: stage.id,
    version: stage.version,
    brand: run.manifest.brand_config_version,
    providers: run.manifest.providers,
    upstream,
    extra: stage.extraInputs?.(run) ?? null,
  });
}

/**
 * Walks the ordered stage list. A stage is skipped when it is already done with the same inputs
 * hash; otherwise it runs. Stops on failure, budget exhaustion/conflict, a pending approval, an
 * operator pause/cancel, or the `until` option.
 */
export async function runStages(run: RunContext, stages: StageDef[]): Promise<RunResult> {
  const m = run.manifest;
  m.status = "running";
  m.last_error = null;
  m.stop_reason = null;
  run.save();
  let last: string | null = null;

  for (const stage of stages) {
    const state = m.stages[stage.id] ?? emptyState();
    m.stages[stage.id] = state;
    const inputsHash = computeInputsHash(run, stage, stages);

    if (state.status === "done" && state.inputs_hash === inputsHash && run.hasOutput(stage.dir)) {
      run.events.info(stage.id, "up to date, skipping");
      last = stage.id;
      if (run.options.until === stage.id)
        return finish(run, "stopped", last, `stopped after ${stage.id}`, "until");
      continue;
    }
    if (state.status === "done" && state.inputs_hash !== inputsHash) {
      run.events.info(stage.id, "inputs changed, re-running");
    }
    if (stage.paidMedia && run.options.dry_run) {
      return finish(run, "stopped", last, `dry run: stopping before ${stage.id}`, "dry_run");
    }
    // Cooperative pause/cancel between stages: nothing has been reserved yet, so simply stop.
    try {
      run.control?.checkpoint(`before ${stage.id}`);
    } catch (err) {
      if (err instanceof RunInterruptedError) {
        return finish(run, "stopped", last, err.message, err.kind);
      }
      throw err;
    }

    state.status = "running";
    state.inputs_hash = inputsHash;
    state.started_at = nowIso();
    state.finished_at = null;
    state.error = null;
    state.attempt += 1;
    run.save();
    run.repos.upsertStage(run.runId, stage.id, state);
    run.control?.progress?.({ stage: stage.id, shot: null });
    const startedMs = Date.now();
    const spentBefore = run.budget.spentUsd;

    const stageDir = run.stageDir(stage.dir);
    const ctx: StageContext = {
      run,
      stage,
      stageDir,
      writeOutput: (value) => {
        const file = path.join(stageDir, OUTPUT_FILE);
        writeJsonAtomic(file, value);
        return file;
      },
      input: <T>(stageId: string, schema: z.ZodType<T>): T => {
        const def = stages.find((s) => s.id === stageId);
        if (!def) throw new Error(`Unknown upstream stage ${stageId}`);
        return run.readOutput(def.dir, schema);
      },
      file: (name) => path.join(stageDir, name),
    };

    let outcome: StageOutcome;
    try {
      run.events.info(stage.id, "running");
      outcome = await stage.run(ctx);
    } catch (err) {
      state.finished_at = nowIso();
      state.duration_ms = Date.now() - startedMs;
      state.cost_usd += run.budget.spentUsd - spentBefore;
      if (err instanceof RunInterruptedError) {
        // Work already paid for is on disk (shot records, cached lines); the stage simply
        // re-runs on resume and reuses it. Nothing is marked failed.
        state.status = "pending";
        state.error = null;
        m.status = "stopped";
        m.stop_reason = err.kind;
        m.last_error = null;
        run.events.warn(stage.id, err.message);
        run.save();
        run.repos.upsertStage(run.runId, stage.id, state);
        return { status: "stopped", lastStage: last, message: err.message };
      }
      if (err instanceof BudgetExceededError) {
        state.status = "budget_conflict";
        state.error = err.message;
        m.status = "budget_conflict";
        m.last_error = err.message;
        run.events.error(stage.id, err.message);
        run.save();
        run.repos.upsertStage(run.runId, stage.id, state);
        return { status: "budget_conflict", lastStage: stage.id, message: err.message };
      }
      if (err instanceof BudgetConflictError) {
        state.status = "budget_conflict";
        state.error = err.message;
        m.status = "budget_conflict";
        m.last_error = err.message;
        run.events.error(stage.id, err.message, { alternatives: err.alternatives });
        run.save();
        run.repos.upsertStage(run.runId, stage.id, state);
        return { status: "budget_conflict", lastStage: stage.id, message: err.message };
      }
      state.status = "failed";
      state.error = errorMessage(err);
      m.status = "failed";
      m.last_error = state.error;
      run.events.error(stage.id, `failed: ${state.error}`);
      run.save();
      run.repos.upsertStage(run.runId, stage.id, state);
      return { status: "failed", lastStage: stage.id, message: state.error };
    }

    state.finished_at = nowIso();
    state.duration_ms = Date.now() - startedMs;
    state.cost_usd += run.budget.spentUsd - spentBefore;
    writeJsonAtomic(path.join(stageDir, "meta.json"), {
      stage: stage.id,
      version: stage.version,
      inputs_hash: inputsHash,
      brand_config_version: m.brand_config_version,
      providers: m.providers,
      started_at: state.started_at,
      finished_at: state.finished_at,
      duration_ms: state.duration_ms,
      cost_usd: state.cost_usd,
      outcome: outcome.status,
    });
    last = stage.id;

    if (outcome.status === "waiting_approval") {
      state.status = "waiting_approval";
      m.status = "waiting_approval";
      run.events.warn(stage.id, outcome.message);
      run.save();
      run.repos.upsertStage(run.runId, stage.id, state);
      return { status: "waiting_approval", lastStage: stage.id, message: outcome.message };
    }
    if (outcome.status === "budget_conflict") {
      state.status = "budget_conflict";
      state.error = outcome.message;
      m.status = "budget_conflict";
      m.last_error = outcome.message;
      run.events.error(stage.id, outcome.message, { alternatives: outcome.alternatives });
      run.save();
      run.repos.upsertStage(run.runId, stage.id, state);
      return { status: "budget_conflict", lastStage: stage.id, message: outcome.message };
    }

    state.status = "done";
    run.events.info(
      stage.id,
      `done in ${(state.duration_ms / 1000).toFixed(1)}s, cost $${(run.budget.spentUsd - spentBefore).toFixed(3)}`,
    );
    run.save();
    run.repos.upsertStage(run.runId, stage.id, state);

    if (run.options.until === stage.id) {
      return finish(run, "stopped", last, `stopped after ${stage.id}`, "until");
    }
  }
  return finish(run, "done", last);
}

function finish(
  run: RunContext,
  status: "done" | "stopped",
  last: string | null,
  message?: string,
  reason: "paused" | "cancelled" | "dry_run" | "until" | null = null,
): RunResult {
  run.manifest.status = status === "done" ? "done" : "stopped";
  run.manifest.stop_reason = status === "done" ? null : reason;
  run.save();
  if (message) run.events.info(null, message);
  return { status, lastStage: last, message };
}

/** Reset a stage and everything after it so they re-run (files are kept for per-shot reuse). */
export function resetFrom(run: RunContext, stages: StageDef[], fromStageId: string): string[] {
  const idx = stages.findIndex((s) => s.id === fromStageId);
  if (idx < 0) throw new Error(`Unknown stage ${fromStageId}`);
  const reset: string[] = [];
  for (const s of stages.slice(idx)) {
    const st = run.manifest.stages[s.id];
    if (st) {
      st.status = "pending";
      st.inputs_hash = null;
      st.error = null;
      reset.push(s.id);
      run.repos.upsertStage(run.runId, s.id, st);
    }
  }
  run.manifest.status = "running";
  run.save();
  return reset;
}
