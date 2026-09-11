import { z } from "zod";
import type { RunContext } from "../pipeline/run.js";
import type { ContinuityBible } from "../schema/continuity.js";
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
): Promise<AgentResult<MotionPrompt>> {
  const per = continuity.per_shot.find((p) => p.shot_id === shot.id);
  const userMessage = `# Motion prompt for ${shot.id} (${clipSeconds} s clip)
The keyframe was generated from: ${keyframePrompt}

Storyboard action: ${shot.action}
Camera: ${shot.movement} (${shot.shot_size}, ${shot.lens})
Intent: ${shot.shot_intent}
Identity blocks: ${per?.identity_blocks.join(" | ") || "none"}
Realism lock: ${continuity.locks.realism}

Return one motion prompt.`;
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
