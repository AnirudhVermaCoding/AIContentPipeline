import { loadPrompt } from "../../agents/prompts.js";
import type { BrandProfile } from "../../brand/schema.js";
import type { BudgetLedger } from "../../budget/ledger.js";
import { llmEstimate, PRICING_AS_OF } from "../../config/pricing.js";
import { type ProviderSettings, resolveProviders } from "../../config/settings.js";
import type { RunContext } from "../../pipeline/run.js";
import { buildProviders } from "../../providers/registry.js";
import type { Providers } from "../../providers/types.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { OUTPUT } from "../../schema/common.js";
import { ContinuityBibleSchema } from "../../schema/continuity.js";
import { RoutingPlanSchema } from "../../schema/routing.js";
import { StoryboardArtifactSchema } from "../../schema/storyboard.js";
import { VoiceResultSchema } from "../../schema/voice.js";
import type {
  BudgetCheckView,
  EstimateRange,
  PreflightView,
  RegenerationEstimate,
} from "../api-types.js";

/**
 * Everything the UI shows before money is spent. All numbers here are ESTIMATED: they use the
 * same pricing table and the same provider `estimate()` functions the stages use at reservation
 * time, so an estimate and the reservation it becomes are always the same arithmetic.
 */

const CREATIVE_OUT = 2500;
const FAST_OUT = 900;

/** Estimate-only providers: the mock adapters price with the same table as the live ones. */
export function estimatorProviders(settings: ProviderSettings): Providers {
  return buildProviders(settings, { mode: "mock", fixtureResolvers: [() => undefined] });
}

function agentEstimate(
  providers: Providers,
  name: string,
  tier: "creative" | "fast",
  outTokens: number,
  contextChars = 9000,
  factor = 1,
): number {
  const llm = tier === "creative" ? providers.llmCreative : providers.llmFast;
  let promptChars = 6000;
  try {
    promptChars = loadPrompt(name).text.length;
  } catch {
    // prompt file unavailable: keep the default
  }
  const inputTokens = Math.ceil((promptChars + contextChars) / 4) + 300;
  return llmEstimate(llm.id, llm.model, inputTokens, outTokens) * factor;
}

export interface PrePlanInputs {
  durationS?: number | null;
  aiVideoSeconds?: number | null;
  narration?: "brand_default" | "voice" | "no_voice";
  referenceCount?: number;
  hardCapUsd?: number | null;
}

/** Before any stage has run: a range from the brand's pacing and the pricing table. */
export function prePlanEstimate(
  profile: BrandProfile,
  settings: ProviderSettings,
  inputs: PrePlanInputs = {},
): EstimateRange {
  const p = estimatorProviders(settings);
  const breakdown: EstimateRange["breakdown"] = [];
  const assumptions: string[] = [];
  const shotsMin = profile.pacing.shot_count_hint.min;
  const shotsMax = profile.pacing.shot_count_hint.max;
  const duration =
    inputs.durationS ?? (profile.pacing.duration_s.min + profile.pacing.duration_s.max) / 2;

  // Planning LLM work (creative director → continuity), plus per-shot prompters.
  const director = agentEstimate(p, "creative-director", "creative", CREATIVE_OUT);
  const research = agentEstimate(p, "researcher", "creative", 1800, 6000, 3);
  const writer = agentEstimate(p, "screenwriter", "creative", 1500);
  const artist = agentEstimate(p, "storyboard-artist", "creative", 3500, 12000);
  const continuity = agentEstimate(p, "continuity-controller", "fast", 2500, 12000);
  const imagePrompt = agentEstimate(p, "image-prompter", "fast", FAST_OUT, 4000);
  const motionPrompt = agentEstimate(p, "motion-prompter", "fast", 400, 2500);
  const planningMin = director + writer + artist + continuity;
  const planningMax = planningMin + research;
  breakdown.push({
    item: "Creative direction, script, storyboard, continuity (LLM)",
    min_usd: planningMin,
    max_usd: planningMax,
    note: "Research adds a web-search pass only when the creative director asks for it.",
  });

  // Narration.
  const narrate =
    inputs.narration === "no_voice"
      ? false
      : inputs.narration === "voice"
        ? true
        : profile.voice.narration_policy !== "never";
  const chars = narrate ? duration * 13 : 0;
  const ttsMin = p.tts.estimate(Math.round(chars * 0.8));
  const ttsMax = p.tts.estimate(Math.round(chars * 1.2));
  breakdown.push({
    item: `Narration (${p.tts.id} ${p.tts.model})`,
    min_usd: ttsMin,
    max_usd: ttsMax,
    note: narrate
      ? `≈${Math.round(chars)} characters for ${Math.round(duration)} s of speech`
      : "No narration for this brand/run.",
  });
  if (!narrate) assumptions.push("Music-only video: no narration cost.");

  // Keyframes: one per shot, with the router's retry allowance.
  const refs = inputs.referenceCount ?? 0;
  const imgUnit = p.image.estimate(OUTPUT.width, OUTPUT.height, Math.min(refs, 3));
  const imgMin = shotsMin * imgUnit * 1.3 + shotsMin * imagePrompt;
  const imgMax = shotsMax * imgUnit * 1.3 + shotsMax * imagePrompt;
  breakdown.push({
    item: `Keyframes (${p.image.id} ${p.image.model})`,
    min_usd: imgMin,
    max_usd: imgMax,
    note: `${shotsMin}–${shotsMax} shots × 1 image (+30% retry allowance)${refs ? `, ${Math.min(refs, 3)} product reference(s) per image` : ""}`,
  });

  // Generated video seconds around the soft target.
  const target = inputs.aiVideoSeconds ?? profile.budget.ai_video_seconds_target;
  const clipMin = profile.budget.clip_seconds.min;
  const clipsMin = Math.max(1, Math.floor((target * 0.8) / clipMin));
  const clipsMax = Math.max(clipsMin, Math.ceil((target * 1.2) / clipMin));
  const vidMin = p.video.estimate(target * 0.8) * 1.15 + clipsMin * motionPrompt;
  const vidMax = p.video.estimate(target * 1.2) * 1.15 + clipsMax * motionPrompt;
  breakdown.push({
    item: `Generated video (${p.video.id} ${p.video.model})`,
    min_usd: vidMin,
    max_usd: vidMax,
    note: `soft target ${target} s of real motion (${Math.round(target * 0.8)}–${Math.round(target * 1.2)} s, +15% retry allowance)`,
  });
  assumptions.push(
    "The router decides how many shots get real motion inside the soft target and the per-video cap.",
  );

  let min = breakdown.reduce((n, b) => n + b.min_usd, 0);
  let max = breakdown.reduce((n, b) => n + b.max_usd, 0);
  if (inputs.hardCapUsd != null) {
    max = Math.min(max, inputs.hardCapUsd);
    min = Math.min(min, max);
    assumptions.push(`Never more than the per-video cap ($${inputs.hardCapUsd.toFixed(2)}).`);
  }
  return {
    min_usd: min,
    max_usd: max,
    typical_usd: (min + max) / 2,
    planning_usd: planningMax + ttsMax,
    source: "ESTIMATED",
    breakdown,
    assumptions,
  };
}

export function budgetCheckView(
  ledger: BudgetLedger,
  brandId: string,
  holdUsd: number,
  opts: {
    runId?: string | null;
    runCapUsd?: number | null;
    estimateUsd?: number | null;
    expectedUsd?: number | null;
  } = {},
): BudgetCheckView {
  const check = ledger.check(brandId, holdUsd, {
    excludeRunId: opts.runId ?? null,
    runCapUsd: opts.runCapUsd ?? null,
    estimateUsd: opts.estimateUsd ?? null,
  });
  const expected = opts.expectedUsd ?? holdUsd;
  const remaining = (rule: string) => {
    const w = check.windows.find((x) => x.rule === rule);
    if (!w || w.available_usd == null) return null;
    return w.available_usd - expected;
  };
  return {
    ok: check.ok,
    blocking_rule: check.blocking_rule,
    reason: check.reason,
    hold_usd: holdUsd,
    windows: check.windows,
    after_run_usd: {
      daily_remaining: remaining("daily"),
      wallet_remaining: remaining("wallet"),
      two_day_remaining: remaining("two_day"),
    },
  };
}

/** The preflight after planning: exact routing numbers, still an estimate for what follows. */
export function preflightView(run: RunContext, ledger: BudgetLedger): PreflightView {
  const settings = resolveProviders(run.brand.profile);
  const hardCap = run.manifest.cost.hard_cap_usd;
  const spent = run.budget.spentUsd;
  const hold = Math.max(0, hardCap - spent);
  const planned = run.hasOutput("06_route");
  const brief = run.hasOutput("00_brief") ? run.readOutput("00_brief", CreativeBriefSchema) : null;
  if (!planned) {
    const estimate = prePlanEstimate(run.brand.profile, settings, {
      durationS: brief?.target_duration_s ?? null,
      aiVideoSeconds: run.manifest.cost.ai_video_seconds_target,
      referenceCount: run.brand.product?.references.filter((r) => r.exists).length ?? 0,
      hardCapUsd: hardCap,
    });
    return {
      stage: "pre_plan",
      estimate,
      route_estimate_usd: null,
      hard_cap_usd: hardCap,
      max_exposure_usd: hold,
      budget: budgetCheckView(ledger, run.manifest.brand_id, hold, {
        runId: run.runId,
        runCapUsd: hardCap,
        estimateUsd: estimate.min_usd,
        expectedUsd: estimate.max_usd,
      }),
      shots: null,
      ai_video_seconds: null,
      images: null,
      narration: null,
      duration_s: brief?.target_duration_s ?? null,
      concept: brief?.concept ?? null,
      emotional_arc: brief?.emotional_arc ?? null,
      alternatives: [],
      promise: null,
    };
  }
  const route = run.readOutput("06_route", RoutingPlanSchema);
  const sb = run.readOutput("04_storyboard", StoryboardArtifactSchema);
  const voice = run.hasOutput("03_voice") ? run.readOutput("03_voice", VoiceResultSchema) : null;
  const remainingEstimate = Math.max(0, route.totals.est_total_usd - spent);
  const p = estimatorProviders(settings);
  const imagePrompt = agentEstimate(p, "image-prompter", "fast", FAST_OUT, 4000);
  const motionPrompt = agentEstimate(p, "motion-prompter", "fast", 400, 2500);
  const videoShots = route.shots.filter((s) => s.source === "GEN_VIDEO").length;
  const promptsUsd = sb.shots.length * imagePrompt + videoShots * motionPrompt;
  const min = Math.max(0, remainingEstimate * 0.85);
  const max = Math.min(hold, remainingEstimate * 1.15 + promptsUsd);
  const estimate: EstimateRange = {
    min_usd: min,
    max_usd: max,
    typical_usd: Math.min(hold, remainingEstimate + promptsUsd * 0.5),
    planning_usd: spent,
    source: "ESTIMATED",
    breakdown: [
      {
        item: "Keyframes",
        min_usd: route.totals.est_image_usd,
        max_usd: route.totals.est_image_usd,
        note: `${sb.shots.length} shots, +30% retry allowance`,
      },
      {
        item: "Generated video",
        min_usd: route.totals.est_video_usd,
        max_usd: route.totals.est_video_usd,
        note: `${route.totals.ai_video_seconds} s across ${videoShots} clip(s), +15% retry allowance`,
      },
      {
        item: "Prompting (LLM)",
        min_usd: route.totals.est_llm_usd,
        max_usd: route.totals.est_llm_usd + promptsUsd,
        note: "image and motion prompts per shot",
      },
      {
        item: "Already spent (planning + narration)",
        min_usd: spent,
        max_usd: spent,
        note: "actual, from the ledger",
      },
    ],
    assumptions: [
      "Routing estimate from 06_route; retries within the per-video cap may add up to the maximum exposure.",
    ],
  };
  return {
    stage: "planned",
    estimate,
    route_estimate_usd: route.totals.est_total_usd,
    hard_cap_usd: hardCap,
    max_exposure_usd: hold,
    budget: budgetCheckView(ledger, run.manifest.brand_id, hold, {
      runId: run.runId,
      runCapUsd: hardCap,
      estimateUsd: route.totals.est_total_usd,
      expectedUsd: max,
    }),
    shots: sb.shots.length,
    ai_video_seconds: route.totals.ai_video_seconds,
    images: sb.shots.length,
    narration: voice ? (voice.music_only ? "music_only" : "voice") : null,
    duration_s: sb.total_duration_s,
    concept: brief?.concept ?? null,
    emotional_arc: brief?.emotional_arc ?? null,
    alternatives: route.budget_check.alternatives,
    promise: route.promise_check,
  };
}

export function regenerationEstimate(
  run: RunContext,
  ledger: BudgetLedger,
  kind: RegenerationEstimate["kind"],
  shotId: string | null,
): RegenerationEstimate {
  const settings = resolveProviders(run.brand.profile);
  const p = estimatorProviders(settings);
  const breakdown: RegenerationEstimate["breakdown"] = [];
  const sb = run.hasOutput("04_storyboard")
    ? run.readOutput("04_storyboard", StoryboardArtifactSchema)
    : null;
  const cont = run.hasOutput("05_continuity")
    ? run.readOutput("05_continuity", ContinuityBibleSchema)
    : null;
  const route = run.hasOutput("06_route") ? run.readOutput("06_route", RoutingPlanSchema) : null;
  if (kind === "keyframe") {
    const refs = cont?.per_shot.find((s) => s.shot_id === shotId)?.reference_images.length ?? 0;
    const chain = refs < 4 ? 1 : 0;
    breakdown.push({
      item: `Image prompt (${p.llmFast.model})`,
      usd: agentEstimate(p, "image-prompter", "fast", FAST_OUT, 4000),
      note: "skipped when you supply the prompt yourself",
    });
    breakdown.push({
      item: `Keyframe (${p.image.id} ${refs + chain ? p.image.editModel : p.image.model})`,
      usd: p.image.estimate(OUTPUT.width, OUTPUT.height, refs + chain),
      note: `${OUTPUT.width}×${OUTPUT.height}, ${refs + chain} reference image(s)`,
    });
  } else if (kind === "clip") {
    const seconds = route?.shots.find((s) => s.shot_id === shotId)?.video_seconds ?? null;
    if (seconds == null) throw new Error(`${shotId ?? "shot"} is not routed to generated video`);
    breakdown.push({
      item: `Motion prompt (${p.llmFast.model})`,
      usd: agentEstimate(p, "motion-prompter", "fast", 400, 2500),
      note: "",
    });
    breakdown.push({
      item: `Clip (${p.video.id} ${p.video.model})`,
      usd: p.video.estimate(seconds),
      note: `${seconds} s × current ${p.video.resolution} rate`,
    });
  } else if (kind === "storyboard") {
    breakdown.push({
      item: `Storyboard (${p.llmCreative.model})`,
      usd: agentEstimate(p, "storyboard-artist", "creative", 3500, 12000),
      note: "",
    });
    breakdown.push({
      item: `Continuity (${p.llmFast.model})`,
      usd: agentEstimate(p, "continuity-controller", "fast", 2500, 12000),
      note: "",
    });
    if (sb && route) {
      const produced = sb.shots.length;
      const media = route.shots.reduce((n, s) => n + s.est_cost_usd, 0);
      const hasKeyframes = run.hasOutput("07_keyframes");
      if (hasKeyframes && produced)
        breakdown.push({
          item: "Re-producing every shot after a new storyboard",
          usd: media,
          note: "a new storyboard changes every shot; existing keyframes and clips stay on disk but are not reused",
        });
    }
  } else if (kind === "continuity") {
    breakdown.push({
      item: `Continuity (${p.llmFast.model})`,
      usd: agentEstimate(p, "continuity-controller", "fast", 2500, 12000),
      note: "only the changed shots get new continuity text",
    });
  }
  const total = breakdown.reduce((n, b) => n + b.usd, 0);
  return {
    kind,
    shot_id: shotId,
    estimate_usd: total,
    breakdown,
    source: "ESTIMATED",
    budget: budgetCheckView(ledger, run.manifest.brand_id, total, {
      runId: run.runId,
      runCapUsd: run.manifest.cost.hard_cap_usd,
      estimateUsd: run.budget.spentUsd + total,
      expectedUsd: total,
    }),
  };
}

export const PRICING_VERSION = PRICING_AS_OF;
