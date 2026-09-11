import type { Providers } from "../providers/types.js";
import type { CreativeBrief } from "../schema/brief.js";
import type { AssetSource } from "../schema/common.js";
import type { RoutingPlan, ShotRoute } from "../schema/routing.js";
import type { Shot } from "../schema/storyboard.js";

export interface RouterInput {
  brief: CreativeBrief;
  shots: Shot[];
  providers: Providers;
  aiVideoSecondsTarget: number;
  hardCapUsd: number;
  spentUsd: number;
  clipSeconds: { min: number; max: number };
  /** Allowance multipliers for retries. */
  imageRetryFactor?: number;
  videoRetryFactor?: number;
  /** Fixed remaining LLM spend estimate (prompts, editor). */
  remainingLlmUsd?: number;
  outputSize: { width: number; height: number };
}

export interface RouterDecision {
  plan: RoutingPlan;
  decisions: Array<{ subject: string; options: string[]; reason: string }>;
  conflict: null | { message: string; alternatives: RoutingPlan["budget_check"]["alternatives"] };
}

function clipLength(shot: Shot, clip: { min: number; max: number }): number {
  return Math.min(clip.max, Math.max(clip.min, Math.ceil(shot.duration_s + 0.5)));
}

const heroRank = (s: Shot): number =>
  s.hero_moment ? 0 : s.importance === "hero" ? 1 : s.importance === "support" ? 2 : 3;

/**
 * Deterministic Asset Router (MVP-A): decides per shot between GEN_VIDEO, STILL_MOTION and STILL,
 * spending real motion where the story needs it, within the soft seconds target and the brief's
 * motion promise, and never past the absolute dollar cap.
 */
export function routeShots(input: RouterInput): RouterDecision {
  const { brief, shots, providers, clipSeconds } = input;
  const promise = brief.motion_promise;
  const imageRetry = input.imageRetryFactor ?? 1.3;
  const videoRetry = input.videoRetryFactor ?? 1.15;
  const remainingLlm = input.remainingLlmUsd ?? 0.06;
  const total = shots.reduce((n, s) => n + s.duration_s, 0);
  const decisions: RouterDecision["decisions"] = [];

  // Candidates for real motion, most important first, then story order.
  const essential = shots.filter((s) => s.motion_need === "essential");
  const subtle = shots.filter((s) => s.motion_need === "subtle");
  const ordered = [...essential].sort(
    (a, b) => heroRank(a) - heroRank(b) || shots.indexOf(a) - shots.indexOf(b),
  );
  const extra = [...subtle].sort(
    (a, b) => heroRank(a) - heroRank(b) || shots.indexOf(a) - shots.indexOf(b),
  );

  const buildPlan = (
    videoIds: Set<string>,
  ): { routes: ShotRoute[]; seconds: number; ratio: number } => {
    let seconds = 0;
    let motionDuration = 0;
    const routes = shots.map((s): ShotRoute => {
      if (videoIds.has(s.id)) {
        const len = clipLength(s, clipSeconds);
        seconds += len;
        motionDuration += s.duration_s;
        return {
          shot_id: s.id,
          source: "GEN_VIDEO",
          fallback: "STILL_MOTION",
          video_seconds: len,
          est_cost_usd:
            providers.image.estimate(input.outputSize.width, input.outputSize.height, 0) *
              imageRetry +
            providers.video.estimate(len) * videoRetry,
          reason: s.hero_moment
            ? "hero moment; the story needs real motion here"
            : s.motion_need === "essential"
              ? "motion is essential to this shot"
              : "added to honour the motion promise",
        };
      }
      const source: AssetSource = s.motion_need === "none" ? "STILL" : "STILL_MOTION";
      return {
        shot_id: s.id,
        source,
        fallback: null,
        video_seconds: null,
        est_cost_usd:
          providers.image.estimate(input.outputSize.width, input.outputSize.height, 0) * imageRetry,
        reason:
          source === "STILL"
            ? "a held frame tells it"
            : "a still with restrained movement is enough",
      };
    });
    return { routes, seconds, ratio: total > 0 ? motionDuration / total : 0 };
  };

  const costOf = (routes: ShotRoute[]) =>
    input.spentUsd + remainingLlm + routes.reduce((n, r) => n + r.est_cost_usd, 0);

  // Plan A: essential shots up to the soft target; ensure the promise is met even if that exceeds the target.
  const chosen = new Set<string>();
  let seconds = 0;
  for (const s of ordered) {
    if (seconds >= input.aiVideoSecondsTarget) break;
    chosen.add(s.id);
    seconds += clipLength(s, clipSeconds);
  }
  const meetsPromise = (p: ReturnType<typeof buildPlan>) =>
    p.seconds >= promise.min_ai_video_s && p.ratio >= promise.min_motion_ratio;
  let planA = buildPlan(chosen);
  for (const s of [...ordered, ...extra]) {
    if (meetsPromise(planA)) break;
    if (chosen.has(s.id)) continue;
    chosen.add(s.id);
    planA = buildPlan(chosen);
  }
  if (planA.seconds > input.aiVideoSecondsTarget && meetsPromise(planA)) {
    decisions.push({
      subject: "ai_video_seconds",
      options: [
        `soft target ${input.aiVideoSecondsTarget} s`,
        `promise minimum ${promise.min_ai_video_s} s`,
      ],
      reason: `the motion promise (${promise.kind}) needs ${planA.seconds} s of generated motion, above the soft target`,
    });
  }

  // Plan B: only what the promise strictly needs. Plan C: stills only (if the brief allows).
  const minimal = new Set<string>();
  let planB = buildPlan(minimal);
  for (const s of [...ordered, ...extra]) {
    if (
      meetsPromise(planB) &&
      (promise.min_ai_video_s > 0 || s.motion_need !== "essential" || !s.hero_moment)
    )
      break;
    minimal.add(s.id);
    planB = buildPlan(minimal);
  }
  const planC = buildPlan(new Set());

  const candidates: Array<{
    name: string;
    plan: ReturnType<typeof buildPlan>;
    legal: boolean;
    cost_of: string;
  }> = [
    { name: "story plan", plan: planA, legal: true, cost_of: "" },
    {
      name: "promise minimum",
      plan: planB,
      legal: true,
      cost_of: "drops motion that was creatively desirable but not promised",
    },
    {
      name: "stills only",
      plan: planC,
      legal: promise.still_fallback_allowed || promise.min_ai_video_s === 0,
      cost_of: "no generated motion; hero moment becomes an animated still",
    },
  ];
  const affordable = candidates.filter((c) => c.legal && costOf(c.plan.routes) <= input.hardCapUsd);
  const pick = affordable[0] ?? null;

  const alternatives = candidates
    .filter((c) => c !== pick)
    .map((c) => ({
      description: `${c.name}: ${c.plan.seconds} s of generated video${c.legal ? "" : " (would break the motion promise)"}`,
      est_total_usd: Math.round(costOf(c.plan.routes) * 100) / 100,
      cost_of: c.cost_of || "n/a",
    }));

  const finalPlan = pick ? pick.plan : planA;
  if (pick && pick.name !== "story plan") {
    decisions.push({
      subject: "budget_downgrade",
      options: candidates.map((c) => `${c.name} $${costOf(c.plan.routes).toFixed(2)}`),
      reason: `the story plan exceeds the $${input.hardCapUsd.toFixed(2)} cap; using "${pick.name}" which still honours the promise`,
    });
  }
  const estTotal = costOf(finalPlan.routes);
  const estImage = finalPlan.routes.reduce(
    (n) =>
      n + providers.image.estimate(input.outputSize.width, input.outputSize.height, 0) * imageRetry,
    0,
  );
  const estVideo = finalPlan.routes.reduce(
    (n, r) => n + (r.video_seconds ? providers.video.estimate(r.video_seconds) * videoRetry : 0),
    0,
  );

  const plan: RoutingPlan = {
    shots: finalPlan.routes,
    totals: {
      ai_video_seconds: finalPlan.seconds,
      est_image_usd: Math.round(estImage * 1000) / 1000,
      est_video_usd: Math.round(estVideo * 1000) / 1000,
      est_llm_usd: remainingLlm,
      est_tts_usd: 0,
      est_total_usd: Math.round(estTotal * 1000) / 1000,
    },
    promise_check: {
      satisfied: meetsPromise(finalPlan),
      notes: `${finalPlan.seconds} s generated (promise ≥ ${promise.min_ai_video_s} s), motion ratio ${finalPlan.ratio.toFixed(2)} (promise ≥ ${promise.min_motion_ratio})`,
    },
    budget_check: {
      hard_cap_usd: input.hardCapUsd,
      spent_usd: input.spentUsd,
      status: pick ? "ok" : "conflict",
      alternatives,
    },
  };

  return {
    plan,
    decisions,
    conflict: pick
      ? null
      : {
          message: `No plan satisfies the motion promise inside the $${input.hardCapUsd.toFixed(2)} cap (story plan ≈ $${costOf(planA.routes).toFixed(2)}). Raise the cap with --budget or relax the promise.`,
          alternatives,
        },
  };
}
