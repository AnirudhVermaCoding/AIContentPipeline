import type { RunContext } from "../pipeline/run.js";
import { type CreativeBrief, CreativeBriefSchema } from "../schema/brief.js";
import { type AgentResult, callAgent } from "./base.js";

export async function runCreativeDirector(
  run: RunContext,
  stageId: string,
  topic: string,
  goal: string | null,
): Promise<AgentResult<CreativeBrief>> {
  const b = run.brand.profile;
  const videoRate = run.providers.video.estimate(1);
  const entities = b.entities.length
    ? b.entities.map((e) => `- ${e.id} (${e.kind}): ${e.name}. ${e.static_features}`).join("\n")
    : "- none";
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

Return the CreativeBrief.`;

  const knownIds = new Set(b.entities.map((e) => e.id));
  return callAgent(run, {
    name: "creative-director",
    tier: "creative",
    schema: CreativeBriefSchema,
    userMessage,
    stageId,
    validate: (brief) => {
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
    },
  });
}
