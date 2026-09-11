import type { BrandProfile } from "./schema.js";

/**
 * Brand Brain — deterministic compiler from a BrandProfile into role-specific context slices.
 * Each agent receives only the slice it needs, so the creative director is not distracted by
 * font names and the image prompter is not reading CTA policy.
 */

const list = (items: string[], fallback = "none"): string =>
  items.length ? items.map((i) => `- ${i}`).join("\n") : `- ${fallback}`;

const inline = (items: string[], fallback = "none"): string =>
  items.length ? items.join(", ") : fallback;

export function creativeContext(b: BrandProfile): string {
  const pillars = b.content_pillars
    .map(
      (p) =>
        `- ${p.id}: ${p.name} — ${p.description}${p.example_topics.length ? ` (e.g. ${p.example_topics.join("; ")})` : ""}`,
    )
    .join("\n");
  return `# Brand: ${b.name}${b.tagline ? ` — ${b.tagline}` : ""}

## Who we talk to
Primary audience: ${b.audience.primary}${b.audience.secondary ? `\nSecondary audience: ${b.audience.secondary}` : ""}
${b.audience.age_range ? `Age range: ${b.audience.age_range}\n` : ""}${b.audience.mindset ? `Mindset: ${b.audience.mindset}\n` : ""}Their pains:
${list(b.audience.pains)}
Their desires:
${list(b.audience.desires)}

## What we offer
${b.product.name} (${b.product.category}): ${b.product.description}
Key benefits:
${list(b.product.key_benefits)}
Claims we may make:
${list(b.product.allowed_claims, "only what is plainly true")}
Claims we must never make:
${list([...b.product.forbidden_claims, ...b.forbidden.claims])}

## How we sound
Voice: ${inline(b.tone.voice_adjectives)}
Writing style: ${b.tone.writing_style}
Humor: ${b.tone.humor}. Reading level: ${b.tone.reading_level}.
${b.tone.sample_lines.length ? `Lines that sound like us:\n${list(b.tone.sample_lines)}\n` : ""}Never say:
${list([...b.tone.avoid_phrases, ...b.forbidden.words])}

## What we want people to feel
Primary emotions: ${inline(b.emotions.primary)}
Secondary emotions: ${inline(b.emotions.secondary)}
Emotions to avoid: ${inline(b.emotions.avoid)}

## Content pillars
${pillars}

## Format policies
Target duration: ${b.pacing.duration_s.min}-${b.pacing.duration_s.max} s. Hold bias: ${b.pacing.hold_bias}. Typical shot count: ${b.pacing.shot_count_hint.min}-${b.pacing.shot_count_hint.max}.
Narration: ${b.voice.narration_policy}. Music: ${b.music.policy}.
On-screen text/captions policy: ${b.text_policy.captions}${b.text_policy.hook_style ? ` (hook style: ${b.text_policy.hook_style})` : ""}. Max words on screen at once: ${b.text_policy.max_words_on_screen}.
Call to action: ${b.cta.policy}${b.cta.patterns.length ? `; patterns we use: ${b.cta.patterns.join(" | ")}` : ""}${b.cta.handle ? `; handle: ${b.cta.handle}` : ""}.
Editing bias: ${b.edit_defaults.mode_bias} (allowed: ${b.edit_defaults.modes_allowed.join(", ")}); transitions allowed: ${b.edit_defaults.transitions_allowed.join(", ")}.
Forbidden visual styles: ${inline([...b.visual.forbidden_styles, ...b.forbidden.styles])}
Forbidden visuals: ${inline(b.forbidden.visuals)}`;
}

export function visualBible(b: BrandProfile): string {
  const c = b.visual.colors;
  const entities = b.entities.length
    ? b.entities
        .map(
          (e) =>
            `- ${e.id} (${e.kind}) ${e.name}: ${e.static_features}${e.dynamic_defaults ? ` Usually: ${e.dynamic_defaults}.` : ""}${e.reference_images.length ? ` [${e.reference_images.length} reference image(s)]` : ""}`,
        )
        .join("\n")
    : "- none defined";
  return `# Visual world of ${b.name}
${b.visual.style_summary}

Palette: primary ${c.primary}, secondary ${c.secondary}, accent ${c.accent}, background ${c.background}, text ${c.text}.
Lighting: ${b.visual.lighting || "natural, motivated light"}
Color grade: ${b.visual.color_grade || "true to life"}
Camera language: shot sizes ${inline(b.visual.camera_language.shot_sizes, "director's choice")}; movements ${inline(b.visual.camera_language.movements, "restrained")}; lenses ${inline(b.visual.camera_language.lenses, "35-85mm")}.
Framing rules:
${list(b.visual.camera_language.framing_rules)}
Realism rules:
${list(b.visual.realism_rules)}
Forbidden styles:
${list([...b.visual.forbidden_styles, ...b.forbidden.styles])}
Forbidden visuals:
${list(b.forbidden.visuals)}

## Entities (identity must stay consistent)
${entities}`;
}

export function editPolicy(b: BrandProfile): string {
  return `Edit modes allowed: ${b.edit_defaults.modes_allowed.join(", ")} (bias: ${b.edit_defaults.mode_bias}).
Transitions allowed: ${b.edit_defaults.transitions_allowed.join(", ")}. Effects allowed: ${inline(b.edit_defaults.effects_allowed)}.
Captions policy: ${b.text_policy.captions}. Max words on screen: ${b.text_policy.max_words_on_screen}.
Logo placement: ${b.edit_defaults.logo_placement}. End card: ${b.cta.end_card ? "yes" : "no"}.
Safe zone (avoid text): top ${b.text_policy.safe_zone.top_pct}%, bottom ${b.text_policy.safe_zone.bottom_pct}%, sides ${b.text_policy.safe_zone.side_pct}%.
Hold bias: ${b.pacing.hold_bias}; cuts per 10 s: ${b.pacing.cuts_per_10s.min}-${b.pacing.cuts_per_10s.max}.`;
}

export function voicePolicy(b: BrandProfile): string {
  return `Narration policy: ${b.voice.narration_policy}. Voice style: ${b.voice.style || "natural"}. Language: ${b.voice.language}. Speed: ${b.voice.speed}.`;
}

export interface BrandBrain {
  creative: string;
  visual: string;
  edit: string;
  voice: string;
}

export function compileBrandBrain(b: BrandProfile): BrandBrain {
  return {
    creative: creativeContext(b),
    visual: visualBible(b),
    edit: editPolicy(b),
    voice: voicePolicy(b),
  };
}
