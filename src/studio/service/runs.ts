import * as fs from "node:fs";
import * as path from "node:path";
import type { LoadedBrand } from "../../brand/loader.js";
import type { BudgetLedger } from "../../budget/ledger.js";
import { PRICING_AS_OF, pricingIsStale } from "../../config/pricing.js";
import { resolveProviders } from "../../config/settings.js";
import { buildReport } from "../../cost/report.js";
import type { GenerationRow, Repos } from "../../db/repos.js";
import type { Db } from "../../db/sqlite.js";
import { findRunDir, loadManifest } from "../../pipeline/manifest.js";
import { openRun, type RunContext } from "../../pipeline/run.js";
import { listShotHistory, loadShotRecord, shotDir } from "../../pipeline/shots.js";
import { SHOT_PROGRESS_FILE, type ShotProgress } from "../../pipeline/stages/08-animate.js";
import { RENDER_PROGRESS_FILE, type RenderProgressFile } from "../../pipeline/stages/11-render.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { OUTPUT } from "../../schema/common.js";
import { ContinuityBibleSchema } from "../../schema/continuity.js";
import { EdlSchema } from "../../schema/edl.js";
import type { RunManifest } from "../../schema/manifest.js";
import { FinalQcReportSchema } from "../../schema/qc.js";
import { ResearchNotesSchema } from "../../schema/research.js";
import { RoutingPlanSchema } from "../../schema/routing.js";
import { ScriptSchema } from "../../schema/script.js";
import type { ShotAttempt, ShotRecord } from "../../schema/shot.js";
import { StoryboardArtifactSchema } from "../../schema/storyboard.js";
import { VoiceResultSchema } from "../../schema/voice.js";
import { exists, readJson, readJsonl } from "../../util/fs.js";
import type {
  AuditView,
  CallSummary,
  CostBreakdown,
  JobView,
  RunDetail,
  RunListFilters,
  RunSummary,
  ShotView,
  StageView,
  VersionView,
} from "../api-types.js";
import type { JobRow, JobSupervisor } from "../jobs.js";
import { pidAlive } from "../jobs.js";
import { brandSummary } from "./brand.js";
import {
  runFileUrl,
  STAGE_DIRS,
  STAGE_LABELS,
  STAGE_ORDER,
  stageProgress,
  uiRunStatus,
  uiStageStatus,
} from "./common.js";
import { estimatorProviders, preflightView } from "./estimates.js";
import { productView } from "./products.js";

export interface StudioContext {
  db: Db;
  repos: Repos;
  ledger: BudgetLedger;
  jobs: JobSupervisor;
}

function readOpt<T>(
  run: RunContext,
  dir: string,
  schema: Parameters<RunContext["readOutput"]>[1],
): T | null {
  try {
    return run.hasOutput(dir) ? (run.readOutput(dir, schema) as T) : null;
  } catch {
    return null;
  }
}

export function jobView(sup: JobSupervisor, job: JobRow | null): JobView | null {
  if (!job) return null;
  const live = ["queued", "running", "pausing", "cancelling"].includes(job.status);
  const inFlight = live ? sup.inFlightCalls(job.run_id) : [];
  const cancelRequested = !!job.cancel_requested_at || !!job.pause_requested_at;
  return {
    ...job,
    alive: live && (pidAlive(job.pid) || job.status === "queued"),
    in_flight: inFlight,
    cancel_state: !cancelRequested
      ? "none"
      : live
        ? inFlight.length
          ? "waiting_for_in_flight_call"
          : "requested"
        : "stopped",
  };
}

function thumbnailFor(
  runDir: string,
  brandId: string,
  runId: string,
  sb: { shots: Array<{ id: string }> } | null,
): string | null {
  const ids = sb?.shots.map((s) => s.id) ?? ["shot_01"];
  for (const id of ids) {
    const file = path.join(runDir, "shots", id, "shot.json");
    if (!exists(file)) continue;
    try {
      const rec = readJson<ShotRecord>(file);
      if (rec.keyframe?.path && exists(path.join(runDir, rec.keyframe.path)))
        return runFileUrl(brandId, runId, rec.keyframe.path);
    } catch {
      // ignore unreadable record
    }
  }
  return null;
}

function safeManifest(runDir: string): RunManifest | null {
  try {
    return loadManifest(runDir);
  } catch {
    return null;
  }
}

function safeStoryboard(runDir: string) {
  const file = path.join(runDir, "04_storyboard", "output.json");
  if (!exists(file)) return null;
  const parsed = StoryboardArtifactSchema.safeParse(readJson(file));
  return parsed.success ? parsed.data : null;
}

function safeRoute(runDir: string) {
  const file = path.join(runDir, "06_route", "output.json");
  if (!exists(file)) return null;
  const parsed = RoutingPlanSchema.safeParse(readJson(file));
  return parsed.success ? parsed.data : null;
}

export function summaryFromManifest(
  ctx: StudioContext,
  m: RunManifest,
  runDir: string,
  extra: {
    brand_name?: string;
    product_name?: string | null;
    qc_status?: string | null;
    duration_s?: number | null;
  } = {},
): RunSummary {
  const job = ctx.jobs.latestForRun(m.run_id);
  const ui = uiRunStatus(m, job);
  const sb = safeStoryboard(runDir);
  const route = safeRoute(runDir);
  const finalPath = path.join(runDir, "final.mp4");
  const prog = stageProgress(m);
  const row = ctx.db
    .prepare(`SELECT qc_status, duration_s FROM runs WHERE run_id = ?`)
    .get(m.run_id) as { qc_status: string | null; duration_s: number | null } | undefined;
  return {
    run_id: m.run_id,
    brand_id: m.brand_id,
    brand_name: extra.brand_name ?? m.brand_id,
    title: m.title ?? m.topic,
    topic: m.topic,
    goal: m.goal,
    product_id: m.product_id ?? null,
    product_name: extra.product_name ?? null,
    status: m.status,
    stop_reason: m.stop_reason ?? null,
    ui_status: ui.status,
    ui_status_label: ui.label,
    created_at: m.created_at,
    updated_at: m.updated_at,
    created_by: m.created_by ?? "cli",
    provider_mode: m.options.provider_mode,
    spent_usd: Math.max(m.cost.spent_usd, ctx.repos.spentForRun(m.run_id)),
    estimated_usd: m.cost.estimated_usd,
    hard_cap_usd: m.cost.hard_cap_usd,
    qc_status: extra.qc_status ?? row?.qc_status ?? null,
    duration_s: extra.duration_s ?? row?.duration_s ?? sb?.total_duration_s ?? null,
    ai_video_seconds: route?.totals.ai_video_seconds ?? null,
    thumbnail_url: thumbnailFor(runDir, m.brand_id, m.run_id, sb),
    final_video_url: exists(finalPath) ? runFileUrl(m.brand_id, m.run_id, "final.mp4") : null,
    current_stage: ui.current_stage,
    current_stage_label: ui.current_stage
      ? (STAGE_LABELS[ui.current_stage] ?? ui.current_stage)
      : null,
    stages_done: prog.done,
    stages_total: prog.total,
    last_error: m.last_error,
    job: jobView(ctx.jobs, job),
    brand_config_version: m.brand_config_version,
    models: [...new Set(Object.values(m.providers).map((p) => p.model))],
  };
}

export function listRuns(ctx: StudioContext, filters: RunListFilters = {}): RunSummary[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.brand) {
    where.push("brand_id = ?");
    params.push(filters.brand);
  }
  if (filters.product) {
    where.push("product_id = ?");
    params.push(filters.product);
  }
  if (filters.from) {
    where.push("created_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    where.push("created_at <= ?");
    params.push(filters.to);
  }
  if (filters.min_usd != null) {
    where.push("spent_usd >= ?");
    params.push(filters.min_usd);
  }
  if (filters.max_usd != null) {
    where.push("spent_usd <= ?");
    params.push(filters.max_usd);
  }
  if (filters.qc?.length) {
    where.push(`qc_status IN (${filters.qc.map(() => "?").join(",")})`);
    params.push(...filters.qc);
  }
  if (filters.search) {
    where.push("(topic LIKE ? OR title LIKE ? OR run_id LIKE ?)");
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  const rows = ctx.db
    .prepare(
      `SELECT run_id, run_dir, brand_id, product_id FROM runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params, filters.limit ?? 200) as Array<{
    run_id: string;
    run_dir: string;
    brand_id: string;
    product_id: string | null;
  }>;
  const out: RunSummary[] = [];
  for (const r of rows) {
    const dir = exists(path.join(r.run_dir, "manifest.json")) ? r.run_dir : findRunDir(r.run_id);
    if (!dir) continue;
    const m = safeManifest(dir);
    if (!m) continue;
    const s = summaryFromManifest(ctx, m, dir);
    if (filters.status?.length && !filters.status.includes(s.ui_status)) continue;
    if (filters.model && !s.models.some((x) => x.includes(filters.model as string))) continue;
    out.push(s);
  }
  return out;
}

export function openRunForStudio(runId: string): RunContext {
  return openRun(runId, { quiet: true, brandSource: "snapshot" });
}

function callSummary(g: GenerationRow, outcome: CallSummary["outcome"]): CallSummary {
  return {
    id: g.id ?? 0,
    stage_id: g.stage_id,
    shot_id: g.shot_id,
    kind: g.kind,
    provider: g.provider,
    model: g.model,
    label: g.label,
    status: g.status,
    est_cost_usd: g.est_cost_usd,
    actual_cost_usd: g.actual_cost_usd,
    cost_source:
      g.cost_source ??
      (g.status === "completed"
        ? "CALCULATED_FROM_USAGE"
        : g.status === "reserved"
          ? "ESTIMATED"
          : null),
    provider_cost_usd: g.provider_cost_usd ?? null,
    usage: (g.usage as CallSummary["usage"]) ?? null,
    latency_ms: g.latency_ms,
    started_at: g.started_at ?? g.created_at,
    completed_at: g.completed_at ?? null,
    request_id: g.request_id ?? null,
    attempt: g.attempt ?? null,
    pricing_version: g.pricing_version ?? null,
    fx_rate: g.fx_rate ?? null,
    provider_mode: g.provider_mode ?? null,
    reconciled: g.reconciled ?? null,
    outcome,
    error: g.error,
    prompt_version: g.prompt_version,
    duration_s: g.duration_s,
    resolution: g.resolution,
  };
}

function currentVersion(rec: ShotRecord | null, kind: "keyframe" | "video"): number | null {
  if (!rec) return null;
  const p = kind === "keyframe" ? rec.keyframe?.path : rec.video?.path;
  if (!p) return null;
  return rec.attempts.find((a) => a.kind === kind && a.path === p)?.attempt ?? null;
}

/** Classify every ledger row: used, superseded (retry/rejected work), failed, or still pending. */
export function classifyCalls(
  rows: GenerationRow[],
  records: Map<string, ShotRecord | null>,
): CallSummary[] {
  const lastByLabel = new Map<string, number>();
  for (const g of rows)
    if (g.status === "completed" && g.label) lastByLabel.set(g.label, g.id ?? 0);
  return rows.map((g) => {
    let outcome: CallSummary["outcome"];
    if (g.status === "reserved") outcome = "pending";
    else if (g.status === "failed") outcome = "failed";
    else if ((g.kind === "image" || g.kind === "video") && g.shot_id) {
      const rec = records.get(g.shot_id) ?? null;
      const kind = g.kind === "image" ? "keyframe" : "video";
      const version = g.attempt ?? Number(/v(\d+)$/.exec(g.label ?? "")?.[1] ?? Number.NaN);
      const cur = currentVersion(rec, kind);
      outcome =
        cur != null && version === cur
          ? "used"
          : cur == null && rec?.status !== "failed"
            ? "used"
            : "superseded";
    } else {
      outcome =
        g.label && lastByLabel.get(g.label) === g.id ? "used" : g.label ? "superseded" : "used";
    }
    return callSummary(g, outcome);
  });
}

export function costBreakdown(
  ctx: StudioContext,
  run: RunContext,
  records: Map<string, ShotRecord | null>,
  preplan: CostBreakdown["preplan_estimate"],
): CostBreakdown {
  const rows = ctx.repos.listGenerations(run.runId);
  const calls = classifyCalls(rows, records);
  const actual = calls.reduce((n, c) => n + (c.actual_cost_usd ?? 0), 0);
  const failed = calls
    .filter((c) => c.outcome === "failed")
    .reduce((n, c) => n + (c.actual_cost_usd ?? 0), 0);
  const retry = calls
    .filter((c) => c.outcome === "superseded")
    .reduce((n, c) => n + (c.actual_cost_usd ?? 0), 0);
  const unknown = calls
    .filter((c) => c.reconciled === "unknown_killed")
    .reduce((n, c) => n + (c.actual_cost_usd ?? 0), 0);
  const byStage = new Map<string, { usd: number; calls: number; failed: number }>();
  const byShot = new Map<string, { usd: number; successful_usd: number; wasted_usd: number }>();
  const byProvider = new Map<string, { usd: number; calls: number }>();
  const byModel = new Map<
    string,
    {
      provider: string;
      model: string;
      kind: string;
      usd: number;
      calls: number;
      usage: Record<string, number>;
    }
  >();
  const bySource: CostBreakdown["by_source"] = {
    PROVIDER_REPORTED: 0,
    CALCULATED_FROM_USAGE: 0,
    ESTIMATED: 0,
  };
  for (const c of calls) {
    const usd = c.actual_cost_usd ?? 0;
    const st = byStage.get(c.stage_id) ?? { usd: 0, calls: 0, failed: 0 };
    st.usd += usd;
    st.calls += 1;
    if (c.outcome === "failed") st.failed += 1;
    byStage.set(c.stage_id, st);
    if (c.shot_id) {
      const sh = byShot.get(c.shot_id) ?? { usd: 0, successful_usd: 0, wasted_usd: 0 };
      sh.usd += usd;
      if (c.outcome === "used") sh.successful_usd += usd;
      else if (c.outcome !== "pending") sh.wasted_usd += usd;
      byShot.set(c.shot_id, sh);
    }
    const pv = byProvider.get(c.provider) ?? { usd: 0, calls: 0 };
    pv.usd += usd;
    pv.calls += 1;
    byProvider.set(c.provider, pv);
    const key = `${c.provider}:${c.model}`;
    const md = byModel.get(key) ?? {
      provider: c.provider,
      model: c.model,
      kind: c.kind,
      usd: 0,
      calls: 0,
      usage: {},
    };
    md.usd += usd;
    md.calls += 1;
    for (const [k, v] of Object.entries(c.usage ?? {}))
      if (typeof v === "number") md.usage[k] = (md.usage[k] ?? 0) + v;
    byModel.set(key, md);
    if (c.status === "reserved") bySource.ESTIMATED += c.est_cost_usd;
    else if (c.cost_source === "PROVIDER_REPORTED") bySource.PROVIDER_REPORTED += usd;
    else bySource.CALCULATED_FROM_USAGE += usd;
  }
  const reservations = ctx.ledger.reservationsForRun(run.runId);
  // "Reserved" for a video is the largest hold ever taken for it (the first job holds the whole
  // cap; later resumes hold cap minus what was already spent). Returned = that hold minus what
  // was actually spent, once no hold is active any more.
  const reserved = reservations.length
    ? Math.max(...reservations.map((r) => r.initial_hold_usd))
    : null;
  const active = reservations.some((r) => r.status === "active");
  return {
    original_estimate_usd: run.manifest.cost.estimated_usd,
    preplan_estimate: preplan,
    reserved_usd: reserved,
    actual_usd: actual,
    successful_usd: Math.max(0, actual - failed - retry),
    failed_usd: failed,
    retry_usd: retry,
    returned_usd: !active && reserved != null ? Math.max(0, reserved - actual) : null,
    unknown_usd: unknown,
    by_stage: STAGE_ORDER.filter((id) => byStage.has(id)).map((id) => ({
      stage_id: id,
      label: STAGE_LABELS[id] ?? id,
      ...(byStage.get(id) as { usd: number; calls: number; failed: number }),
    })),
    by_shot: [...byShot.entries()].sort().map(([shot_id, v]) => ({ shot_id, ...v })),
    by_provider: [...byProvider.entries()]
      .map(([provider, v]) => ({ provider, ...v }))
      .sort((a, b) => b.usd - a.usd),
    by_model: [...byModel.values()].sort((a, b) => b.usd - a.usd),
    by_source: bySource,
    calls,
    reservations,
    pricing_version: PRICING_AS_OF,
    pricing_stale: pricingIsStale(),
    fx: ctx.ledger.fxFor(ctx.repos.getSetting("display_currency") ?? "INR"),
  };
}

function versionViews(
  run: RunContext,
  rec: ShotRecord | null,
  history: ShotRecord[],
  kind: "keyframe" | "video",
  calls: CallSummary[],
): VersionView[] {
  const cur = currentVersion(rec, kind);
  const seen = new Set<number>();
  const out: VersionView[] = [];
  const push = (a: ShotAttempt, archived: boolean) => {
    if (a.kind !== kind || seen.has(a.attempt)) return;
    seen.add(a.attempt);
    const call =
      calls.find(
        (c) =>
          c.shot_id === rec?.shot_id &&
          c.attempt === a.attempt &&
          (kind === "keyframe" ? c.kind === "image" : c.kind === "video"),
      ) ?? calls.find((c) => c.label === `${kind}:${rec?.shot_id}:v${a.attempt}`);
    out.push({
      kind,
      attempt: a.attempt,
      path: a.path,
      url:
        a.path && exists(run.abs(a.path))
          ? runFileUrl(run.manifest.brand_id, run.runId, a.path)
          : null,
      status: a.status,
      selected: !archived && a.attempt === cur,
      approved: !archived && a.attempt === cur && rec?.approval.status === "approved",
      cost_usd: a.cost_usd,
      cost_source: call?.cost_source ?? null,
      generation_id: call?.id ?? null,
      request_id: call?.request_id ?? null,
      provider: a.provider,
      model: a.model,
      prompt: a.prompt,
      prompt_version: a.prompt_version,
      refs: a.refs.map((r) => ({ path: r, url: runFileUrl(run.manifest.brand_id, run.runId, r) })),
      params: a.params,
      checks: a.checks,
      latency_ms: a.latency_ms,
      error: a.error,
      created_at: call?.completed_at ?? call?.started_at ?? null,
      archived,
    });
  };
  for (const a of rec?.attempts ?? []) push(a, false);
  for (const h of history) for (const a of h.attempts) push(a, true);
  return out.sort((a, b) => b.attempt - a.attempt);
}

export function shotViews(
  run: RunContext,
  calls: CallSummary[],
): { shots: ShotView[]; records: Map<string, ShotRecord | null> } {
  const sb = readOpt<ReturnType<typeof StoryboardArtifactSchema.parse>>(
    run,
    "04_storyboard",
    StoryboardArtifactSchema,
  );
  const cont = readOpt<ReturnType<typeof ContinuityBibleSchema.parse>>(
    run,
    "05_continuity",
    ContinuityBibleSchema,
  );
  const route = readOpt<ReturnType<typeof RoutingPlanSchema.parse>>(
    run,
    "06_route",
    RoutingPlanSchema,
  );
  const records = new Map<string, ShotRecord | null>();
  const shots: ShotView[] = [];
  if (!sb) return { shots, records };
  const settings = resolveProviders(run.brand.profile);
  const p = estimatorProviders(settings);
  const product = run.brand.product;
  const refMeta = (rel: string) => {
    const base = path.basename(rel);
    const m = /^([a-z0-9_]+)_(\d+)\.[a-z]+$/i.exec(base);
    if (!m || !product) return { view: null, identity: false };
    const idx = Number(m[2]) - 1;
    const ref = product.references.filter((r) => r.exists)[idx];
    return ref && product.profile.entity_id !== undefined
      ? { view: ref.view, identity: ref.identity_critical }
      : ref
        ? { view: ref.view, identity: ref.identity_critical }
        : { view: null, identity: false };
  };
  sb.shots.forEach((shot, i) => {
    const rec = loadShotRecord(run, shot.id);
    records.set(shot.id, rec);
    const history = listShotHistory(run, shot.id);
    const r = route?.shots.find((x) => x.shot_id === shot.id) ?? null;
    const per = cont?.per_shot.find((x) => x.shot_id === shot.id) ?? null;
    const progressFile = path.join(shotDir(run, shot.id), SHOT_PROGRESS_FILE);
    const progress = exists(progressFile) ? readJson<ShotProgress>(progressFile) : null;
    const refs = (per?.reference_images ?? []).map((rel) => {
      const meta = refMeta(rel);
      return {
        path: rel,
        url: runFileUrl(run.manifest.brand_id, run.runId, rel),
        view: meta.view,
        identity_critical: meta.identity,
      };
    });
    const kfRefs = (per?.reference_images.length ?? 0) + 1;
    const keyframes = versionViews(run, rec, history, "keyframe", calls);
    const clips = versionViews(run, rec, history, "video", calls);
    const start = sb.shot_start_s[i] ?? null;
    const lastFailed = [...(rec?.attempts ?? [])].reverse().find((a) => a.status === "failed");
    shots.push({
      shot_id: shot.id,
      index: i,
      storyboard: shot,
      start_s: start,
      end_s: start == null ? null : start + shot.duration_s,
      route: r,
      continuity: per,
      record: rec,
      status: rec?.status ?? "not_started",
      approval: rec?.approval.status ?? "none",
      approval_note: rec?.approval.note ?? null,
      keyframe_url:
        rec?.keyframe?.path && exists(run.abs(rec.keyframe.path))
          ? runFileUrl(run.manifest.brand_id, run.runId, rec.keyframe.path)
          : null,
      keyframe_version: currentVersion(rec, "keyframe"),
      video_url:
        rec?.video?.path && exists(run.abs(rec.video.path))
          ? runFileUrl(run.manifest.brand_id, run.runId, rec.video.path)
          : null,
      video_version: currentVersion(rec, "video"),
      final_url:
        rec?.final?.path && exists(run.abs(rec.final.path))
          ? runFileUrl(run.manifest.brand_id, run.runId, rec.final.path)
          : null,
      final_kind: rec?.final?.kind ?? null,
      references: refs,
      versions: { keyframes, clips },
      progress,
      cost_usd: rec?.cost_usd ?? 0,
      expected_cost_usd: r?.est_cost_usd ?? null,
      regenerate_keyframe_estimate_usd: p.image.estimate(
        OUTPUT.width,
        OUTPUT.height,
        Math.min(4, kfRefs),
      ),
      regenerate_clip_estimate_usd: r?.video_seconds ? p.video.estimate(r.video_seconds) : null,
      animation: {
        kind:
          r?.source === "GEN_VIDEO"
            ? "GEN_VIDEO"
            : r?.source === "STILL_MOTION"
              ? "STILL_MOTION"
              : r?.source === "STILL"
                ? "STILL"
                : "other",
        label:
          r?.source === "GEN_VIDEO"
            ? `${p.video.model}`
            : r?.source === "STILL_MOTION"
              ? "Animated still (no generation)"
              : r?.source === "STILL"
                ? "Held still (no generation)"
                : "—",
        seconds: r?.video_seconds ?? null,
        provider: r?.source === "GEN_VIDEO" ? p.video.id : p.image.id,
        model: r?.source === "GEN_VIDEO" ? p.video.model : p.image.model,
      },
      last_error: lastFailed?.error ?? null,
    });
  });
  return { shots, records };
}

export function stageViews(run: RunContext, calls: CallSummary[]): StageView[] {
  const m = run.manifest;
  const research = readOpt<{ depth?: string }>(run, "01_research", ResearchNotesSchema);
  const views: StageView[] = [];
  views.push({
    id: "input",
    label: "Brief",
    dir: null,
    synthetic: true,
    status: "done",
    ui_status: "complete",
    started_at: m.created_at,
    finished_at: m.created_at,
    duration_ms: 0,
    cost_usd: 0,
    attempt: 1,
    error: null,
    calls: [],
    models: [],
    usage: {},
    retries: 0,
    failed_calls: 0,
    note: m.product_id ? `${m.topic} · product ${m.product_id}` : m.topic,
  });
  for (const id of STAGE_ORDER) {
    const st = m.stages[id];
    const stageCalls = calls.filter((c) => c.stage_id === id);
    const usage: Record<string, number> = {};
    for (const c of stageCalls)
      for (const [k, v] of Object.entries(c.usage ?? {}))
        if (typeof v === "number") usage[k] = (usage[k] ?? 0) + v;
    const retries = stageCalls.filter((c) => c.outcome === "superseded").length;
    const failed = stageCalls.filter((c) => c.outcome === "failed").length;
    let ui = uiStageStatus(st?.status);
    let note: string | null = null;
    if (id === "research" && st?.status === "done" && research?.depth === "none") {
      ui = "skipped";
      note = "The creative director decided no research was needed.";
    }
    if (id === "keyframes" && st?.status === "waiting_approval")
      note = "Waiting for keyframe approval.";
    if (st?.status === "budget_conflict") note = st.error;
    views.push({
      id,
      label: STAGE_LABELS[id] ?? id,
      dir: STAGE_DIRS[id] ?? null,
      synthetic: false,
      status: st?.status ?? null,
      ui_status: ui,
      started_at: st?.started_at ?? null,
      finished_at: st?.finished_at ?? null,
      duration_ms: st?.duration_ms ?? null,
      cost_usd: st?.cost_usd ?? 0,
      attempt: st?.attempt ?? 0,
      error: st?.error ?? null,
      calls: stageCalls,
      models: [...new Set(stageCalls.map((c) => c.model))],
      usage,
      retries,
      failed_calls: failed,
      note,
    });
    if (id === "keyframes") {
      const gateStatus =
        st?.status === "waiting_approval"
          ? "awaiting_approval"
          : st?.status === "done" || m.stages.animate
            ? "complete"
            : "waiting";
      views.push({
        id: "keyframe_approval",
        label: "Keyframe Approval",
        dir: null,
        synthetic: true,
        status: null,
        ui_status: gateStatus,
        started_at: null,
        finished_at: null,
        duration_ms: null,
        cost_usd: 0,
        attempt: 0,
        error: null,
        calls: [],
        models: [],
        usage: {},
        retries: 0,
        failed_calls: 0,
        note: m.options.approve_keyframes ? null : "Approval gate is off for this run.",
      });
    }
  }
  views.push({
    id: "complete",
    label: "Complete",
    dir: null,
    synthetic: true,
    status: m.status === "done" ? "done" : null,
    ui_status: m.status === "done" ? "complete" : "waiting",
    started_at: null,
    finished_at: m.status === "done" ? m.updated_at : null,
    duration_ms: null,
    cost_usd: 0,
    attempt: 0,
    error: null,
    calls: [],
    models: [],
    usage: {},
    retries: 0,
    failed_calls: 0,
    note: null,
  });
  return views;
}

export function auditRows(db: Db, runId: string, limit = 200): AuditView[] {
  const rows = db
    .prepare(`SELECT * FROM audit_log WHERE run_id = ? ORDER BY id DESC LIMIT ?`)
    .all(runId, limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    ts: String(r.ts),
    actor: String(r.actor),
    action: String(r.action),
    target_type: String(r.target_type),
    target_id: String(r.target_id),
    run_id: (r.run_id as string | null) ?? null,
    shot_id: (r.shot_id as string | null) ?? null,
    details: JSON.parse((r.details as string) ?? "{}"),
  }));
}

export function runDetail(
  ctx: StudioContext,
  runId: string,
  opts: { eventsLimit?: number } = {},
): RunDetail {
  const run = openRunForStudio(runId);
  const m = run.manifest;
  const brand: LoadedBrand = run.brand;
  const rows = ctx.repos.listGenerations(run.runId);
  const prelim = classifyCalls(rows, new Map());
  const { records } = shotViews(run, prelim);
  const calls = classifyCalls(rows, records);
  // Re-derive versions with the final classification so outcome badges match.
  const { shots: finalShots } = shotViews(run, calls);
  const summary = summaryFromManifest(ctx, m, run.runDir, {
    brand_name: brand.profile.name,
    product_name: brand.product?.profile.name ?? null,
  });
  const brief = readOpt<ReturnType<typeof CreativeBriefSchema.parse>>(
    run,
    "00_brief",
    CreativeBriefSchema,
  );
  const script = readOpt<ReturnType<typeof ScriptSchema.parse>>(run, "02_script", ScriptSchema);
  const voice = readOpt<ReturnType<typeof VoiceResultSchema.parse>>(
    run,
    "03_voice",
    VoiceResultSchema,
  );
  const storyboard = readOpt<ReturnType<typeof StoryboardArtifactSchema.parse>>(
    run,
    "04_storyboard",
    StoryboardArtifactSchema,
  );
  const continuity = readOpt<ReturnType<typeof ContinuityBibleSchema.parse>>(
    run,
    "05_continuity",
    ContinuityBibleSchema,
  );
  const route = readOpt<ReturnType<typeof RoutingPlanSchema.parse>>(
    run,
    "06_route",
    RoutingPlanSchema,
  );
  const edl = readOpt<ReturnType<typeof EdlSchema.parse>>(run, "10_edit", EdlSchema);
  const finalQc = readOpt<ReturnType<typeof FinalQcReportSchema.parse>>(
    run,
    "12_final_qc",
    FinalQcReportSchema,
  );
  const renderProgressFile = path.join(run.runDir, "11_render", RENDER_PROGRESS_FILE);
  const renderProgress = exists(renderProgressFile)
    ? readJson<RenderProgressFile>(renderProgressFile)
    : null;
  const renderOutput = run.hasOutput("11_render")
    ? readJson<RunDetail["artifacts"]["render_output"]>(run.outputPath("11_render"))
    : null;
  let report: RunDetail["artifacts"]["report"] = null;
  try {
    report = buildReport(run);
  } catch {
    report = null;
  }
  const preflight = preflightView(run, ctx.ledger);
  const costs = costBreakdown(
    ctx,
    run,
    records,
    preflight.stage === "pre_plan" ? preflight.estimate : null,
  );
  const eventsFile = path.join(run.runDir, "events.jsonl");
  const events = readJsonl<RunDetail["events"][number]>(eventsFile).slice(
    -(opts.eventsLimit ?? 300),
  );
  const withKeyframe = finalShots.filter((s) => s.record?.keyframe);
  const pending = withKeyframe.filter((s) => s.approval === "pending").length;
  const approved = withKeyframe.filter(
    (s) => s.approval === "approved" || s.approval === "none",
  ).length;
  const rejected = withKeyframe.filter((s) => s.approval === "rejected").length;
  const storyboardApproved = !m.options.dry_run && !!route;
  const finalPath = path.join(run.runDir, "final.mp4");
  return {
    run: summary,
    manifest: m,
    brand: brandSummary(brand),
    product: brand.product ? productView(brand.profile.id, brand.product, ctx.db) : null,
    stages: stageViews(run, calls),
    shots: finalShots,
    artifacts: {
      brief,
      script,
      voice,
      storyboard,
      continuity,
      route,
      edl,
      final_qc: finalQc,
      report,
      render_progress: renderProgress,
      render_output: renderOutput,
    },
    files: {
      final_video_url: exists(finalPath)
        ? runFileUrl(m.brand_id, m.run_id, "final.mp4")
        : run.hasOutput("11_render") && exists(run.abs("11_render/final.mp4"))
          ? runFileUrl(m.brand_id, m.run_id, "11_render/final.mp4")
          : null,
      voice_url:
        voice?.audio_path && exists(run.abs(voice.audio_path))
          ? runFileUrl(m.brand_id, m.run_id, voice.audio_path)
          : null,
      report_md_url: exists(path.join(run.runDir, "report.md"))
        ? runFileUrl(m.brand_id, m.run_id, "report.md")
        : null,
      run_dir: run.runDir,
    },
    costs,
    preflight,
    events,
    decisions: run.events.decisions(),
    audit: auditRows(ctx.db, run.runId),
    fx: costs.fx,
    approvals: {
      storyboard_approved: storyboardApproved,
      keyframes_pending: pending,
      keyframes_approved: approved,
      keyframes_rejected: rejected,
      keyframes_total: withKeyframe.length,
      can_start_production: !!route && m.status !== "running",
    },
    qc_semantic: {
      available: false,
      reason:
        "Semantic QC (product accuracy, brand fit, realism, emotional appeal, pacing, AI-slop risk) is not implemented in this pipeline yet; only the deterministic checks below ran.",
      scores: [
        { id: "product_accuracy", label: "Product accuracy", value: null },
        { id: "brand_fit", label: "Brand fit", value: null },
        { id: "realism", label: "Realism", value: null },
        { id: "emotional_appeal", label: "Emotional appeal", value: null },
        { id: "editing_pacing", label: "Editing / pacing", value: null },
        { id: "ai_slop_risk", label: "AI-slop risk", value: null },
      ],
    },
  };
}

/** Counters for the dashboard, from the ledger and run index. */
export function usageCounters(
  ctx: StudioContext,
  brandId: string,
  since: string | null,
  includeMock: boolean,
): {
  videos_completed: number;
  average_video_cost_usd: number | null;
  ai_video_seconds: number;
  images_generated: number;
  failed_generations: number;
  retried_generations: number;
} {
  const mode = includeMock ? "" : " AND r.provider_mode = 'live'";
  const runs = ctx.db
    .prepare(
      `SELECT run_id, spent_usd, run_dir FROM runs r WHERE brand_id = ? AND status = 'done' AND (? IS NULL OR created_at >= ?)${mode}`,
    )
    .all(brandId, since, since) as Array<{ run_id: string; spent_usd: number; run_dir: string }>;
  const gens = ctx.db
    .prepare(
      `SELECT g.kind AS kind, g.status AS status, g.duration_s AS duration_s, g.label AS label, g.shot_id AS shot_id FROM generations g JOIN runs r ON r.run_id = g.run_id
       WHERE r.brand_id = ? AND (? IS NULL OR g.created_at >= ?)${mode}`,
    )
    .all(brandId, since, since) as Array<{
    kind: string;
    status: string;
    duration_s: number | null;
    label: string | null;
    shot_id: string | null;
  }>;
  const images = gens.filter((g) => g.kind === "image" && g.status === "completed").length;
  const seconds = gens
    .filter((g) => g.kind === "video" && g.status === "completed")
    .reduce((n, g) => n + (g.duration_s ?? 0), 0);
  const failed = gens.filter((g) => g.status === "failed").length;
  const labels = new Map<string, number>();
  for (const g of gens)
    if (g.status === "completed" && g.label)
      labels.set(
        g.label.replace(/:v\d+$/, ""),
        (labels.get(g.label.replace(/:v\d+$/, "")) ?? 0) + 1,
      );
  const retried = [...labels.values()].reduce((n, c) => n + Math.max(0, c - 1), 0);
  const total = runs.reduce((n, r) => n + r.spent_usd, 0);
  return {
    videos_completed: runs.length,
    average_video_cost_usd: runs.length ? total / runs.length : null,
    ai_video_seconds: seconds,
    images_generated: images,
    failed_generations: failed,
    retried_generations: retried,
  };
}

export function runDirOf(runId: string): string | null {
  return findRunDir(runId);
}

export function runExists(runId: string): boolean {
  const dir = findRunDir(runId);
  return !!dir && fs.existsSync(path.join(dir, "manifest.json"));
}
