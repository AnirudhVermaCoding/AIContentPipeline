import { z } from "zod";

export const StageStatus = z.enum([
  "pending",
  "running",
  "done",
  "failed",
  "waiting_approval",
  "budget_conflict",
  "skipped",
]);
export type StageStatus = z.infer<typeof StageStatus>;

export const StageState = z.object({
  status: StageStatus,
  inputs_hash: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  cost_usd: z.number(),
  attempt: z.number(),
  error: z.string().nullable(),
});
export type StageState = z.infer<typeof StageState>;

export const RunStatus = z.enum([
  "running",
  "done",
  "failed",
  "waiting_approval",
  "budget_conflict",
  "stopped",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunOptions = z.object({
  provider_mode: z.enum(["live", "mock"]),
  approve_keyframes: z.boolean(),
  budget_override_usd: z.number().nullable(),
  ai_video_seconds_override: z.number().nullable(),
  until: z.string().nullable().describe("Stop after this stage id"),
  dry_run: z.boolean().describe("Stop before the first paid media generation"),
  /**
   * Which brand profile a resumed run uses: the live brands/<id>/brand.yaml (CLI default, edits
   * invalidate downstream stages) or the snapshot written when the run was created (studio
   * default, so provenance never changes underneath a run).
   */
  brand_source: z.enum(["live", "snapshot"]).optional(),
  /** Keep continuity entries of unchanged shots verbatim on re-run so their shot hashes survive. */
  continuity_merge: z.enum(["preserve_unchanged", "full"]).optional(),
});
export type RunOptions = z.infer<typeof RunOptions>;

export const ProviderSnapshot = z.object({
  llm_creative: z.object({ provider: z.string(), model: z.string() }),
  llm_fast: z.object({ provider: z.string(), model: z.string() }),
  image: z.object({ provider: z.string(), model: z.string() }),
  video: z.object({ provider: z.string(), model: z.string() }),
  tts: z.object({ provider: z.string(), model: z.string() }),
});
export type ProviderSnapshot = z.infer<typeof ProviderSnapshot>;

export const RunManifestSchema = z.object({
  run_id: z.string(),
  brand_id: z.string(),
  brand_config_version: z.string(),
  topic: z.string(),
  goal: z.string().nullable(),
  /** Product from the brand's catalog this video is about (null for topic-only runs). */
  product_id: z.string().nullable().optional(),
  /** Human title shown in the studio; defaults to the topic. */
  title: z.string().nullable().optional(),
  created_by: z.enum(["cli", "studio", "test"]).optional(),
  created_at: z.string(),
  updated_at: z.string(),
  status: RunStatus,
  options: RunOptions,
  providers: ProviderSnapshot,
  stages: z.record(z.string(), StageState),
  cost: z.object({
    hard_cap_usd: z.number(),
    target_usd: z.number(),
    ai_video_seconds_target: z.number(),
    estimated_usd: z.number(),
    spent_usd: z.number(),
    reserved_usd: z.number(),
  }),
  last_error: z.string().nullable(),
  /** Why a run is `stopped` when the operator paused or cancelled it (null otherwise). */
  stop_reason: z.enum(["paused", "cancelled", "dry_run", "until"]).nullable().optional(),
});
export type RunManifest = z.infer<typeof RunManifestSchema>;
