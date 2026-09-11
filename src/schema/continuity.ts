import { z } from "zod";

export const ContinuityEntity = z.object({
  id: z.string(),
  kind: z.enum(["character", "product", "mascot", "location", "prop"]),
  name: z.string(),
  static_features: z
    .string()
    .describe("What never changes: face, build, colours, materials, proportions"),
  dynamic_features: z
    .string()
    .describe("What is true for this video: clothing, state, accessories, wear"),
  identity_block: z
    .string()
    .describe(
      "A verbatim sentence restated in every prompt where this entity appears, e.g. 'Wobble Bot, a palm-sized rounded robot toy in matte sky-blue plastic with a single round amber eye and stubby articulated arms'",
    ),
  reference_images: z.array(z.string()).describe("Paths to reference images, may be empty"),
});
export type ContinuityEntity = z.infer<typeof ContinuityEntity>;

export const ContinuityLocks = z.object({
  lighting: z.string(),
  palette: z.string(),
  color_grade: z.string(),
  camera_language: z.string(),
  realism: z.string().describe("Realism rules restated for the image and video prompts"),
  lens_set: z.array(z.string()),
});

export const PerShotContinuity = z.object({
  shot_id: z.string(),
  identity_blocks: z.array(z.string()).describe("Verbatim identity blocks for entities in frame"),
  reference_images: z.array(z.string()).describe("Up to 4 reference image paths for this shot"),
  must_match: z.object({
    previous_shot_id: z.string().nullable(),
    attributes: z.array(z.string()).describe("e.g. 'same kitchen', 'same overcast light'"),
  }),
  notes: z.string(),
});

export const ContinuityBibleSchema = z.object({
  entities: z.array(ContinuityEntity),
  locks: ContinuityLocks,
  style_bible: z
    .string()
    .describe(
      "One compact paragraph prepended (adapted, never verbatim-identical) to every image prompt",
    ),
  per_shot: z.array(PerShotContinuity),
});
export type ContinuityBible = z.infer<typeof ContinuityBibleSchema>;
