import { z } from "zod";
import {
  buildCreativeControlContext,
  controlsForRun,
  hardConstraintsFor,
} from "../creative/controls.js";
import type { RunContext } from "../pipeline/run.js";
import type { ContinuityBible } from "../schema/continuity.js";
import type { VariationStrength } from "../schema/creative.js";
import type { Shot } from "../schema/storyboard.js";
import { type AgentResult, callAgent } from "./base.js";

export const MotionPromptSchema = z.object({ prompt: z.string() });
export type MotionPrompt = z.infer<typeof MotionPromptSchema>;

export async function runMotionPrompter(
  run: RunContext,
  stageId: string,
  shot: Shot,
  continuity: ContinuityBible,
  clipSeconds: number,
  keyframePrompt: string,
  feedback: string | null = null,
  variation: VariationStrength | null = null,
): Promise<AgentResult<MotionPrompt>> {
  const per = continuity.per_shot.find((p) => p.shot_id === shot.id);
  const controls = controlsForRun(run);
  const creative = buildCreativeControlContext({
    creativeFreedom: controls.creative_freedom,
    goalFocus: controls.goal_focus,
    stage: "video",
    hardConstraints: [
      ...(per?.identity_blocks ?? []).map((b) => `Identity block (restate briefly): ${b}`),
      `Realism lock: ${continuity.locks.realism}`,
      "The keyframe fixes subject, setting and light: no new elements, no new people, no text.",
      ...hardConstraintsFor(run.brand),
    ],
    variation: variation ? { strength: variation, target: "clip" } : null,
  });
  const userMessage = `# Motion prompt for ${shot.id} (${clipSeconds} s clip)
The keyframe was generated from: ${keyframePrompt}

Storyboard action: ${shot.action}
Camera: ${shot.movement} (${shot.shot_size}, ${shot.lens})
Intent: ${shot.shot_intent}
Identity blocks: ${per?.identity_blocks.join(" | ") || "none"}
Realism lock: ${continuity.locks.realism}
${feedback ? `\n## Feedback from the previous clip\n${feedback}\n` : ""}
${creative.text}

Return one motion prompt (40 to 90 words).`;
  return callAgent(run, {
    name: "motion-prompter",
    tier: "fast",
    schema: MotionPromptSchema,
    userMessage,
    stageId,
    shotId: shot.id,
    labelSuffix: shot.id,
    validate: (p) => {
      const words = p.prompt.trim().split(/\s+/).length;
      return words < 20 || words > 140
        ? [`motion prompt should be 40-90 words (got ${words})`]
        : [];
    },
  });
}
