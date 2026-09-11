import { z } from "zod";
import { EditMode, MotionPromiseKind, ResearchDepth, TextOverlayIntent } from "./common.js";

/**
 * CreativeBrief — output of the Creative Director. This is an LLM-facing schema: no optional
 * fields and no defaults (strict structured outputs require every property to be present), so
 * absent values are explicit nulls.
 */
export const EmotionalBeat = z.object({
  beat: z.string().describe("Short name of the beat, e.g. 'quiet curiosity'"),
  emotion: z.string().describe("The emotion the viewer should feel during this beat"),
  purpose: z.string().describe("What this beat does for the story"),
});

export const MotionPromise = z.object({
  kind: MotionPromiseKind,
  min_ai_video_s: z
    .number()
    .describe("Minimum seconds of real generated motion the story needs (0 if none)"),
  min_motion_ratio: z
    .number()
    .describe("Minimum share of runtime that must be real motion (0-1); 0 if stills are fine"),
  still_fallback_allowed: z
    .boolean()
    .describe("May a hero shot fall back to an animated still without breaking the story?"),
  reason: z.string(),
});

export const CreativeBriefSchema = z.object({
  concept: z.string().describe("One paragraph: the idea for this specific video"),
  hook: z.object({
    line: z.string().describe("The opening line or visual moment in the first 2 seconds"),
    type: z.string().describe("Hook device used, in your own words"),
    why: z.string(),
  }),
  emotional_arc: z.array(EmotionalBeat).describe("3-5 beats from open to close"),
  pillar_id: z.string().describe("Content pillar id from the brand profile"),
  audience_insight: z.string().describe("The specific human truth this video speaks to"),
  narrative_device: z
    .string()
    .describe("e.g. single continuous moment, before/after, one question"),
  key_message: z.string().describe("The one thing the viewer should take away"),
  target_duration_s: z.number(),
  research_depth: ResearchDepth,
  research_questions: z.array(z.string()),
  text_overlay_intent: TextOverlayIntent,
  cta_decision: z.object({
    use: z.boolean(),
    text: z.string().nullable(),
    style: z.string().nullable().describe("spoken | end_card | on_screen | null"),
  }),
  edit_mode_intent: EditMode,
  motion_promise: MotionPromise,
  visual_world: z.object({
    setting: z.string(),
    time_of_day: z.string(),
    lighting: z.string(),
    palette_note: z.string(),
    texture_note: z.string(),
  }),
  entities_needed: z.array(
    z.object({
      id: z.string().describe("Brand entity id, or a new snake_case id"),
      role: z.string(),
      is_new: z.boolean(),
      description: z.string().nullable().describe("Required for new entities"),
    }),
  ),
  avoid: z.array(z.string()).describe("Specific things this video must not do"),
  why_it_works: z.string(),
});
export type CreativeBrief = z.infer<typeof CreativeBriefSchema>;
