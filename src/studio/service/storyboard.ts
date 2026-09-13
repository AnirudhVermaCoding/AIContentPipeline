import { knownEntityIds, validateStoryboard } from "../../agents/storyboard-artist.js";
import type { BudgetLedger } from "../../budget/ledger.js";
import { resolveProviders } from "../../config/settings.js";
import {
  approveStoryboard,
  requestConceptRegeneration,
  requestStoryboardShotRegeneration,
} from "../../pipeline/approval.js";
import type { RunContext } from "../../pipeline/run.js";
import { resetFrom } from "../../pipeline/runner.js";
import { loadShotRecord } from "../../pipeline/shots.js";
import { conformToVoice } from "../../pipeline/stages/04-storyboard.js";
import { continuityShotHashes } from "../../pipeline/stages/05-continuity.js";
import { ALL_STAGES } from "../../pipeline/stages/index.js";
import { assessStoryboardRisk } from "../../qc/storyboard-risk.js";
import { routeShots } from "../../router/route.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { OUTPUT } from "../../schema/common.js";
import type { VariationStrength } from "../../schema/creative.js";
import { RoutingPlanSchema } from "../../schema/routing.js";
import {
  type Shot,
  type StoryboardArtifact,
  StoryboardArtifactSchema,
} from "../../schema/storyboard.js";
import { VoiceResultSchema } from "../../schema/voice.js";
import { nowIso, shortHash, writeJsonAtomic } from "../../util/fs.js";
import type { EditImpact, StoryboardEditRequest } from "../api-types.js";
import { estimatorProviders, regenerationEstimate } from "./estimates.js";

/**
 * Storyboard editing on top of the artifact: the edited storyboard is re-conformed to the
 * measured narration, validated with the artist's own invariants, written back, and the stages
 * that depend on it are reset. Per-shot idempotency (plus the continuity preserve-merge) means
 * only the shots that actually changed are produced again; the impact preview says which.
 */

function shotId(i: number): string {
  return `shot_${String(i + 1).padStart(2, "0")}`;
}

export function computeEdit(run: RunContext, req: StoryboardEditRequest): EditImpact {
  const sb = run.readOutput("04_storyboard", StoryboardArtifactSchema);
  const voice = run.readOutput("03_voice", VoiceResultSchema);
  const brief = run.readOutput("00_brief", CreativeBriefSchema);
  const b = run.brand.profile;
  const settings = resolveProviders(b);
  const providers = estimatorProviders(settings);

  // 1. Apply patches / deletes / duplicates on a working copy keyed by the original ids.
  const byId = new Map(sb.shots.map((s) => [s.id, structuredClone(s)]));
  const originalOrder = sb.shots.map((s) => s.id);
  const patchedIds = new Set<string>();
  const deleted = new Set<string>();
  const duplicates: Array<{ id: string; of: string }> = [];
  for (const p of req.shots) {
    if (p.duplicate_of) {
      const src = byId.get(p.duplicate_of);
      if (!src) throw new Error(`unknown shot ${p.duplicate_of}`);
      const copy = structuredClone(src);
      copy.narration_line_ids = [];
      copy.hero_moment = false;
      if (p.description !== undefined) copy.description = p.description;
      if (p.action !== undefined) copy.action = p.action;
      if (p.duration_s !== undefined) copy.duration_s = p.duration_s;
      byId.set(p.id, copy);
      duplicates.push({ id: p.id, of: p.duplicate_of });
      continue;
    }
    const shot = byId.get(p.id);
    if (!shot) throw new Error(`unknown shot ${p.id}`);
    if (p.delete) {
      deleted.add(p.id);
      continue;
    }
    let changed = false;
    for (const key of ["description", "action", "shot_intent"] as const) {
      const v = p[key];
      if (typeof v === "string" && v !== shot[key]) {
        shot[key] = v;
        changed = true;
      }
    }
    if (typeof p.duration_s === "number" && p.duration_s !== shot.duration_s) {
      shot.duration_s = Math.max(0.8, p.duration_s);
      changed = true;
    }
    if (p.narration_line_ids && p.narration_line_ids.join() !== shot.narration_line_ids.join()) {
      shot.narration_line_ids = p.narration_line_ids;
      changed = true;
    }
    if (changed) patchedIds.add(p.id);
  }
  const order = (req.order ?? [...originalOrder, ...duplicates.map((d) => d.id)]).filter(
    (id) => byId.has(id) && !deleted.has(id),
  );
  for (const id of [...byId.keys()]) if (!order.includes(id) && !deleted.has(id)) order.push(id);

  // 2. Re-id sequentially (the pipeline's invariant) and re-conform durations to the narration.
  const renamed = new Map<string, string>();
  const shots: Shot[] = order.map((oldId, i) => {
    const s = byId.get(oldId) as Shot;
    const id = shotId(i);
    renamed.set(oldId, id);
    return { ...s, id };
  });
  const draft = { ...sb, shots };
  const conformed = conformToVoice(draft, voice);
  const total = conformed.shots.reduce((n, s) => n + s.duration_s, 0);
  const textAllowed = brief.text_overlay_intent !== "none";
  const risk = assessStoryboardRisk(
    { ...draft, shots: conformed.shots },
    {
      maxWordsOnScreen: b.text_policy.max_words_on_screen,
      textAllowed,
      shotRange: b.pacing.shot_count_hint,
    },
  );
  const after: StoryboardArtifact = {
    ...sb,
    shots: conformed.shots,
    total_duration_s: Math.round(total * 100) / 100,
    shot_start_s: conformed.starts,
    voice_offset_s: conformed.voiceOffset,
    conformed_to_voice: !voice.music_only,
    risk,
  };
  const issues = validateStoryboard(after, {
    clipMax: providers.video.maxSeconds,
    entityIds: [...knownEntityIds(run, brief)],
    lineIds: voice.lines.map((l) => l.line_id),
    textAllowed,
    maxWordsOnScreen: b.text_policy.max_words_on_screen,
    shotRange: b.pacing.shot_count_hint,
  });

  // 3. Blast radius: which shots' storyboard entries (or routing) differ from before?
  const before = Object.fromEntries(sb.shots.map((s) => [s.id, shortHash(s)]));
  const routeBefore = run.hasOutput("06_route")
    ? run.readOutput("06_route", RoutingPlanSchema)
    : null;
  const routeAfter = routeShots({
    brief,
    shots: after.shots,
    providers,
    aiVideoSecondsTarget: run.manifest.cost.ai_video_seconds_target,
    hardCapUsd: run.manifest.cost.hard_cap_usd,
    spentUsd: run.budget.spentUsd,
    clipSeconds: b.budget.clip_seconds,
    outputSize: { width: OUTPUT.width, height: OUTPUT.height },
  }).plan;
  const changed: string[] = [];
  const regenerated: string[] = [];
  const kept: string[] = [];
  let regenUsd = 0;
  for (const s of after.shots) {
    const oldId = [...renamed.entries()].find(([, n]) => n === s.id)?.[0] ?? null;
    const entryChanged = !oldId || before[oldId] !== shortHash(s) || oldId !== s.id;
    const rb = oldId ? routeBefore?.shots.find((r) => r.shot_id === oldId) : null;
    const ra = routeAfter.shots.find((r) => r.shot_id === s.id);
    const routeChanged =
      !!rb && !!ra && (rb.source !== ra.source || rb.video_seconds !== ra.video_seconds);
    if (entryChanged) changed.push(s.id);
    const produced = !!loadShotRecord(run, s.id)?.keyframe;
    if (entryChanged || routeChanged) {
      regenerated.push(s.id);
      if (produced) regenUsd += ra?.est_cost_usd ?? 0;
    } else kept.push(s.id);
  }
  const continuityUsd =
    changed.length || duplicates.length || deleted.size
      ? regenerationEstimate(run, dummyLedger, "continuity", null).estimate_usd
      : 0;
  return {
    valid: issues.length === 0,
    issues,
    changed_shots: changed,
    regenerated_shots: regenerated,
    kept_shots: kept,
    continuity_llm_estimate_usd: continuityUsd,
    regeneration_estimate_usd: regenUsd,
    total_additional_estimate_usd: continuityUsd + regenUsd,
    new_total_duration_s: after.total_duration_s,
    storyboard_after: after,
  };
}

// The continuity estimate needs no ledger; a stub keeps the signature simple here.
const dummyLedger = {
  check: () => ({ ok: true, blocking_rule: null, reason: null, windows: [], hold_usd: 0 }),
} as unknown as BudgetLedger;

/** Validate, write the edited storyboard and reset the stages that depend on it. */
export function applyEdit(
  run: RunContext,
  req: StoryboardEditRequest,
  actor = "local-user",
): EditImpact {
  const impact = computeEdit(run, req);
  if (!impact.valid) return impact;
  const hashesBefore = run.hasOutput("05_continuity")
    ? continuityShotHashes(run.readOutput("04_storyboard", StoryboardArtifactSchema), {})
    : null;
  writeJsonAtomic(run.outputPath("04_storyboard"), impact.storyboard_after);
  run.repos.audit({
    actor,
    action: "storyboard.edit",
    target_type: "run",
    target_id: run.runId,
    run_id: run.runId,
    details: {
      note: req.note ?? null,
      changed: impact.changed_shots,
      regenerated: impact.regenerated_shots,
      shots_before: hashesBefore ? Object.keys(hashesBefore).length : null,
      shots_after: impact.storyboard_after.shots.length,
    },
  });
  // The storyboard stage itself stays done (its inputs did not change); everything after it re-runs.
  resetFrom(run, ALL_STAGES, "continuity");
  // Editing re-opens the plan for review: production must be approved again.
  run.manifest.options.dry_run = true;
  run.save();
  return impact;
}

/** Throw away the storyboard and let the artist write a new one (a paid LLM call). */
export function requestStoryboardRegeneration(
  run: RunContext,
  actor = "local-user",
  req: { variation?: VariationStrength; instruction?: string | null } = {},
): string[] {
  const variation = req.variation ?? "fresh";
  run.repos.audit({
    actor,
    action: "storyboard.regenerate",
    target_type: "run",
    target_id: run.runId,
    run_id: run.runId,
    details: { variation, instruction: req.instruction ?? null },
  });
  run.manifest.pending_regeneration = {
    target: "storyboard",
    shot_id: null,
    variation,
    instruction: req.instruction ?? null,
    requested_at: nowIso(),
    actor,
  };
  run.manifest.options.dry_run = true;
  run.save();
  return resetFrom(run, ALL_STAGES, "storyboard");
}

export { approveStoryboard, requestConceptRegeneration, requestStoryboardShotRegeneration };
