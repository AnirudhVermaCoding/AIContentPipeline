import { z } from "zod";

/**
 * Per-run creative controls. Both are 0–1 and deliberately not model temperature: they steer
 * prompting, candidate generation, storyboard freedom, image/video direction and edit decisions
 * while every hard constraint (product identity, claims, brand rules, budget, continuity, QC)
 * stays locked.
 */
export const CreativeControlsSchema = z.object({
  /** How unconventional and exploratory creative decisions may be (Safe → Wild). */
  creative_freedom: z.number().min(0).max(1),
  /** How strongly every decision must serve the run's primary goal (Explore → Goal-first). */
  goal_focus: z.number().min(0).max(1),
});
export type CreativeControls = z.infer<typeof CreativeControlsSchema>;

/** Partial form accepted at API boundaries (each field optional, but never out of range). */
export const CreativeControlsInputSchema = CreativeControlsSchema.partial().strict();
export type CreativeControlsInput = z.infer<typeof CreativeControlsInputSchema>;

/**
 * How different a regenerated version should be. Separate from creative freedom: this is about
 * distance from the previous version, not about how adventurous the whole film is.
 */
export const VariationStrength = z.enum(["small", "fresh", "different"]);
export type VariationStrength = z.infer<typeof VariationStrength>;

export const RegenerationTarget = z.enum(["concept", "storyboard", "storyboard_shot"]);
export type RegenerationTarget = z.infer<typeof RegenerationTarget>;

/**
 * A planning-stage regeneration the operator asked for. The studio writes it on the manifest and
 * resets the stage; the stage consumes it (variation + instruction) and clears it. It is never part
 * of a stage hash: `resetFrom` already forces the re-run.
 */
export const PendingRegenerationSchema = z.object({
  target: RegenerationTarget,
  shot_id: z.string().nullable(),
  variation: VariationStrength,
  instruction: z.string().nullable(),
  requested_at: z.string(),
  actor: z.string().nullable(),
});
export type PendingRegeneration = z.infer<typeof PendingRegenerationSchema>;

/** What a planning artifact records about the regeneration that produced it. */
export const RegenerationRecordSchema = z.object({
  target: RegenerationTarget,
  shot_id: z.string().nullable(),
  variation: VariationStrength,
  instruction: z.string().nullable(),
  at: z.string(),
});
export type RegenerationRecord = z.infer<typeof RegenerationRecordSchema>;
