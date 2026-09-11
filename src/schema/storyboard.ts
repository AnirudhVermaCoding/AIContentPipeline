import { z } from "zod";
import {
  CameraAngle,
  CameraMovement,
  Importance,
  Lens,
  MotionNeed,
  NarrativeRole,
  ShotSize,
} from "./common.js";

export const ShotSchema = z.object({
  id: z.string().describe("shot_01, shot_02, ... in order"),
  narration_line_ids: z
    .array(z.string())
    .describe("Narration lines that play over this shot (empty for music-only or silent holds)"),
  duration_s: z.number().describe("Seconds this shot is on screen"),
  importance: Importance,
  motion_need: MotionNeed.describe(
    "essential = the story needs real motion here; subtle = a still with restrained movement is enough; none = a hold",
  ),
  narrative_role: NarrativeRole,
  shot_intent: z.string().describe("Why this shot exists. One sentence."),
  hero_moment: z.boolean().describe("The single visual peak of the video (exactly one shot)"),
  shot_size: ShotSize,
  angle: CameraAngle,
  movement: CameraMovement,
  lens: Lens,
  description: z
    .string()
    .describe(
      "What the frame shows. Concrete nouns, materials, light. No prompt-engineering jargon.",
    ),
  action: z.string().describe("What happens during the shot (subject and camera)"),
  entities_in_frame: z.array(z.string()).describe("Entity ids present in the frame"),
  location_id: z.string().describe("Stable id for the location so shots can share it"),
  lighting: z.string(),
  texture_keywords: z.array(z.string()),
  continuity_notes: z.string().describe("What must match the previous shot"),
  hold_ok: z.boolean().describe("True if it is fine to hold this frame longer than planned"),
  text_overlay: z
    .object({ text: z.string(), role: z.enum(["hook", "emphasis", "cta"]) })
    .nullable()
    .describe("Only when the brief's text intent allows it; otherwise null"),
});
export type Shot = z.infer<typeof ShotSchema>;

export const StoryboardSchema = z.object({
  shots: z.array(ShotSchema),
  total_duration_s: z.number(),
  sequence_notes: z.string().describe("How the shots flow; where the cuts land against narration"),
  visual_through_line: z.string().describe("The one visual idea that ties the shots together"),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

/** What the storyboard stage persists: the LLM storyboard conformed to measured voice timing. */
export const StoryboardArtifactSchema = StoryboardSchema.extend({
  shot_start_s: z.array(z.number()),
  voice_offset_s: z.number().describe("Where the narration track starts on the timeline"),
  conformed_to_voice: z.boolean(),
  risk: z.object({
    score: z.number(),
    verdict: z.enum(["strong", "acceptable", "revise", "fail"]),
    checks: z.array(
      z.object({ id: z.string(), status: z.enum(["pass", "warn", "fail"]), detail: z.string() }),
    ),
  }),
});
export type StoryboardArtifact = z.infer<typeof StoryboardArtifactSchema>;
