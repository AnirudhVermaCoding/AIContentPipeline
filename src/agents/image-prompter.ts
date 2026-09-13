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

export const ImagePromptSchema = z.object({
  prompt: z.string(),
  negative_prompt: z.string(),
});
export type ImagePrompt = z.infer<typeof ImagePromptSchema>;

export async function runImagePrompter(
  run: RunContext,
  stageId: string,
  shot: Shot,
  continuity: ContinuityBible,
  previousShot: Shot | null,
  feedback: string | null,
  variation: VariationStrength | null = null,
): Promise<AgentResult<ImagePrompt>> {
  const per = continuity.per_shot.find((p) => p.shot_id === shot.id);
  const controls = controlsForRun(run);
  const creative = buildCreativeControlContext({
    creativeFreedom: controls.creative_freedom,
    goalFocus: controls.goal_focus,
    stage: "image",
    hardConstraints: [
      ...(per?.identity_blocks ?? []).map((b) => `Identity block (restate verbatim): ${b}`),
      ...(per?.must_match.attributes.length
        ? [`Must match the previous shot: ${per.must_match.attributes.join("; ")}`]
        : []),
      ...hardConstraintsFor(run.brand),
      "Identity-critical reference images are attached to the generation and define the product's look.",
    ],
    variation: variation ? { strength: variation, target: "keyframe" } : null,
  });
  const userMessage = `# Keyframe prompt for ${shot.id}
Style bible: ${continuity.style_bible}
Locks: light: ${continuity.locks.lighting}; palette: ${continuity.locks.palette}; grade: ${continuity.locks.color_grade}; camera: ${continuity.locks.camera_language}; realism: ${continuity.locks.realism}

## Shot
${shot.shot_size} shot, ${shot.angle} angle, ${shot.lens} lens, camera ${shot.movement}
Frame: ${shot.description}
Action frozen at its most telling instant: ${shot.action}
Light: ${shot.lighting}
Textures: ${shot.texture_keywords.join(", ") || "as the setting implies"}
Intent: ${shot.shot_intent}
${previousShot ? `Previous shot showed: ${previousShot.description}` : "This is the opening shot."}

## Identity blocks (restate verbatim)
${per?.identity_blocks.map((b) => `- ${b}`).join("\n") || "- none"}
Must match: ${per?.must_match.attributes.join("; ") || "nothing specific"}
${feedback ? `\n## Feedback from the previous attempt\n${feedback}\n` : ""}
${creative.text}

Return the prompt (60 to 120 words) and a short negative_prompt.`;

  return callAgent(run, {
    name: "image-prompter",
    tier: "fast",
    schema: ImagePromptSchema,
    userMessage,
    stageId,
    shotId: shot.id,
    labelSuffix: shot.id,
    validate: (p) => {
      const issues: string[] = [];
      const words = p.prompt.trim().split(/\s+/).length;
      if (words < 30) issues.push(`prompt is too short (${words} words)`);
      if (words > 200) issues.push(`prompt is too long (${words} words)`);
      if (
        /\b(text|caption|subtitle|logo|watermark)\b/i.test(p.prompt) &&
        !/\bno (text|logo|caption)/i.test(p.prompt)
      )
        issues.push("the prompt must not ask for text, captions or logos in the image");
      return issues;
    },
  });
}
