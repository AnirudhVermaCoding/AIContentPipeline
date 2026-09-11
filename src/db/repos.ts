import type { CostSource, NormalizedUsage } from "../providers/types.js";
import type { RunManifest, StageState } from "../schema/manifest.js";
import type { ShotRecord } from "../schema/shot.js";
import { nowIso } from "../util/fs.js";
import type { Db } from "./sqlite.js";

/**
 * One row per paid provider call. It is the spec's ProviderCall + UsageEvent + CostEvent in one:
 * what was asked (provider, model, prompt hash, references), what the vendor returned (request id,
 * usage units), what it cost (estimate at reservation, actual at completion, and where that
 * number comes from), and how it fits the run (stage, shot, attempt, retry lineage).
 */
export interface GenerationRow {
  id?: number;
  run_id: string;
  stage_id: string;
  shot_id: string | null;
  kind: "llm" | "image" | "video" | "tts" | "stock";
  provider: string;
  model: string;
  label: string | null;
  prompt_hash: string | null;
  prompt_version: string | null;
  brand_config_version: string;
  source_assets: string[];
  duration_s: number | null;
  resolution: string | null;
  retries: number;
  latency_ms: number | null;
  est_cost_usd: number;
  actual_cost_usd: number | null;
  usage: Record<string, unknown> | null;
  status: "reserved" | "completed" | "failed" | "refunded";
  error: string | null;
  created_at: string;
  // Studio additions (nullable for rows written before the columns existed).
  started_at: string | null;
  completed_at: string | null;
  request_id: string | null;
  attempt: number | null;
  retry_of: number | null;
  cost_source: CostSource | null;
  provider_cost_usd: number | null;
  pricing_version: string | null;
  fx_rate: number | null;
  fx_rate_id: number | null;
  provider_mode: "live" | "mock" | null;
  job_id: string | null;
  reservation_id: number | null;
  /** Set by the reaper when a job died mid-call: 'unknown_killed' (spend uncertain). */
  reconciled: string | null;
  /** used | superseded | rejected | failed — resolved by the studio when versions change. */
  outcome: string | null;
}

type GenerationInsert = Omit<
  GenerationRow,
  | "id"
  | "created_at"
  | "started_at"
  | "completed_at"
  | "request_id"
  | "attempt"
  | "retry_of"
  | "cost_source"
  | "provider_cost_usd"
  | "pricing_version"
  | "fx_rate"
  | "fx_rate_id"
  | "provider_mode"
  | "job_id"
  | "reservation_id"
  | "reconciled"
  | "outcome"
> &
  Partial<
    Pick<
      GenerationRow,
      | "started_at"
      | "attempt"
      | "retry_of"
      | "cost_source"
      | "pricing_version"
      | "fx_rate"
      | "fx_rate_id"
      | "provider_mode"
      | "job_id"
      | "reservation_id"
    >
  >;

export interface GenerationFinishPatch {
  status: GenerationRow["status"];
  actual_cost_usd: number | null;
  latency_ms: number | null;
  retries: number;
  usage: Record<string, unknown> | null;
  error: string | null;
  duration_s?: number | null;
  resolution?: string | null;
  completed_at?: string | null;
  request_id?: string | null;
  cost_source?: CostSource | null;
  provider_cost_usd?: number | null;
}

export interface SpendContext {
  brand_id: string;
  run_id: string;
  provider_mode: "live" | "mock";
  reservation_id: number | null;
  fx_rate_id: number | null;
  fx_rate: number | null;
  currency: string | null;
  actor?: string;
}

export interface FxRateRow {
  id: number;
  base: string;
  quote: string;
  rate: number;
  effective_at: string;
  source: string;
  note: string | null;
  created_at: string;
}

export interface AuditEntry {
  actor?: string;
  action: string;
  target_type: string;
  target_id: string;
  run_id?: string | null;
  shot_id?: string | null;
  details?: Record<string, unknown>;
}

function parseGeneration(r: Record<string, unknown>): GenerationRow {
  return {
    ...(r as unknown as GenerationRow),
    source_assets: JSON.parse((r.source_assets as string) ?? "[]"),
    usage: r.usage ? JSON.parse(r.usage as string) : null,
  };
}

export class Repos {
  constructor(readonly db: Db) {}

  upsertRun(m: RunManifest, runDir: string): void {
    this.db
      .prepare(
        `INSERT INTO runs (run_id, brand_id, brand_config_version, topic, status, created_at, updated_at,
           estimated_usd, spent_usd, run_dir, goal, product_id, title, provider_mode, created_by, hard_cap_usd)
         VALUES (@run_id, @brand_id, @brand_config_version, @topic, @status, @created_at, @updated_at,
           @estimated_usd, @spent_usd, @run_dir, @goal, @product_id, @title, @provider_mode, @created_by, @hard_cap_usd)
         ON CONFLICT(run_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at,
           estimated_usd=excluded.estimated_usd, spent_usd=excluded.spent_usd,
           brand_config_version=excluded.brand_config_version, goal=excluded.goal,
           product_id=excluded.product_id, title=excluded.title, provider_mode=excluded.provider_mode,
           created_by=excluded.created_by, hard_cap_usd=excluded.hard_cap_usd`,
      )
      .run({
        run_id: m.run_id,
        brand_id: m.brand_id,
        brand_config_version: m.brand_config_version,
        topic: m.topic,
        status: m.status,
        created_at: m.created_at,
        updated_at: m.updated_at,
        estimated_usd: m.cost.estimated_usd,
        spent_usd: m.cost.spent_usd,
        run_dir: runDir,
        goal: m.goal,
        product_id: m.product_id ?? null,
        title: m.title ?? null,
        provider_mode: m.options.provider_mode,
        created_by: m.created_by ?? null,
        hard_cap_usd: m.cost.hard_cap_usd,
      });
  }

  /** Summary columns the run history filters on; written by the render and final QC stages. */
  setRunSummary(
    runId: string,
    patch: { qc_status?: string | null; duration_s?: number | null },
  ): void {
    this.db
      .prepare(
        `UPDATE runs SET qc_status = COALESCE(?, qc_status), duration_s = COALESCE(?, duration_s) WHERE run_id = ?`,
      )
      .run(patch.qc_status ?? null, patch.duration_s ?? null, runId);
  }

  upsertStage(runId: string, stageId: string, s: StageState): void {
    this.db
      .prepare(
        `INSERT INTO stages (run_id, stage_id, status, inputs_hash, started_at, finished_at, duration_ms, cost_usd, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, stage_id) DO UPDATE SET status=excluded.status, inputs_hash=excluded.inputs_hash,
           started_at=excluded.started_at, finished_at=excluded.finished_at, duration_ms=excluded.duration_ms,
           cost_usd=excluded.cost_usd, error=excluded.error`,
      )
      .run(
        runId,
        stageId,
        s.status,
        s.inputs_hash,
        s.started_at,
        s.finished_at,
        s.duration_ms,
        s.cost_usd,
        s.error,
      );
  }

  upsertShot(runId: string, shot: ShotRecord): void {
    this.db
      .prepare(
        `INSERT INTO shots (run_id, shot_id, status, source, shot_hash, cost_usd, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, shot_id) DO UPDATE SET status=excluded.status, source=excluded.source,
           shot_hash=excluded.shot_hash, cost_usd=excluded.cost_usd, updated_at=excluded.updated_at`,
      )
      .run(
        runId,
        shot.shot_id,
        shot.status,
        shot.source,
        shot.shot_hash,
        shot.cost_usd,
        shot.updated_at,
      );
  }

  insertGeneration(row: GenerationInsert): number {
    const res = this.db
      .prepare(
        `INSERT INTO generations (run_id, stage_id, shot_id, kind, provider, model, label, prompt_hash, prompt_version,
           brand_config_version, source_assets, duration_s, resolution, retries, latency_ms, est_cost_usd, actual_cost_usd,
           usage, status, error, created_at, started_at, attempt, retry_of, cost_source, pricing_version, fx_rate,
           fx_rate_id, provider_mode, job_id, reservation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.run_id,
        row.stage_id,
        row.shot_id,
        row.kind,
        row.provider,
        row.model,
        row.label,
        row.prompt_hash,
        row.prompt_version,
        row.brand_config_version,
        JSON.stringify(row.source_assets),
        row.duration_s,
        row.resolution,
        row.retries,
        row.latency_ms,
        row.est_cost_usd,
        row.actual_cost_usd,
        row.usage ? JSON.stringify(row.usage) : null,
        row.status,
        row.error,
        nowIso(),
        row.started_at ?? nowIso(),
        row.attempt ?? null,
        row.retry_of ?? null,
        row.cost_source ?? "ESTIMATED",
        row.pricing_version ?? null,
        row.fx_rate ?? null,
        row.fx_rate_id ?? null,
        row.provider_mode ?? null,
        row.job_id ?? null,
        row.reservation_id ?? null,
      );
    return Number(res.lastInsertRowid);
  }

  finishGeneration(id: number, patch: GenerationFinishPatch): void {
    this.db
      .prepare(
        `UPDATE generations SET status=?, actual_cost_usd=?, latency_ms=?, retries=?, usage=?, error=?,
           duration_s=COALESCE(?, duration_s), resolution=COALESCE(?, resolution),
           completed_at=COALESCE(?, completed_at), request_id=COALESCE(?, request_id),
           cost_source=COALESCE(?, cost_source), provider_cost_usd=COALESCE(?, provider_cost_usd)
         WHERE id=?`,
      )
      .run(
        patch.status,
        patch.actual_cost_usd,
        patch.latency_ms,
        patch.retries,
        patch.usage ? JSON.stringify(patch.usage) : null,
        patch.error,
        patch.duration_s ?? null,
        patch.resolution ?? null,
        patch.completed_at ?? nowIso(),
        patch.request_id ?? null,
        patch.cost_source ?? null,
        patch.provider_cost_usd ?? null,
        id,
      );
  }

  /**
   * Complete a paid call and book its spend in one write transaction: the ledger row, the brand
   * spend entry (also for calls the vendor charged although they failed) and the decrement of the
   * job's budget hold. BEGIN IMMEDIATE so concurrent job processes serialise on the write lock.
   */
  completeGeneration(id: number, patch: GenerationFinishPatch, spend: SpendContext): void {
    const tx = this.db.transaction(() => {
      this.finishGeneration(id, patch);
      const amount = patch.actual_cost_usd ?? 0;
      if (amount > 0) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO budget_ledger (brand_id, run_id, generation_id, reservation_id, kind, amount_usd,
               amount_display, currency, fx_rate, fx_rate_id, provider_mode, actor, note, created_at)
             VALUES (?, ?, ?, ?, 'spend', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            spend.brand_id,
            spend.run_id,
            id,
            spend.reservation_id,
            amount,
            spend.fx_rate ? amount * spend.fx_rate : null,
            spend.currency,
            spend.fx_rate,
            spend.fx_rate_id,
            spend.provider_mode,
            spend.actor ?? "system",
            patch.status === "failed" ? "charged although the call failed" : null,
            patch.completed_at ?? nowIso(),
          );
        if (spend.reservation_id != null) {
          this.db
            .prepare(
              `UPDATE budget_reservations SET hold_usd = MAX(0, hold_usd - ?) WHERE id = ? AND status = 'active'`,
            )
            .run(amount, spend.reservation_id);
        }
      }
    });
    tx.immediate();
  }

  listGenerations(runId: string): GenerationRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM generations WHERE run_id = ? ORDER BY id`)
      .all(runId) as Array<Record<string, unknown>>;
    return rows.map(parseGeneration);
  }

  getGeneration(id: number): GenerationRow | undefined {
    const row = this.db.prepare(`SELECT * FROM generations WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? parseGeneration(row) : undefined;
  }

  /** Money actually spent by a run: completed calls plus calls the vendor charged despite failing. */
  spentForRun(runId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(COALESCE(actual_cost_usd, 0)), 0) AS spent FROM generations
         WHERE run_id = ? AND status IN ('completed', 'failed')`,
      )
      .get(runId) as { spent: number };
    return row.spent;
  }

  listRuns(limit = 20): Array<{
    run_id: string;
    brand_id: string;
    topic: string;
    status: string;
    updated_at: string;
    spent_usd: number;
    run_dir: string;
  }> {
    return this.db
      .prepare(
        `SELECT run_id, brand_id, topic, status, updated_at, spent_usd, run_dir FROM runs ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as ReturnType<Repos["listRuns"]>;
  }

  findRun(runId: string): { run_dir: string; brand_id: string } | undefined {
    return this.db.prepare(`SELECT run_dir, brand_id FROM runs WHERE run_id = ?`).get(runId) as
      | { run_dir: string; brand_id: string }
      | undefined;
  }

  insertQc(
    runId: string,
    stageId: string,
    shotId: string | null,
    status: string,
    report: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT INTO qc_results (run_id, stage_id, shot_id, status, report, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(runId, stageId, shotId, status, JSON.stringify(report), nowIso());
  }

  insertAsset(a: {
    id: string;
    brand_id: string;
    run_id: string | null;
    shot_id: string | null;
    kind: string;
    path: string;
    description: string;
    tags: string[];
    entities: string[];
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO assets (id, brand_id, run_id, shot_id, kind, path, description, tags, entities, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.id,
        a.brand_id,
        a.run_id,
        a.shot_id,
        a.kind,
        a.path,
        a.description,
        JSON.stringify(a.tags),
        JSON.stringify(a.entities),
        nowIso(),
      );
  }

  /** Latest configured FX rate for a pair, or null when none was ever recorded. */
  currentFxRate(base: string, quote: string): FxRateRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM fx_rates WHERE base = ? AND quote = ? ORDER BY effective_at DESC, id DESC LIMIT 1`,
      )
      .get(base, quote) as FxRateRow | undefined;
    return row ?? null;
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM studio_settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO studio_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, nowIso());
  }

  audit(entry: AuditEntry): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (ts, actor, action, target_type, target_id, run_id, shot_id, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nowIso(),
        entry.actor ?? "local-user",
        entry.action,
        entry.target_type,
        entry.target_id,
        entry.run_id ?? null,
        entry.shot_id ?? null,
        JSON.stringify(entry.details ?? {}),
      );
  }
}

/** Build the normalised usage record the ledger stores, whatever the capability returned. */
export function normalizeUsage(result: Record<string, unknown>): NormalizedUsage | null {
  const usage = result.usage as Record<string, unknown> | undefined;
  const out: NormalizedUsage = {};
  if (usage && typeof usage === "object" && "inputTokens" in usage) {
    out.input_tokens = Number(usage.inputTokens ?? 0);
    out.cached_input_tokens = Number(usage.cachedInputTokens ?? 0);
    out.output_tokens = Number(usage.outputTokens ?? 0);
    out.reasoning_tokens = Number(usage.reasoningTokens ?? 0);
  }
  if ("image" in result) out.image_count = 1;
  if (typeof result.durationSeconds === "number") out.video_seconds = result.durationSeconds;
  if (typeof result.characters === "number") out.audio_characters = result.characters;
  return Object.keys(out).length ? out : null;
}
