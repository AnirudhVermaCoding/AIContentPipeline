import { PRICING_AS_OF } from "../config/pricing.js";
import { type GenerationRow, normalizeUsage, type SpendContext } from "../db/repos.js";
import type { CallMeta } from "../providers/types.js";
import { errorMessage, PipelineError } from "../util/errors.js";
import { nowIso, sha256 } from "../util/fs.js";
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
  /** Version number of the artifact this call produces (keyframe_v3 → 3). */
  attempt?: number | null;
  /** Ledger id of the call this one replaces (a retry or a regeneration). */
  retryOf?: number | null;
}

/**
 * Wrap every paid provider call: honour a pause/cancel request, reserve against the hard cap,
 * execute, reconcile the actual cost, and write the ledger row plus the brand spend entry in one
 * transaction. A failed call keeps whatever the vendor charged; it is never recorded as free.
 */
export async function paidCall<T extends CallMeta>(
  run: RunContext,
  info: PaidCallInfo,
  fn: () => Promise<T>,
): Promise<T> {
  run.control?.checkpoint(`before ${info.label}`);
  const reservation = run.budget.reserve(info.estimateUsd, info.label);
  const fx = run.fx;
  const spend: SpendContext = {
    brand_id: run.manifest.brand_id,
    run_id: run.runId,
    provider_mode: run.options.provider_mode,
    reservation_id: run.budgetHold?.reservationId ?? null,
    fx_rate_id: fx?.id ?? null,
    fx_rate: fx?.rate ?? null,
    currency: fx?.currency ?? "USD",
  };
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
    started_at: nowIso(),
    attempt: info.attempt ?? null,
    retry_of: info.retryOf ?? null,
    cost_source: "ESTIMATED",
    pricing_version: PRICING_AS_OF,
    fx_rate: fx?.rate ?? null,
    fx_rate_id: fx?.id ?? null,
    provider_mode: run.options.provider_mode,
    job_id: run.jobId,
    reservation_id: run.budgetHold?.reservationId ?? null,
  });
  run.save();
  const started = Date.now();
  try {
    const result = await fn();
    run.budget.commit(reservation, result.costUsd);
    run.repos.completeGeneration(
      rowId,
      {
        status: "completed",
        actual_cost_usd: result.costUsd,
        latency_ms: result.latencyMs ?? Date.now() - started,
        retries: 0,
        usage: normalizeUsage(result as unknown as Record<string, unknown>) as Record<
          string,
          unknown
        > | null,
        error: null,
        duration_s:
          "durationSeconds" in result
            ? (result as { durationSeconds: number }).durationSeconds
            : undefined,
        resolution:
          "resolution" in result ? (result as { resolution: string }).resolution : undefined,
        completed_at: nowIso(),
        request_id: result.requestId ?? null,
        cost_source: result.costSource ?? "CALCULATED_FROM_USAGE",
        provider_cost_usd: result.providerCostUsd ?? null,
      },
      spend,
    );
    run.save();
    return result;
  } catch (err) {
    const charged = err instanceof PipelineError ? err.charged : undefined;
    const chargedUsd = charged && charged.costUsd > 0 ? charged.costUsd : 0;
    if (chargedUsd > 0) run.budget.commit(reservation, chargedUsd);
    else run.budget.refund(reservation);
    run.repos.completeGeneration(
      rowId,
      {
        status: "failed",
        actual_cost_usd: chargedUsd,
        latency_ms: Date.now() - started,
        retries: 0,
        usage: charged?.usage ?? null,
        error: errorMessage(err),
        completed_at: nowIso(),
        request_id: charged?.requestId ?? null,
        cost_source: chargedUsd > 0 ? "CALCULATED_FROM_USAGE" : null,
      },
      spend,
    );
    run.save();
    throw err;
  }
}
