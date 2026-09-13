import type { LoadedBrand } from "../brand/loader.js";
import type { BrandProfile } from "../brand/schema.js";
import type { CreativeControls, VariationStrength } from "../schema/creative.js";
import type { RunManifest } from "../schema/manifest.js";

/**
 * Creative Freedom and Goal Focus: the two high-level dials an operator sets per run, and the one
 * place their meaning is written down. Every agent receives the same interpreted guidance block
 * from `buildCreativeControlContext` (stage-specific wording), always followed by the list of
 * rules that never loosen. Nothing here touches model sampling; the dials change what we ask for.
 */

export const DEFAULT_CREATIVE_CONTROLS: Readonly<CreativeControls> = Object.freeze({
  creative_freedom: 0.65,
  goal_focus: 0.85,
});

export interface ControlRange {
  /** Inclusive upper bound of the range (the lower bound is the previous range's max). */
  max: number;
  label: string;
  summary: string;
}

export const CREATIVE_FREEDOM_RANGES: readonly ControlRange[] = [
  {
    max: 0.2,
    label: "Safe",
    summary:
      "Proven ad structures, literal product demonstration, predictable hooks, straightforward camera work, conservative pacing.",
  },
  {
    max: 0.4,
    label: "Focused",
    summary:
      "Familiar structures with a clear point of view; simple compositions, little stylistic experiment.",
  },
  {
    max: 0.6,
    label: "Balanced",
    summary:
      "Stronger hooks and more cinematic framing where they help; some narrative experiment and tasteful metaphor.",
  },
  {
    max: 0.8,
    label: "Bold",
    summary:
      "Differentiated, cinematic, surprising ideas: unusual openings, original reveals and stronger emotional setups.",
  },
  {
    max: 1,
    label: "Wild",
    summary:
      "Unconventional storytelling, unexpected sequencing and strong visual metaphor; originality is the point.",
  },
];

export const GOAL_FOCUS_RANGES: readonly ControlRange[] = [
  {
    max: 0.2,
    label: "Explore",
    summary:
      "Atmosphere and brand-world exploration; abstract storytelling with little direct conversion pressure.",
  },
  {
    max: 0.4,
    label: "Loose",
    summary: "The goal is a compass, not a checklist; room for mood, texture and digression.",
  },
  {
    max: 0.6,
    label: "Balanced",
    summary: "Every beat relates to the goal, with room for atmosphere between the beats.",
  },
  {
    max: 0.8,
    label: "Focused",
    summary: "Most decisions serve the goal directly; product exposure is intentional.",
  },
  {
    max: 1,
    label: "Goal-first",
    summary:
      "Every shot has clear narrative utility toward the goal; anything attractive but irrelevant is cut.",
  },
];

export function rangeFor(ranges: readonly ControlRange[], value: number): ControlRange {
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const hit = ranges.find((r) => v <= r.max + 1e-9);
  const last = ranges[ranges.length - 1];
  if (!hit && !last) throw new Error("empty control range table");
  return (hit ?? last) as ControlRange;
}

export const creativeLabel = (v: number): string => rangeFor(CREATIVE_FREEDOM_RANGES, v).label;
export const goalLabel = (v: number): string => rangeFor(GOAL_FOCUS_RANGES, v).label;

export interface CreativePreset extends CreativeControls {
  id: string;
  name: string;
  description: string;
}

export const CREATIVE_PRESETS: readonly CreativePreset[] = [
  {
    id: "direct_ad",
    name: "Direct Ad",
    description: "Safe, literal and conversion-focused.",
    creative_freedom: 0.25,
    goal_focus: 0.95,
  },
  {
    id: "creative_ad",
    name: "Creative Ad",
    description: "An original way to sell.",
    creative_freedom: 0.7,
    goal_focus: 0.9,
  },
  {
    id: "brand_film",
    name: "Brand Film",
    description: "Cinematic and atmospheric, goal in the background.",
    creative_freedom: 0.8,
    goal_focus: 0.5,
  },
  {
    id: "experimental",
    name: "Experimental",
    description: "Brand world exploration with few conversion demands.",
    creative_freedom: 0.95,
    goal_focus: 0.25,
  },
];

export function presetFor(c: CreativeControls): CreativePreset | null {
  return (
    CREATIVE_PRESETS.find(
      (p) =>
        Math.abs(p.creative_freedom - c.creative_freedom) < 0.005 &&
        Math.abs(p.goal_focus - c.goal_focus) < 0.005,
    ) ?? null
  );
}

export type ControlSource = "run" | "brand" | "default";

export interface ResolvedCreativeControls extends CreativeControls {
  creative_label: string;
  goal_label: string;
  sources: { creative_freedom: ControlSource; goal_focus: ControlSource };
}

const inRange = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** Run option → brand default → fallback. Values outside 0–1 are ignored, never clamped. */
export function resolveCreativeControls(
  options:
    | {
        creative_freedom?: number | null;
        goal_focus?: number | null;
        /** Recorded by `createRun`: a stored value may itself have come from the brand. */
        creative_sources?: { creative_freedom: ControlSource; goal_focus: ControlSource };
      }
    | null
    | undefined,
  profile: Pick<BrandProfile, "creative_defaults"> | null | undefined,
): ResolvedCreativeControls {
  const pick = (
    run: number | null | undefined,
    brand: number | null | undefined,
    fallback: number,
  ): [number, ControlSource] =>
    inRange(run) ? [run, "run"] : inRange(brand) ? [brand, "brand"] : [fallback, "default"];
  const [cf, cfSource] = pick(
    options?.creative_freedom,
    profile?.creative_defaults?.creative_freedom,
    DEFAULT_CREATIVE_CONTROLS.creative_freedom,
  );
  const [gf, gfSource] = pick(
    options?.goal_focus,
    profile?.creative_defaults?.goal_focus,
    DEFAULT_CREATIVE_CONTROLS.goal_focus,
  );
  const stored = options?.creative_sources;
  return {
    creative_freedom: cf,
    goal_focus: gf,
    creative_label: creativeLabel(cf),
    goal_label: goalLabel(gf),
    sources: {
      creative_freedom: cfSource === "run" && stored ? stored.creative_freedom : cfSource,
      goal_focus: gfSource === "run" && stored ? stored.goal_focus : gfSource,
    },
  };
}

/** The controls a run actually generates with (the manifest carries them for every new run). */
export function controlsForRun(run: {
  manifest: RunManifest;
  brand: Pick<LoadedBrand, "profile">;
}): ResolvedCreativeControls {
  return resolveCreativeControls(run.manifest.options, run.brand.profile);
}

/**
 * Hash contribution for stages whose output the controls shape. Empty for runs created before
 * the controls existed, so their stage and shot hashes stay byte-identical.
 */
export function creativeHashInputs(manifest: RunManifest): { creative?: CreativeControls } {
  const o = manifest.options;
  if (!inRange(o.creative_freedom) || !inRange(o.goal_focus)) return {};
  return { creative: { creative_freedom: o.creative_freedom, goal_focus: o.goal_focus } };
}

export const fmt = (v: number): string => v.toFixed(2);

export function describeControls(c: CreativeControls): string {
  return `Creative Freedom ${creativeLabel(c.creative_freedom)} · ${fmt(c.creative_freedom)}, Goal Focus ${goalLabel(c.goal_focus)} · ${fmt(c.goal_focus)}`;
}

/** How many concept candidates the Creative Director drafts in its single structured call. */
export function conceptCandidateCount(creativeFreedom: number): number {
  if (creativeFreedom < 0.5) return 1;
  if (creativeFreedom <= 0.8) return 2;
  return 3;
}

// ---------------------------------------------------------------------------------------------
// Variation strength (regenerations)

export type VariationTarget = "concept" | "storyboard" | "shot" | "keyframe" | "clip";

export interface VariationOption {
  id: VariationStrength;
  label: string;
  description: string;
}

export const VARIATION_OPTIONS: readonly VariationOption[] = [
  {
    id: "small",
    label: "Small variation",
    description:
      "Keep the core concept, framing where possible, story role and product placement. Change only what you asked for.",
  },
  {
    id: "fresh",
    label: "Fresh direction",
    description:
      "Keep the primary goal, the product and the brand direction. Allow a new composition, wording, camera choice or micro-concept.",
  },
  {
    id: "different",
    label: "Completely different",
    description:
      "Keep only the hard constraints, product identity, primary goal and brand rules. Find a substantially different creative solution.",
  },
];

export function variationLabel(v: VariationStrength): string {
  return VARIATION_OPTIONS.find((o) => o.id === v)?.label ?? v;
}

const TARGET_NOUN: Record<VariationTarget, string> = {
  concept: "concept",
  storyboard: "storyboard",
  shot: "shot",
  keyframe: "keyframe",
  clip: "clip",
};

export function variationGuidance(strength: VariationStrength, target: VariationTarget): string {
  const noun = TARGET_NOUN[target];
  switch (strength) {
    case "small":
      return `Variation: SMALL. Preserve the previous ${noun}'s core idea, framing or structure where possible, its story role and the product's placement. Change only what the instruction asks for; everything else stays as close to the previous version as the instruction allows.`;
    case "fresh":
      return `Variation: FRESH DIRECTION. Preserve the primary goal, the product and the brand direction. You may choose a new composition, new wording, a new camera choice or a new micro-concept for this ${noun}, as long as it still does the same job in the film.`;
    case "different":
      return `Variation: COMPLETELY DIFFERENT. Preserve only the hard constraints, the product's identity, the primary goal and the brand rules. Offer a substantially different creative solution for this ${noun}; do not reuse the previous version's idea, staging or wording.`;
  }
}

// ---------------------------------------------------------------------------------------------
// Prompt context

export type CreativeStage =
  | "director"
  | "research"
  | "script"
  | "storyboard"
  | "image"
  | "video"
  | "edit";

export interface CreativeContextInput {
  creativeFreedom: number;
  goalFocus: number;
  stage: CreativeStage;
  /** Rules that never loosen, from `hardConstraintsFor` plus anything stage-specific. */
  hardConstraints: string[];
  /** The run's primary goal, restated so goal focus has something concrete to serve. */
  goal?: string | null;
  variation?: {
    strength: VariationStrength;
    target: VariationTarget;
    instruction?: string | null;
    /** Summary of the previous version, so "different" has something to be different from. */
    previous?: string | null;
  } | null;
}

export interface CreativeControlContext {
  creativeLabel: string;
  goalLabel: string;
  creativeGuidance: string;
  goalGuidance: string;
  immutableRules: string[];
  variationGuidance: string | null;
  /** The block to append to an agent's user message. */
  text: string;
}

type Band = "low" | "mid" | "high";
const band = (v: number): Band => (v <= 0.4 ? "low" : v <= 0.6 ? "mid" : "high");

const CREATIVE_GUIDANCE: Record<Exclude<CreativeStage, "research">, Record<Band, string>> = {
  director: {
    low: "Choose a proven content structure and a literal, clear product demonstration. Use a predictable, honest hook, a familiar narrative arc and a conservative emotional register. Keep visual metaphor minimal and concept risk low.",
    mid: "Allow a stronger hook, a richer emotional angle and some narrative experimentation; a tasteful visual metaphor is welcome when it clarifies the idea. Balance surprise with legibility.",
    high: "Explore differentiated, cinematic and surprising ideas: an unusual opening, an unexpected way into the story, an original product reveal, a bolder emotional setup, a less conventional social-ad structure. Prefer the idea that a competitor would not have made. The system prompt's preference for one plain idea told simply is a default, not a rule: a more inventive structure is welcome as long as the brief stays one coherent film inside the brand's duration range, pillars and policies.",
  },
  script: {
    low: "Hook phrasing plain and direct, a familiar storytelling structure, steady rhythm, no unexpected transitions. Emotional language restrained.",
    mid: "A sharper hook and more differentiated rhythm are welcome; allow one or two unexpected turns of phrase when they serve the story.",
    high: "Write a hook that surprises, use an unconventional structure or an unexpected transition where it earns its place, and let emotional language and rhythm be bolder. Never invent a claim, a feature or a fact that is not in the brand profile or the research.",
  },
  storyboard: {
    low: "Straightforward camera choices, classic compositions, a conventional shot sequence, low visual abstraction, conservative pacing. Show the product plainly.",
    mid: "More cinematic framing and interesting compositions where they help; some differentiation in pacing and sequencing; a tasteful visual metaphor is allowed.",
    high: "Use stronger cinematic language: unconventional shot sequencing, surprising visual metaphor, considered POV choices, negative space, an original reveal structure and staging. Vary sizes, angles and movement freely within the brand's shot-count range; the artist's usual defaults (steady sizes, plain sequencing) are starting points, not limits. Keep exactly one hero moment and obey the narration timing.",
  },
  image: {
    low: "Conventional, clean composition; natural environment detail; straightforward lighting; a standard lens and eye-level perspective; literal staging.",
    mid: "More cinematic composition, considered lighting direction and quality, a chosen lens feel and perspective; staging with some visual interest.",
    high: "Adventurous composition, atmospheric environment details, expressive but motivated lighting, a distinct lens and camera feel, an unusual perspective and strong cinematic staging and treatment.",
  },
  video: {
    low: "One simple motion concept, locked-off or a gentle push in, a plain reveal, steady pacing.",
    mid: "A motion concept with a little more character, a considered camera move, a reveal with rhythm.",
    high: "An expressive motion concept, a bolder but believable camera move, an original reveal and pacing with intent; still one action and one camera behaviour, slow and physical.",
  },
  edit: {
    low: "Simpler cuts, minimal movement on stills, stable pacing.",
    mid: "Measured pacing with a little more rhythm; restrained still motion.",
    high: "More expressive pacing and stronger rhythm where the assets allow; motivated choices only, never generic effects or chaotic transitions.",
  },
};

const GOAL_GUIDANCE: Record<Exclude<CreativeStage, "research">, Record<Band, string>> = {
  director: {
    low: "The goal is a compass, not a checklist: atmosphere, brand-world exploration and abstract storytelling are welcome even where they do not push the goal directly.",
    mid: "Rank concepts by how well they serve the goal, but leave room for mood and texture around the beats that carry it.",
    high: "Rank concepts first by goal alignment. Make the message unmistakable, set up the call to action coherently, make product exposure intentional, and drop any idea that is attractive but does not serve the goal.",
  },
  script: {
    low: "Clarity and persuasion matter less than mood; let lines breathe and digress.",
    mid: "Keep the goal in view: clear key message, product relevance, a coherent close.",
    high: "Prioritise clarity and persuasion: every line serves the goal, the product is present for a reason, information density is high without haste, and the close sets up the call to action.",
  },
  storyboard: {
    low: "Shots may exist for atmosphere alone; brand-world exploration is welcome.",
    mid: "Most shots should have narrative utility toward the goal; a purely atmospheric shot is fine when it earns its place.",
    high: "Every shot must have clear narrative utility toward the goal. Product exposure is intentional and legible, the sequence prepares the call to action, and a shot that is beautiful but does not help the objective is cut before it is drawn.",
  },
  image: {
    low: "Mood and world can lead the frame; the product need not dominate.",
    mid: "The product should read clearly while the frame keeps its atmosphere.",
    high: "The product and the moment that serves the goal are the subject; everything else in the frame supports them.",
  },
  video: {
    low: "Motion may be atmospheric.",
    mid: "Motion should point at what matters for the story.",
    high: "Motion foregrounds the product and the beat that serves the goal.",
  },
  edit: {
    low: "Overlays and pacing may favour mood.",
    mid: "Keep the message clear.",
    high: "Prefer overlays and pacing that sharpen the message and the call to action.",
  },
};

const EXTREME_CREATIVE = {
  safe: "This is the safest setting: when in doubt, choose the conventional option.",
  wild: "This is the wildest setting: originality is the point, but every locked rule below still holds exactly.",
};

const EXTREME_GOAL = {
  explore: "This is the most exploratory setting: the film may be a brand film first.",
  first: "This is the most goal-first setting: persuasion and clarity beat atmosphere every time.",
};

/**
 * Build the guidance block every agent appends to its user message. Stage mappings differ in
 * wording; the locked list is always present and is what makes creative freedom safe.
 */
export function buildCreativeControlContext(input: CreativeContextInput): CreativeControlContext {
  const cf = input.creativeFreedom;
  const gf = input.goalFocus;
  const cLabel = creativeLabel(cf);
  const gLabel = goalLabel(gf);
  const immutableRules = [...input.hardConstraints];
  if (input.stage === "research") {
    const text = [
      "## Creative controls",
      "Creative freedom does not apply to research: factual standards, sourcing and confidence are unchanged at every setting.",
      `Goal Focus: ${fmt(gf)} — ${gLabel}. ${gf > 0.6 ? "Prioritise facts that serve the stated goal." : "Cover the brief's questions evenly."}`,
    ].join("\n");
    return {
      creativeLabel: cLabel,
      goalLabel: gLabel,
      creativeGuidance: "",
      goalGuidance: "",
      immutableRules,
      variationGuidance: null,
      text,
    };
  }
  const cBand = band(cf);
  const gBand = band(gf);
  let creativeGuidance = CREATIVE_GUIDANCE[input.stage][cBand];
  if (cf <= 0.2) creativeGuidance += ` ${EXTREME_CREATIVE.safe}`;
  if (cf > 0.8) creativeGuidance += ` ${EXTREME_CREATIVE.wild}`;
  let goalGuidance = GOAL_GUIDANCE[input.stage][gBand];
  if (gf <= 0.2) goalGuidance += ` ${EXTREME_GOAL.explore}`;
  if (gf > 0.8) goalGuidance += ` ${EXTREME_GOAL.first}`;
  const variation = input.variation
    ? `${variationGuidance(input.variation.strength, input.variation.target)}${
        input.variation.instruction ? `\nInstruction: ${input.variation.instruction}` : ""
      }${input.variation.previous ? `\nPrevious version: ${input.variation.previous}` : ""}`
    : null;

  const lines: string[] = ["## Creative controls"];
  lines.push(`Creative Freedom: ${fmt(cf)} — ${cLabel}. ${creativeGuidance}`);
  lines.push(`Goal Focus: ${fmt(gf)} — ${gLabel}. ${goalGuidance}`);
  if (input.goal) lines.push(`Primary goal: ${input.goal}`);
  lines.push(
    "Creative freedom and goal focus are independent: a high value on both means find a highly original way to accomplish the goal.",
  );
  if (variation) lines.push("", "## Regeneration", variation);
  if (input.stage === "image") {
    lines.push(
      "",
      "## CREATIVE VARIABLES (adapt these with the creative freedom above)",
      "composition, environment and setting details, lighting quality and direction, lens and camera feel, perspective, visual staging, cinematic treatment.",
      "",
      "## LOCKED IDENTITY VARIABLES (never change, whatever the creative freedom)",
      ...immutableRules.map((r) => `- ${r}`),
    );
  } else if (input.stage === "video") {
    lines.push(
      "",
      "## MAY CHANGE with creative freedom",
      "motion concept, camera motion, the reveal, pacing and staging within the clip.",
      "",
      "## LOCKED (never change)",
      ...immutableRules.map((r) => `- ${r}`),
    );
  } else {
    lines.push(
      "",
      "## Locked (never loosened by creative freedom)",
      ...immutableRules.map((r) => `- ${r}`),
    );
  }
  return {
    creativeLabel: cLabel,
    goalLabel: gLabel,
    creativeGuidance,
    goalGuidance,
    immutableRules,
    variationGuidance: variation,
    text: lines.join("\n"),
  };
}

/**
 * The rules that stay locked at every creative setting, read from the brand (and product) that
 * the run pinned. Stages append their own (continuity blocks, identity references).
 */
export function hardConstraintsFor(
  brand: Pick<LoadedBrand, "profile" | "product">,
  opts: { hardCapUsd?: number | null; durationRange?: { min: number; max: number } } = {},
): string[] {
  const p = brand.profile;
  const product = brand.product?.profile ?? null;
  const rules: string[] = [];
  rules.push(
    `Product identity: ${p.product.name} (${p.product.category}) is exactly as described: ${product?.static_features || p.product.description}. Its shape, geometry, proportions, components, materials and identity-critical colours never change and no functionality is invented.`,
  );
  if (product?.must_preserve.length)
    rules.push(`Must preserve on the product: ${product.must_preserve.join("; ")}.`);
  const identityRefs = brand.product?.references.filter((r) => r.identity_critical) ?? [];
  if (identityRefs.length)
    rules.push(
      `Reference images define the product's identity (${identityRefs.length} identity-critical); generated frames must match them.`,
    );
  const allowed = [...p.product.allowed_claims, ...(product?.allowed_claims ?? [])];
  const forbidden = [
    ...p.product.forbidden_claims,
    ...p.forbidden.claims,
    ...(product?.forbidden_claims ?? []),
  ];
  rules.push(
    `Factual claims: only claims from the brand profile may be made${allowed.length ? ` (${allowed.join("; ")})` : ""}; nothing unsupported is invented.${forbidden.length ? ` Forbidden claims: ${forbidden.join("; ")}.` : ""}`,
  );
  if (p.forbidden.styles.length)
    rules.push(`Forbidden visual styles: ${p.forbidden.styles.join("; ")}.`);
  if (p.forbidden.visuals.length)
    rules.push(`Forbidden visuals: ${p.forbidden.visuals.join("; ")}.`);
  if (p.forbidden.words.length || p.tone.avoid_phrases.length)
    rules.push(`Never say: ${[...p.forbidden.words, ...p.tone.avoid_phrases].join("; ")}.`);
  if (p.emotions.avoid.length)
    rules.push(`Emotions the brand avoids: ${p.emotions.avoid.join(", ")}.`);
  rules.push(
    `Text and CTA policy: captions ${p.text_policy.captions}, call to action ${p.cta.policy}${p.cta.policy !== "never" && p.cta.patterns[0] ? ` (pattern: "${p.cta.patterns[0]}")` : ""}; brand safety and legal rules apply as written.`,
  );
  rules.push(
    "Continuity: identity blocks are restated verbatim and every entity stays consistent across shots.",
  );
  const range = opts.durationRange ?? p.pacing.duration_s;
  rules.push(
    `Output format: vertical 720×1280, ${range.min}–${range.max} s, delivered by the same pipeline; creativity never changes the format.`,
  );
  if (opts.hardCapUsd != null)
    rules.push(
      `Budget: the absolute cap for this video is $${opts.hardCapUsd.toFixed(2)}; creativity never buys more generation, the router and the budget ledger decide what is produced.`,
    );
  return rules;
}
