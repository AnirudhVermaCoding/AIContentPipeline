import { z } from "zod";
import { EditMode } from "../schema/common.js";

/**
 * BrandProfile — everything that makes one brand's videos different from another's.
 * Loaded from brands/<id>/brand.yaml. Defaults here are deliberate: a brand file only needs to
 * state what is distinctive about the brand.
 */

const Range = z.object({ min: z.number(), max: z.number() });

export const BrandEntity = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  kind: z.enum(["character", "product", "mascot", "location", "prop"]),
  name: z.string(),
  static_features: z.string().describe("What never changes about this entity"),
  dynamic_defaults: z
    .string()
    .default("")
    .describe("Typical state/clothing unless the brief changes it"),
  reference_images: z.array(z.string()).default([]).describe("Paths relative to the brand folder"),
  /** Subset of reference_images that must be present whenever the entity is generated. */
  identity_refs: z.array(z.string()).default([]),
  always_present: z.boolean().default(false),
});
export type BrandEntity = z.infer<typeof BrandEntity>;

export const ProviderChoice = z.object({
  provider: z.string(),
  model: z.string(),
  options: z.record(z.string(), z.unknown()).default({}),
});
export type ProviderChoice = z.infer<typeof ProviderChoice>;

export const BrandProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  tagline: z.string().default(""),
  audience: z.object({
    primary: z.string(),
    secondary: z.string().default(""),
    age_range: z.string().default(""),
    mindset: z.string().default(""),
    pains: z.array(z.string()).default([]),
    desires: z.array(z.string()).default([]),
  }),
  product: z.object({
    name: z.string(),
    category: z.string(),
    description: z.string(),
    key_benefits: z.array(z.string()).default([]),
    allowed_claims: z.array(z.string()).default([]),
    forbidden_claims: z.array(z.string()).default([]),
  }),
  tone: z.object({
    voice_adjectives: z.array(z.string()).min(1),
    writing_style: z.string(),
    humor: z.enum(["none", "light", "playful", "dry"]).default("light"),
    reading_level: z.string().default("simple and conversational"),
    sample_lines: z.array(z.string()).default([]),
    avoid_phrases: z.array(z.string()).default([]),
  }),
  emotions: z.object({
    primary: z.array(z.string()).min(1),
    secondary: z.array(z.string()).default([]),
    avoid: z.array(z.string()).default([]),
  }),
  content_pillars: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        example_topics: z.array(z.string()).default([]),
      }),
    )
    .min(1),
  visual: z.object({
    style_summary: z.string().describe("One paragraph describing the brand's visual world"),
    colors: z.object({
      primary: z.string(),
      secondary: z.string(),
      accent: z.string(),
      background: z.string(),
      text: z.string(),
    }),
    fonts: z.object({
      heading: z.string(),
      body: z.string(),
      source: z.enum(["google", "system"]).default("google"),
    }),
    logos: z.array(z.object({ path: z.string(), usage: z.string().default("") })).default([]),
    references: z
      .array(
        z.object({
          path: z.string(),
          note: z.string().default(""),
          tags: z.array(z.string()).default([]),
        }),
      )
      .default([]),
    camera_language: z.object({
      shot_sizes: z.array(z.string()).default([]),
      movements: z.array(z.string()).default([]),
      lenses: z.array(z.string()).default([]),
      framing_rules: z.array(z.string()).default([]),
    }),
    realism_rules: z.array(z.string()).default([]),
    lighting: z.string().default(""),
    color_grade: z.string().default(""),
    forbidden_styles: z.array(z.string()).default([]),
  }),
  pacing: z.object({
    duration_s: Range.default({ min: 28, max: 40 }),
    hold_bias: z.enum(["long", "balanced", "snappy"]).default("balanced"),
    cuts_per_10s: Range.default({ min: 1, max: 3 }),
    shot_count_hint: Range.default({ min: 5, max: 9 }),
  }),
  voice: z.object({
    provider: z.string().default("cartesia"),
    model: z.string().nullable().default(null),
    voice_id: z.string(),
    style: z.string().default(""),
    speed: z.number().default(1),
    language: z.string().default("en"),
    narration_policy: z.enum(["always", "optional", "never"]).default("always"),
    line_gap_s: z.number().default(0.35),
  }),
  music: z.object({
    policy: z.enum(["never", "optional", "always"]).default("optional"),
    mood_tags: z.array(z.string()).default([]),
    energy: z.enum(["low", "medium", "high"]).default("medium"),
    gain_db: z.number().default(-18),
  }),
  text_policy: z.object({
    captions: z.enum(["never", "brand_hook_only", "when_needed", "always"]).default("never"),
    hook_style: z.string().default(""),
    max_words_on_screen: z.number().int().default(6),
    safe_zone: z
      .object({ top_pct: z.number(), bottom_pct: z.number(), side_pct: z.number() })
      .default({ top_pct: 12, bottom_pct: 20, side_pct: 8 }),
  }),
  cta: z.object({
    policy: z.enum(["never", "soft", "always"]).default("soft"),
    patterns: z.array(z.string()).default([]),
    end_card: z.boolean().default(false),
    handle: z.string().default(""),
  }),
  entities: z.array(BrandEntity).default([]),
  /**
   * Default creative controls for this brand's runs (0–1). Optional and without defaults on
   * purpose: adding a default would change every brand's config version. Runs resolve
   * request → these → 0.65 / 0.85 and store the result themselves.
   */
  creative_defaults: z
    .object({
      creative_freedom: z.number().min(0).max(1).optional(),
      goal_focus: z.number().min(0).max(1).optional(),
    })
    .optional(),
  edit_defaults: z.object({
    mode_bias: EditMode.default("ASSEMBLY"),
    modes_allowed: z.array(EditMode).default(["NONE", "FINISH_ONLY", "LIGHT", "ASSEMBLY"]),
    transitions_allowed: z.array(z.enum(["cut", "dissolve"])).default(["cut"]),
    effects_allowed: z.array(z.string()).default([]),
    logo_placement: z.enum(["none", "end_card", "corner"]).default("none"),
    still_motion_amount: z.number().min(0).max(1).default(0.35),
  }),
  budget: z.object({
    target_usd: z.number().default(1.8),
    hard_cap_usd: z.number().default(2.5),
    ai_video_seconds_target: z.number().default(15),
    keyframe_attempts: z.number().int().default(3),
    clip_seconds: z.object({ min: z.number(), max: z.number() }).default({ min: 5, max: 10 }),
    /**
     * Studio wallet defaults, seeded into the budget ledger the first time the studio sees the
     * brand (edit them afterwards under Budget & Usage). Amounts are in `currency`.
     */
    wallet: z
      .object({
        currency: z.string().default("INR"),
        amount: z.number().nullable().default(null),
        daily: z.number().nullable().default(null),
        two_day: z.number().nullable().default(null),
        timezone: z.string().default("UTC"),
      })
      .optional(),
  }),
  providers: z
    .object({
      llm_creative: ProviderChoice.optional(),
      llm_fast: ProviderChoice.optional(),
      image: ProviderChoice.optional(),
      video: ProviderChoice.optional(),
      tts: ProviderChoice.optional(),
    })
    .default({}),
  forbidden: z.object({
    styles: z.array(z.string()).default([]),
    claims: z.array(z.string()).default([]),
    words: z.array(z.string()).default([]),
    visuals: z.array(z.string()).default([]),
  }),
});
export type BrandProfile = z.infer<typeof BrandProfileSchema>;
