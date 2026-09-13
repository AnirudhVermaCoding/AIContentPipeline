/**
 * Response shapes of the studio API. The Next.js app imports this file with `import type` only,
 * so the UI never bundles pipeline code and both sides agree on one contract.
 *
 * Money: every amount is canonical USD. Responses that show money carry an `fx` snapshot
 * (rate id + rate + display currency) so the UI converts consistently and never invents a rate.
 */

import type { ProductProfile, ProductReference } from "../brand/products.js";
import type { BrandProfile } from "../brand/schema.js";
import type {
  BudgetNotice,
  BudgetStatus,
  BudgetWindow,
  FxSnapshot,
  LedgerRow,
  ReservationRow,
} from "../budget/ledger.js";
import type { CostReport } from "../cost/report.js";
import type {
  ControlRange,
  ControlSource,
  CreativePreset,
  VariationOption,
} from "../creative/controls.js";
import type { GenerationRow } from "../db/repos.js";
import type { Decision, PipelineEvent } from "../pipeline/events.js";
import type { DirectorRecord } from "../pipeline/stages/00-brief.js";
import type { ShotProgress } from "../pipeline/stages/08-animate.js";
import type { RenderProgressFile } from "../pipeline/stages/11-render.js";
import type { CostSource, NormalizedUsage } from "../providers/types.js";
import type { CreativeBrief } from "../schema/brief.js";
import type { ContinuityBible } from "../schema/continuity.js";
import type {
  CreativeControls,
  PendingRegeneration,
  VariationStrength,
} from "../schema/creative.js";
import type { Edl } from "../schema/edl.js";
import type { RunManifest, RunStatus, StageStatus } from "../schema/manifest.js";
import type { FinalQcReport } from "../schema/qc.js";
import type { RoutingPlan, ShotRoute } from "../schema/routing.js";
import type { Script } from "../schema/script.js";
import type { ShotAttempt, ShotRecord } from "../schema/shot.js";
import type { Shot, StoryboardArtifact } from "../schema/storyboard.js";
import type { VoiceResult } from "../schema/voice.js";
import type { JobRow, JobStatus } from "./jobs.js";

export type {
  BrandProfile,
  BudgetNotice,
  BudgetStatus,
  BudgetWindow,
  ContinuityBible,
  CostReport,
  CostSource,
  CreativeBrief,
  Decision,
  Edl,
  FinalQcReport,
  FxSnapshot,
  GenerationRow,
  JobRow,
  JobStatus,
  LedgerRow,
  NormalizedUsage,
  PipelineEvent,
  ProductProfile,
  ProductReference,
  RenderProgressFile,
  ReservationRow,
  RoutingPlan,
  RunManifest,
  RunStatus,
  Script,
  Shot,
  ShotAttempt,
  ShotProgress,
  ShotRecord,
  ShotRoute,
  StageStatus,
  StoryboardArtifact,
  VoiceResult,
};

export type PerShotContinuity = ContinuityBible["per_shot"][number];

export type UiStageStatus =
  | "waiting"
  | "running"
  | "complete"
  | "failed"
  | "skipped"
  | "awaiting_approval";

export type UiRunStatus =
  | "planning"
  | "awaiting_storyboard_approval"
  | "awaiting_keyframe_approval"
  | "producing"
  | "rendering"
  | "complete"
  | "failed"
  | "budget_conflict"
  | "paused"
  | "cancelled"
  | "interrupted"
  | "stopped";

export interface ProviderStatus {
  capability: "llm_creative" | "llm_fast" | "image" | "video" | "tts";
  provider: string;
  model: string;
  env_keys: string[];
  configured: boolean;
  priced: boolean;
  connectivity: "connected" | "unreachable" | "not_checked" | "unknown";
  detail: string | null;
}

export interface ToolStatus {
  id: "remotion" | "ffmpeg" | "chromium" | "sqlite" | "runs_dir";
  label: string;
  status: "ready" | "missing" | "error";
  detail: string | null;
}

export interface HealthReport {
  provider_mode: "live" | "mock";
  providers: ProviderStatus[];
  tools: ToolStatus[];
  pricing: { as_of: string; stale: boolean };
  paths: { root: string; runs: string; data: string; brands: string };
  checked_at: string;
}

export interface ProductView {
  id: string;
  brand_id: string;
  name: string;
  category: string;
  description: string;
  entity_id: string;
  profile: ProductProfile;
  version: string;
  references: Array<ProductReference & { url: string | null; exists: boolean; abs: string }>;
  warnings: string[];
  reference_count: number;
  approved_assets: AssetView[];
  runs_count: number;
}

export interface AssetView {
  id: string;
  kind: string;
  run_id: string | null;
  shot_id: string | null;
  path: string;
  url: string;
  description: string;
  created_at: string;
}

/** Resolved creative controls with labels; `sources` says where each value came from. */
export interface CreativeView extends CreativeControls {
  creative_label: string;
  goal_label: string;
  sources: { creative_freedom: ControlSource; goal_focus: ControlSource };
  /** Matching preset id, when the pair equals one of the presets. */
  preset: string | null;
}

export interface CreativeSettingsView {
  defaults: CreativeControls;
  presets: CreativePreset[];
  creative_ranges: ControlRange[];
  goal_ranges: ControlRange[];
  variation_options: VariationOption[];
}

export interface BrandSummary {
  id: string;
  name: string;
  tagline: string;
  audience: string;
  product_name: string;
  description: string;
  direction_summary: string;
  version: string;
  colors: BrandProfile["visual"]["colors"];
  fonts: BrandProfile["visual"]["fonts"];
  logo_url: string | null;
  pillars: string[];
  tone: string[];
  emotions: string[];
  budget: BrandProfile["budget"];
  voice_configured: boolean;
  products_count: number;
  /** The brand's default creative controls (brand.yaml `creative_defaults`, else the fallbacks). */
  creative: CreativeView;
}

export interface BrandDetail extends BrandSummary {
  profile: BrandProfile;
  file: string;
  versions: BrandVersionView[];
  products: ProductView[];
  providers: RunManifest["providers"];
}

export interface BrandVersionView {
  version: string;
  created_at: string;
  actor: string;
  note: string | null;
  file: string | null;
  current: boolean;
  runs_count: number;
}

export interface CallSummary {
  id: number;
  stage_id: string;
  shot_id: string | null;
  kind: GenerationRow["kind"];
  provider: string;
  model: string;
  label: string | null;
  status: GenerationRow["status"];
  est_cost_usd: number;
  actual_cost_usd: number | null;
  cost_source: CostSource | null;
  provider_cost_usd: number | null;
  usage: NormalizedUsage | null;
  latency_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  request_id: string | null;
  attempt: number | null;
  pricing_version: string | null;
  fx_rate: number | null;
  provider_mode: string | null;
  reconciled: string | null;
  outcome: "used" | "superseded" | "failed" | "pending";
  error: string | null;
  prompt_version: string | null;
  duration_s: number | null;
  resolution: string | null;
}

export interface StageView {
  id: string;
  label: string;
  dir: string | null;
  synthetic: boolean;
  status: StageStatus | null;
  ui_status: UiStageStatus;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  cost_usd: number;
  attempt: number;
  error: string | null;
  calls: CallSummary[];
  models: string[];
  usage: NormalizedUsage;
  retries: number;
  failed_calls: number;
  note: string | null;
}

export interface VersionView {
  kind: "keyframe" | "video";
  attempt: number;
  path: string | null;
  url: string | null;
  status: ShotAttempt["status"];
  selected: boolean;
  approved: boolean;
  cost_usd: number;
  cost_source: CostSource | null;
  generation_id: number | null;
  request_id: string | null;
  provider: string;
  model: string;
  prompt: string;
  prompt_version: string;
  refs: Array<{ path: string; url: string }>;
  params: Record<string, unknown>;
  /** Variation strength the operator chose when this version was regenerated (null otherwise). */
  variation_strength: VariationStrength | null;
  checks: ShotAttempt["checks"];
  latency_ms: number;
  error: string | null;
  created_at: string | null;
  archived: boolean;
}

export interface ShotView {
  shot_id: string;
  index: number;
  storyboard: Shot | null;
  start_s: number | null;
  end_s: number | null;
  route: ShotRoute | null;
  continuity: PerShotContinuity | null;
  record: ShotRecord | null;
  status: ShotRecord["status"] | "not_started";
  approval: ShotRecord["approval"]["status"] | "none";
  approval_note: string | null;
  keyframe_url: string | null;
  keyframe_version: number | null;
  video_url: string | null;
  video_version: number | null;
  final_url: string | null;
  final_kind: "video" | "image" | null;
  references: Array<{ path: string; url: string; view: string | null; identity_critical: boolean }>;
  versions: { keyframes: VersionView[]; clips: VersionView[] };
  progress: ShotProgress | null;
  cost_usd: number;
  expected_cost_usd: number | null;
  regenerate_keyframe_estimate_usd: number;
  regenerate_clip_estimate_usd: number | null;
  animation: {
    kind: "GEN_VIDEO" | "STILL_MOTION" | "STILL" | "other";
    label: string;
    seconds: number | null;
    provider: string;
    model: string;
  };
  last_error: string | null;
}

export interface CostBreakdown {
  original_estimate_usd: number;
  preplan_estimate: EstimateRange | null;
  reserved_usd: number | null;
  actual_usd: number;
  successful_usd: number;
  failed_usd: number;
  retry_usd: number;
  returned_usd: number | null;
  unknown_usd: number;
  by_stage: Array<{ stage_id: string; label: string; usd: number; calls: number; failed: number }>;
  by_shot: Array<{ shot_id: string; usd: number; successful_usd: number; wasted_usd: number }>;
  by_provider: Array<{ provider: string; usd: number; calls: number }>;
  by_model: Array<{
    provider: string;
    model: string;
    kind: string;
    usd: number;
    calls: number;
    usage: NormalizedUsage;
  }>;
  by_source: Record<CostSource, number>;
  calls: CallSummary[];
  reservations: ReservationRow[];
  pricing_version: string;
  pricing_stale: boolean;
  fx: FxSnapshot;
}

export interface EstimateRange {
  min_usd: number;
  max_usd: number;
  typical_usd: number;
  planning_usd: number;
  source: "ESTIMATED";
  breakdown: Array<{ item: string; min_usd: number; max_usd: number; note: string }>;
  assumptions: string[];
}

export interface BudgetCheckView {
  ok: boolean;
  blocking_rule: string | null;
  reason: string | null;
  hold_usd: number;
  windows: BudgetWindow[];
  after_run_usd: {
    daily_remaining: number | null;
    wallet_remaining: number | null;
    two_day_remaining: number | null;
  };
}

export interface PreflightView {
  stage: "pre_plan" | "planned";
  estimate: EstimateRange;
  route_estimate_usd: number | null;
  hard_cap_usd: number;
  max_exposure_usd: number;
  budget: BudgetCheckView;
  shots: number | null;
  ai_video_seconds: number | null;
  images: number | null;
  narration: "voice" | "music_only" | null;
  duration_s: number | null;
  concept: string | null;
  emotional_arc: CreativeBrief["emotional_arc"] | null;
  alternatives: RoutingPlan["budget_check"]["alternatives"];
  promise: RoutingPlan["promise_check"] | null;
  /** The run's creative controls and how many concept candidates the director drafts. */
  creative: { controls: CreativeView; candidate_count: number };
}

export interface JobView extends JobRow {
  alive: boolean;
  in_flight: Array<{
    id: number;
    label: string | null;
    started_at: string | null;
    provider: string;
    model: string;
    est_cost_usd: number;
    shot_id: string | null;
  }>;
  cancel_state: "none" | "requested" | "waiting_for_in_flight_call" | "stopped";
}

export interface RunSummary {
  run_id: string;
  brand_id: string;
  brand_name: string;
  title: string;
  topic: string;
  goal: string | null;
  product_id: string | null;
  product_name: string | null;
  status: RunStatus;
  stop_reason: RunManifest["stop_reason"] | null;
  ui_status: UiRunStatus;
  ui_status_label: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  provider_mode: "live" | "mock";
  spent_usd: number;
  estimated_usd: number;
  hard_cap_usd: number;
  qc_status: string | null;
  duration_s: number | null;
  ai_video_seconds: number | null;
  thumbnail_url: string | null;
  final_video_url: string | null;
  current_stage: string | null;
  current_stage_label: string | null;
  stages_done: number;
  stages_total: number;
  last_error: string | null;
  job: JobView | null;
  brand_config_version: string;
  models: string[];
  creative: CreativeView;
}

export interface RunDetail {
  run: RunSummary;
  manifest: RunManifest;
  /** Creative controls the run generates with, plus the director's candidates when drafted. */
  creative: {
    controls: CreativeView;
    director: DirectorRecord | null;
    pending_regeneration: PendingRegeneration | null;
  };
  brand: BrandSummary;
  product: ProductView | null;
  stages: StageView[];
  shots: ShotView[];
  artifacts: {
    brief: CreativeBrief | null;
    script: Script | null;
    voice: VoiceResult | null;
    storyboard: StoryboardArtifact | null;
    continuity: ContinuityBible | null;
    route: RoutingPlan | null;
    edl: Edl | null;
    final_qc: FinalQcReport | null;
    report: CostReport | null;
    render_progress: RenderProgressFile | null;
    render_output: {
      path: string;
      mode: string;
      renderer: string;
      meta: {
        duration_s: number;
        width: number;
        height: number;
        fps: number | null;
        has_audio: boolean;
      };
      render_ms: number;
    } | null;
  };
  files: {
    final_video_url: string | null;
    voice_url: string | null;
    report_md_url: string | null;
    run_dir: string;
  };
  costs: CostBreakdown;
  preflight: PreflightView | null;
  events: PipelineEvent[];
  decisions: Decision[];
  audit: AuditView[];
  fx: FxSnapshot;
  approvals: {
    storyboard_approved: boolean;
    keyframes_pending: number;
    keyframes_approved: number;
    keyframes_rejected: number;
    keyframes_total: number;
    can_start_production: boolean;
  };
  qc_semantic: {
    available: false;
    reason: string;
    scores: Array<{ id: string; label: string; value: null }>;
  };
}

export interface AuditView {
  id: number;
  ts: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  run_id: string | null;
  shot_id: string | null;
  details: Record<string, unknown>;
}

export interface RunListFilters {
  brand?: string;
  product?: string;
  status?: UiRunStatus[];
  from?: string;
  to?: string;
  min_usd?: number;
  max_usd?: number;
  model?: string;
  qc?: string[];
  search?: string;
  limit?: number;
}

export interface DashboardView {
  brand: BrandSummary;
  budget: BudgetStatus;
  recent_runs: RunSummary[];
  active_runs: RunSummary[];
  usage_today: {
    by_provider: BudgetStatus["spent_today_by_provider"];
    videos_completed: number;
    average_video_cost_usd: number | null;
    ai_video_seconds: number;
    images_generated: number;
    failed_generations: number;
    retried_generations: number;
  };
  totals: {
    videos_completed: number;
    average_video_cost_usd: number | null;
    ai_video_seconds: number;
    images_generated: number;
    failed_generations: number;
  };
  fx: FxSnapshot;
  health: HealthReport;
}

export interface CreateVideoRequest {
  brand_id: string;
  product_id: string | null;
  title: string | null;
  topic: string;
  goal: string;
  audience: string | null;
  duration_s: number | null;
  platform: string | null;
  creative_direction: string | null;
  cta: string | null;
  notes: string | null;
  advanced: {
    budget_override_usd: number | null;
    ai_video_seconds: number | null;
    voice: "brand_default" | "voice" | "no_voice";
    music: "brand_default" | "always" | "optional" | "never";
    approval_mode: "storyboard_and_keyframes" | "keyframes_only" | "storyboard_only" | "auto";
    provider_mode: "live" | "mock";
    provider_overrides: Partial<
      Record<
        "llm_creative" | "llm_fast" | "image" | "video" | "tts",
        { provider?: string; model?: string }
      >
    >;
  };
  /** Creative controls for this run; omitted fields fall back to the brand's defaults. */
  creative?: { creative_freedom?: number; goal_focus?: number } | null;
}

/** What Duplicate prefills: the stored Create Video request, or one rebuilt from the manifest. */
export interface RunRequestView {
  source: "stored" | "reconstructed";
  source_run_id: string;
  request: CreateVideoRequest;
}

export interface RegenerateStoryboardRequest {
  variation?: VariationStrength;
  instruction?: string | null;
}

export interface RegenerateConceptRequest {
  variation?: VariationStrength;
  instruction?: string | null;
}

export interface RegenerateShotRequest {
  shot_id: string;
  variation?: VariationStrength;
  instruction?: string | null;
}

export interface CreateVideoResponse {
  run: RunSummary;
  job: JobView | null;
  preflight: PreflightView;
  warnings: string[];
  blocked: { rule: string; reason: string } | null;
}

export interface StudioSettings {
  display_currency: "INR" | "USD";
  secondary_currency: "INR" | "USD";
  fx: {
    id: number | null;
    rate: number;
    base: "USD";
    quote: string;
    effective_at: string | null;
    source: string | null;
    note: string | null;
  };
  fx_history: Array<{
    id: number;
    rate: number;
    effective_at: string;
    source: string;
    note: string | null;
    created_at: string;
  }>;
  pricing: { as_of: string; stale: boolean; table: Record<string, unknown> };
  provider_defaults: RunManifest["providers"];
  creative: CreativeSettingsView;
}

export interface StoryboardEditRequest {
  shots: Array<{
    id: string;
    description?: string;
    action?: string;
    duration_s?: number;
    narration_line_ids?: string[];
    shot_intent?: string;
    delete?: boolean;
    duplicate_of?: string;
  }>;
  /** New order of existing/duplicated shot ids (optional). */
  order?: string[];
  note?: string;
}

export interface EditImpact {
  valid: boolean;
  issues: string[];
  changed_shots: string[];
  regenerated_shots: string[];
  kept_shots: string[];
  continuity_llm_estimate_usd: number;
  regeneration_estimate_usd: number;
  total_additional_estimate_usd: number;
  new_total_duration_s: number;
  storyboard_after: StoryboardArtifact;
}

export interface RegenerationEstimate {
  kind: "keyframe" | "clip" | "storyboard" | "continuity" | "concept" | "storyboard_shot";
  shot_id: string | null;
  estimate_usd: number;
  breakdown: Array<{ item: string; usd: number; note: string }>;
  source: "ESTIMATED";
  budget: BudgetCheckView;
}
