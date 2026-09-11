import type { GenerationRow } from "../db/repos.js";
import type { CallMeta } from "../providers/types.js";
import { errorMessage } from "../util/errors.js";
import { sha256 } from "../util/fs.js";
import type { RunContext } from "./run.js";

export interface PaidCallInfo {
  stageId: string;
  shotId?: string | null;
  kind: GenerationRow["kind"];
  provider: string;
  model: string;
  label: string;
  estimateUsd: number;
  prompt?: string;
  promptVersion?: string;
  sourceAssets?: string[];
  durationS?: number | null;
  resolution?: string | null;
}

/**
 * Wrap every paid provider call: reserve against the hard cap, execute, reconcile the actual
 * cost, and write the ledger row. Failures refund the reservation and are recorded too.
 */
export async function paidCall<T extends CallMeta>(
  run: RunContext,
  info: PaidCallInfo,
  fn: () => Promise<T>,
): Promise<T> {
  const reservation = run.budget.reserve(info.estimateUsd, info.label);
  const rowId = run.repos.insertGeneration({
    run_id: run.runId,
    stage_id: info.stageId,
    shot_id: info.shotId ?? null,
    kind: info.kind,
    provider: info.provider,
    model: info.model,
    label: info.label,
    prompt_hash: info.prompt ? sha256(info.prompt).slice(0, 16) : null,
    prompt_version: info.promptVersion ?? null,
    brand_config_version: run.manifest.brand_config_version,
    source_assets: info.sourceAssets ?? [],
    duration_s: info.durationS ?? null,
    resolution: info.resolution ?? null,
    retries: 0,
    latency_ms: null,
    est_cost_usd: info.estimateUsd,
    actual_cost_usd: null,
    usage: null,
    status: "reserved",
    error: null,
  });
  run.save();
  const started = Date.now();
  try {
    const result = await fn();
    run.budget.commit(reservation, result.costUsd);
    run.repos.finishGeneration(rowId, {
      status: "completed",
      actual_cost_usd: result.costUsd,
      latency_ms: result.latencyMs ?? Date.now() - started,
      retries: 0,
      usage:
        "usage" in result ? ((result as { usage: Record<string, unknown> }).usage ?? null) : null,
      error: null,
      duration_s:
        "durationSeconds" in result
          ? (result as { durationSeconds: number }).durationSeconds
          : undefined,
      resolution:
        "resolution" in result ? (result as { resolution: string }).resolution : undefined,
    });
    run.save();
    return result;
  } catch (err) {
    run.budget.refund(reservation);
    run.repos.finishGeneration(rowId, {
      status: "failed",
      actual_cost_usd: 0,
      latency_ms: Date.now() - started,
      retries: 0,
      usage: null,
      error: errorMessage(err),
    });
    run.save();
    throw err;
  }
}
