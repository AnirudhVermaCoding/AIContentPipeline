import { z } from "zod";
import {
  buildCreativeControlContext,
  conceptCandidateCount,
  controlsForRun,
  hardConstraintsFor,
} from "../creative/controls.js";
import type { RunContext } from "../pipeline/run.js";
import { type CreativeBrief, CreativeBriefSchema } from "../schema/brief.js";
import type { VariationStrength } from "../schema/creative.js";
import { type AgentResult, callAgent } from "./base.js";

/** One concept the director considered (LLM-facing: no optionals, ranges checked in validate). */
export const ConceptCandidateSchema = z.object({
  title: z.string(),
  concept: z.string().describe("One paragraph: the idea"),
  hook: z.string().describe("The opening moment"),
  why: z.string().describe("Why it would work for this brand and goal"),
  scores: z.object({
    originality: z.number(),
    goal_alignment: z.number(),
    brand_fit: z.number(),
    feasibility: z.number(),
    product_accuracy: z.number(),
    budget_feasibility: z.number(),
    ai_slop_risk: z.number().describe("10 = very likely to look like generic AI video"),
  }),
});
export type ConceptCandidate = z.infer<typeof ConceptCandidateSchema>;

const DirectorCandidatesSchema = z.object({
  candidates: z.array(ConceptCandidateSchema),
  selected_index: z.number().int(),
  brief: CreativeBriefSchema,
});

export interface DirectorResult extends AgentResult<CreativeBrief> {
  /** Every concept drafted (empty when a single concept was asked for). */
  candidates: ConceptCandidate[];
  selectedIndex: number;
  candidateCount: number;
  /** Deterministic re-ranking of the model's candidates with the goal-focus weights. */
  ranking: Array<{ index: number; title: string; score: number }>;
}

export interface DirectorOptions {
  variation?: {
    strength: VariationStrength;
    instruction: string | null;
    previous: string | null;
  } | null;
}

/** Ranking weights: goal focus drives goal alignment, creative freedom drives originality. */
export function candidateWeights(creativeFreedom: number, goalFocus: number) {
  return {
    goal_alignment: Math.round((1 + 3 * goalFocus) * 10) / 10,
    originality: Math.round((1 + 3 * creativeFreedom) * 10) / 10,
    brand_fit: 2,
    feasibility: 1,
    product_accuracy: 2,
    budget_feasibility: 1,
    ai_slop_risk: -1,
  };
}

export function rankCandidates(
  candidates: ConceptCandidate[],
  creativeFreedom: number,
  goalFocus: number,
): DirectorResult["ranking"] {
  const w = candidateWeights(creativeFreedom, goalFocus);
  return candidates
    .map((c, index) => ({
      index,
      title: c.title,
      score:
        Math.round(
          (c.scores.goal_alignment * w.goal_alignment +
            c.scores.originality * w.originality +
            c.scores.brand_fit * w.brand_fit +
            c.scores.feasibility * w.feasibility +
            c.scores.product_accuracy * w.product_accuracy +
            c.scores.budget_feasibility * w.budget_feasibility +
            c.scores.ai_slop_risk * w.ai_slop_risk) *
            10,
        ) / 10,
    }))
    .sort((a, b) => b.score - a.score);
}

/** The brief invariants, shared by the single-concept and the candidates call. */
export function validateBrief(brief: CreativeBrief, run: RunContext): string[] {
  const b = run.brand.profile;
  const knownIds = new Set(b.entities.map((e) => e.id));
  const issues: string[] = [];
  if (!b.content_pillars.some((p) => p.id === brief.pillar_id))
    issues.push(`pillar_id "${brief.pillar_id}" is not a brand pillar`);
  if (
    brief.target_duration_s < b.pacing.duration_s.min - 2 ||
    brief.target_duration_s > b.pacing.duration_s.max + 2
  )
    issues.push(
      `target_duration_s ${brief.target_duration_s} is outside ${b.pacing.duration_s.min}-${b.pacing.duration_s.max}`,
    );
  if (b.text_policy.captions === "never" && brief.text_overlay_intent !== "none")
    issues.push("text_overlay_intent must be none for this brand");
  if (b.text_policy.captions === "brand_hook_only" && brief.text_overlay_intent === "captions")
    issues.push("this brand allows at most a single hook line, not captions");
  if (b.cta.policy === "never" && brief.cta_decision.use)
    issues.push("cta_decision.use must be false");
  if (b.cta.policy === "always" && !brief.cta_decision.use)
    issues.push("cta_decision.use must be true");
  if (!b.edit_defaults.modes_allowed.includes(brief.edit_mode_intent))
    issues.push(
      `edit_mode_intent ${brief.edit_mode_intent} is not allowed (${b.edit_defaults.modes_allowed.join(", ")})`,
    );
  for (const e of brief.entities_needed) {
    if (!e.is_new && !knownIds.has(e.id))
      issues.push(
        `entity "${e.id}" is not a brand entity; mark is_new with a description or use a known id`,
      );
    if (e.is_new && !e.description) issues.push(`new entity "${e.id}" needs a description`);
    if (!/^[a-z0-9_]+$/.test(e.id)) issues.push(`entity id "${e.id}" must be snake_case`);
  }
  if (brief.motion_promise.min_ai_video_s > brief.target_duration_s)
    issues.push("motion_promise.min_ai_video_s cannot exceed the target duration");
  if (
    brief.motion_promise.min_ai_video_s < 0 ||
    brief.motion_promise.min_motion_ratio < 0 ||
    brief.motion_promise.min_motion_ratio > 1
  )
    issues.push("motion_promise values out of range");
  if (brief.emotional_arc.length < 2) issues.push("emotional_arc needs at least two beats");
  return issues;
}

export async function runCreativeDirector(
  run: RunContext,
  stageId: string,
  topic: string,
  goal: string | null,
  opts: DirectorOptions = {},
): Promise<DirectorResult> {
  const b = run.brand.profile;
  const videoRate = run.providers.video.estimate(1);
  const entities = b.entities.length
    ? b.entities.map((e) => `- ${e.id} (${e.kind}): ${e.name}. ${e.static_features}`).join("\n")
    : "- none";
  const controls = controlsForRun(run);
  const candidateCount = conceptCandidateCount(controls.creative_freedom);
  const creative = buildCreativeControlContext({
    creativeFreedom: controls.creative_freedom,
    goalFocus: controls.goal_focus,
    stage: "director",
    goal,
    hardConstraints: hardConstraintsFor(run.brand, {
      hardCapUsd: run.manifest.cost.hard_cap_usd,
    }),
    variation: opts.variation ? { ...opts.variation, target: "concept" } : null,
  });
  const w = candidateWeights(controls.creative_freedom, controls.goal_focus);
  const candidatesSection =
    candidateCount > 1
      ? `
## Concept candidates
Draft ${candidateCount} genuinely different concepts (different hooks and narrative devices, not variations of one idea). For each give a title, a one-paragraph concept, its hook moment, why it would work, and scores from 0 to 10 for originality, goal_alignment, brand_fit, feasibility, product_accuracy, budget_feasibility and ai_slop_risk (10 = very likely to look like generic AI video). Rank them with these weights: goal_alignment ×${w.goal_alignment}, originality ×${w.originality}, brand_fit ×${w.brand_fit}, product_accuracy ×${w.product_accuracy}, feasibility ×${w.feasibility}, budget_feasibility ×${w.budget_feasibility}, ai_slop_risk ×${w.ai_slop_risk}. Put the winner's index in selected_index and write the complete CreativeBrief for the winner only.
`
      : "";
  const userMessage = `# Assignment
Topic: ${topic}
${goal ? `Goal: ${goal}\n` : ""}
${run.brain.creative}

## Visual world
${b.visual.style_summary}

## Entities available (reuse by id)
${entities}

## Hard constraints
- target_duration_s must be between ${b.pacing.duration_s.min} and ${b.pacing.duration_s.max}
- pillar_id must be one of: ${b.content_pillars.map((p) => p.id).join(", ")}
- text_overlay_intent: ${b.text_policy.captions === "never" ? "must be none" : `may be none, hook_only${b.text_policy.captions === "brand_hook_only" ? "" : " or captions"}`}
- cta_decision.use: ${b.cta.policy === "never" ? "must be false" : b.cta.policy === "always" ? "must be true" : "your call"}
- edit_mode_intent must be one of: ${b.edit_defaults.modes_allowed.join(", ")}
- narration policy: ${b.voice.narration_policy}
- motion economics: generated video costs about $${videoRate.toFixed(2)} per second at this brand's settings; the soft target is ${run.manifest.cost.ai_video_seconds_target} s of real motion per video and the absolute budget is $${run.manifest.cost.hard_cap_usd.toFixed(2)}. Ask for what the story needs; the router will reconcile.

${creative.text}
${candidatesSection}
Return the ${candidateCount > 1 ? "candidates, selected_index and the CreativeBrief" : "CreativeBrief"}.`;

  if (candidateCount === 1) {
    const single = await callAgent(run, {
      name: "creative-director",
      tier: "creative",
      schema: CreativeBriefSchema,
      userMessage,
      stageId,
      validate: (brief) => validateBrief(brief, run),
    });
    return { ...single, candidates: [], selectedIndex: 0, candidateCount: 1, ranking: [] };
  }
  const multi = await callAgent(run, {
    name: "creative-director",
    tier: "creative",
    schema: DirectorCandidatesSchema,
    userMessage,
    stageId,
    labelSuffix: "candidates",
    // One structured call carries every candidate; reserve for the longer answer.
    expectedOutputTokens: 2500 + 1200 * (candidateCount - 1),
    validate: (out) => {
      const issues: string[] = [];
      if (out.candidates.length < 2 || out.candidates.length > candidateCount)
        issues.push(
          `return between 2 and ${candidateCount} candidates (got ${out.candidates.length})`,
        );
      if (out.selected_index < 0 || out.selected_index >= out.candidates.length)
        issues.push("selected_index must point at one of the candidates");
      out.candidates.forEach((c, i) => {
        for (const [k, v] of Object.entries(c.scores))
          if (v < 0 || v > 10) issues.push(`candidate ${i} score ${k} must be 0-10`);
      });
      const titles = new Set(out.candidates.map((c) => c.title.trim().toLowerCase()));
      if (titles.size !== out.candidates.length) issues.push("candidate titles must differ");
      return [...issues, ...validateBrief(out.brief, run)];
    },
  });
  return {
    data: multi.data.brief,
    costUsd: multi.costUsd,
    attempts: multi.attempts,
    promptVersion: multi.promptVersion,
    candidates: multi.data.candidates,
    selectedIndex: multi.data.selected_index,
    candidateCount,
    ranking: rankCandidates(multi.data.candidates, controls.creative_freedom, controls.goal_focus),
  };
}
