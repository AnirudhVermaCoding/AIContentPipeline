import {
  buildCreativeControlContext,
  controlsForRun,
  hardConstraintsFor,
} from "../creative/controls.js";
import type { RunContext } from "../pipeline/run.js";
import { assessStoryboardRisk } from "../qc/storyboard-risk.js";
import type { CreativeBrief } from "../schema/brief.js";
import { CameraAngle, CameraMovement, Lens, ShotSize } from "../schema/common.js";
import type { VariationStrength } from "../schema/creative.js";
import type { Script } from "../schema/script.js";
import { type Shot, ShotSchema, type Storyboard, StoryboardSchema } from "../schema/storyboard.js";
import type { VoiceResult } from "../schema/voice.js";
import { type AgentResult, callAgent } from "./base.js";

export function knownEntityIds(run: RunContext, brief: CreativeBrief): Set<string> {
  const ids = new Set(run.brand.profile.entities.map((e) => e.id));
  for (const e of brief.entities_needed) ids.add(e.id);
  return ids;
}

export interface StoryboardArtistOptions {
  /** Set when the operator asked for a new storyboard: how far from the previous one to go. */
  variation?: {
    strength: VariationStrength;
    instruction: string | null;
    previous: string | null;
  } | null;
}

/** One line per shot, for "be different from this" prompts and provenance. */
export function summarizeStoryboard(sb: Pick<Storyboard, "shots">): string {
  return sb.shots
    .map(
      (s) =>
        `${s.id} (${s.shot_size}, ${s.angle}, ${s.movement}${s.hero_moment ? ", hero" : ""}): ${s.description}`,
    )
    .join("\n");
}

function vocabulary(run: RunContext, entityIds: string[]): string {
  return `shot_size: ${ShotSize.options.join(", ")}
angle: ${CameraAngle.options.join(", ")}
movement: ${CameraMovement.options.join(", ")}
lens: ${Lens.options.join(", ")}
entity ids: ${entityIds.join(", ") || "none"}
Silent shots (no narration lines) are only allowed as the opening or closing shot.${run.providers.video.maxSeconds ? "" : ""}`;
}

export async function runStoryboardArtist(
  run: RunContext,
  stageId: string,
  brief: CreativeBrief,
  script: Script,
  voice: VoiceResult,
  opts: StoryboardArtistOptions = {},
): Promise<AgentResult<Storyboard>> {
  const b = run.brand.profile;
  const clipMax = run.providers.video.maxSeconds;
  const lines = voice.music_only
    ? "(music only: no narration lines)"
    : voice.lines
        .map((l) => `${l.line_id} [${l.start_s.toFixed(2)}–${l.end_s.toFixed(2)} s]: ${l.text}`)
        .join("\n");
  const entityIds = [...knownEntityIds(run, brief)];
  const newEntities = brief.entities_needed
    .filter((e) => e.is_new)
    .map((e) => `- ${e.id}: ${e.description}`)
    .join("\n");
  const controls = controlsForRun(run);
  const creative = buildCreativeControlContext({
    creativeFreedom: controls.creative_freedom,
    goalFocus: controls.goal_focus,
    stage: "storyboard",
    goal: run.manifest.goal,
    hardConstraints: [
      ...hardConstraintsFor(run.brand),
      `Structure: between 3 and 14 shots (this brand usually ${b.pacing.shot_count_hint.min}-${b.pacing.shot_count_hint.max}), exactly one hero_moment, every narration line in exactly one shot in script order, essential-motion shots at or under ${clipMax} s.`,
    ],
    variation: opts.variation ? { ...opts.variation, target: "storyboard" } : null,
  });
  const userMessage = `# Storyboard assignment
${run.brain.visual}
${newEntities ? `\n## New entities for this video\n${newEntities}\n` : ""}
## Creative brief
Concept: ${brief.concept}
Hook: ${brief.hook.line}
Narrative device: ${brief.narrative_device}
Emotional arc: ${brief.emotional_arc.map((e) => `${e.beat} (${e.emotion}): ${e.purpose}`).join("; ")}
Visual world: ${brief.visual_world.setting}; ${brief.visual_world.time_of_day}; ${brief.visual_world.lighting}; ${brief.visual_world.palette_note}; ${brief.visual_world.texture_note}
Motion promise: ${brief.motion_promise.kind}, at least ${brief.motion_promise.min_ai_video_s} s of real motion. ${brief.motion_promise.reason}
Text on screen: ${brief.text_overlay_intent}${brief.text_overlay_intent === "none" ? " (text_overlay must be null on every shot)" : ""}
Edit intent: ${brief.edit_mode_intent}
Target duration: ${brief.target_duration_s} s. Narration total: ${voice.duration_s.toFixed(1)} s.

## Narration with measured timing (each line belongs to exactly one shot)
${lines}
On-screen text candidates from the writer (use at most one, only if text is allowed): ${script.on_screen_text_candidates.map((c) => `"${c.text}" (${c.role})`).join("; ") || "none"}

## Vocabulary
${vocabulary(run, entityIds)}
Shot count for this brand: usually ${b.pacing.shot_count_hint.min}-${b.pacing.shot_count_hint.max}. Hold bias: ${b.pacing.hold_bias}.
Shots with motion_need "essential" become generated clips of at most ${clipMax} s, so keep them at or under ${clipMax} s.

${creative.text}

Return the Storyboard.`;

  const textAllowed = brief.text_overlay_intent !== "none";
  const lineIds = voice.lines.map((l) => l.line_id);
  const context: StoryboardValidationContext = {
    clipMax,
    entityIds,
    lineIds,
    textAllowed,
    maxWordsOnScreen: b.text_policy.max_words_on_screen,
    shotRange: b.pacing.shot_count_hint,
  };
  return callAgent(run, {
    name: "storyboard-artist",
    tier: "creative",
    schema: StoryboardSchema,
    userMessage,
    stageId,
    expectedOutputTokens: 3500,
    validate: (sb) => validateStoryboard(sb, context),
  });
}

export interface ShotRewriteParams {
  brief: CreativeBrief;
  /** The current storyboard (artifact or plain), whose other shots are locked. */
  storyboard: Pick<Storyboard, "shots" | "visual_through_line" | "sequence_notes">;
  shot: Shot;
  voice: VoiceResult;
  variation: VariationStrength;
  instruction: string | null;
}

/**
 * Rewrite exactly one shot with its own small prompt. The stage forces the locked fields back
 * onto the result (id, narration lines, role, hero flag, entities, conformed duration), so the
 * continuity merge keeps every other shot's hash and only this shot is produced again.
 */
export async function rewriteStoryboardShot(
  run: RunContext,
  stageId: string,
  p: ShotRewriteParams,
): Promise<AgentResult<Shot>> {
  const b = run.brand.profile;
  const clipMax = run.providers.video.maxSeconds;
  const entityIds = [...knownEntityIds(run, p.brief)];
  const controls = controlsForRun(run);
  const creative = buildCreativeControlContext({
    creativeFreedom: controls.creative_freedom,
    goalFocus: controls.goal_focus,
    stage: "storyboard",
    goal: run.manifest.goal,
    hardConstraints: [
      ...hardConstraintsFor(run.brand),
      `Locked on this shot: id ${p.shot.id}, narration lines ${p.shot.narration_line_ids.join(", ") || "none"}, narrative role ${p.shot.narrative_role}, hero_moment ${p.shot.hero_moment}, entities ${p.shot.entities_in_frame.join(", ") || "none"}, duration ${p.shot.duration_s} s.`,
    ],
    variation: {
      strength: p.variation,
      target: "shot",
      instruction: p.instruction,
      previous: `${p.shot.shot_size}, ${p.shot.angle}, ${p.shot.movement}, ${p.shot.lens}: ${p.shot.description} / ${p.shot.action}`,
    },
  });
  const lineById = new Map(p.voice.lines.map((l) => [l.line_id, l]));
  const narration = p.shot.narration_line_ids
    .map((id) => lineById.get(id))
    .filter((l): l is NonNullable<typeof l> => !!l)
    .map((l) => `${l.line_id} [${l.start_s.toFixed(2)}–${l.end_s.toFixed(2)} s]: ${l.text}`)
    .join("\n");
  const others = p.storyboard.shots
    .map((s) =>
      s.id === p.shot.id
        ? `${s.id}: << the shot to rewrite >>`
        : `${s.id} (${s.shot_size}, ${s.angle}, ${s.movement}): ${s.description}`,
    )
    .join("\n");
  const userMessage = `# Rewrite one shot: ${p.shot.id}
${run.brain.visual}

## Creative brief (locked)
Concept: ${p.brief.concept}
Hook: ${p.brief.hook.line}
Emotional arc: ${p.brief.emotional_arc.map((e) => `${e.beat} (${e.emotion}): ${e.purpose}`).join("; ")}
Visual world: ${p.brief.visual_world.setting}; ${p.brief.visual_world.time_of_day}; ${p.brief.visual_world.lighting}; ${p.brief.visual_world.palette_note}; ${p.brief.visual_world.texture_note}
Text on screen: ${p.brief.text_overlay_intent}${p.brief.text_overlay_intent === "none" ? " (text_overlay must be null)" : ""}

## The storyboard (every other shot is locked)
Visual through-line: ${p.storyboard.visual_through_line}
${others}

## The shot to rewrite (current version)
${JSON.stringify(p.shot, null, 2)}
Narration it carries:
${narration || "(silent shot)"}
Its description must differ from every other shot's description above.

## Vocabulary
${vocabulary(run, entityIds)}
Shots with motion_need "essential" become generated clips of at most ${clipMax} s, so keep them at or under ${clipMax} s.

${creative.text}

Return the Shot.`;
  const otherDescriptions = new Set(
    p.storyboard.shots
      .filter((s) => s.id !== p.shot.id)
      .map((s) => s.description.trim().toLowerCase()),
  );
  const textAllowed = p.brief.text_overlay_intent !== "none";
  return callAgent(run, {
    name: "storyboard-shot-rewrite",
    tier: "creative",
    schema: ShotSchema,
    userMessage,
    stageId,
    shotId: p.shot.id,
    labelSuffix: p.shot.id,
    expectedOutputTokens: 900,
    validate: (s) => {
      const issues: string[] = [];
      if (s.id !== p.shot.id) issues.push(`id must stay ${p.shot.id}`);
      if (
        s.narration_line_ids.length !== p.shot.narration_line_ids.length ||
        s.narration_line_ids.some((id, i) => id !== p.shot.narration_line_ids[i])
      )
        issues.push(`narration_line_ids must stay ${JSON.stringify(p.shot.narration_line_ids)}`);
      if (s.hero_moment !== p.shot.hero_moment)
        issues.push(`hero_moment must stay ${p.shot.hero_moment}`);
      for (const id of s.entities_in_frame)
        if (!entityIds.includes(id)) issues.push(`unknown entity "${id}"`);
      if (s.duration_s <= 0) issues.push("duration_s must be positive");
      if (s.motion_need === "essential" && p.shot.duration_s > clipMax + 0.5)
        issues.push(
          `this shot lasts ${p.shot.duration_s}s, longer than the ${clipMax}s clip limit; motion_need cannot be essential`,
        );
      if (otherDescriptions.has(s.description.trim().toLowerCase()))
        issues.push("description duplicates another shot; make it distinct");
      if (!textAllowed && s.text_overlay) issues.push("text_overlay must be null");
      if (
        s.text_overlay &&
        s.text_overlay.text.trim().split(/\s+/).length > b.text_policy.max_words_on_screen
      )
        issues.push(`text_overlay exceeds ${b.text_policy.max_words_on_screen} words`);
      return issues;
    },
  });
}

export interface StoryboardValidationContext {
  clipMax: number;
  entityIds: string[];
  lineIds: string[];
  textAllowed: boolean;
  maxWordsOnScreen: number;
  shotRange: { min: number; max: number };
}

/**
 * The storyboard invariants, shared by the artist's retry loop and the studio's storyboard
 * editor so a hand-edited storyboard obeys exactly the rules a generated one does.
 */
export function validateStoryboard(sb: Storyboard, ctx: StoryboardValidationContext): string[] {
  const { clipMax, entityIds, lineIds, textAllowed } = ctx;
  const issues: string[] = [];
  const n = sb.shots.length;
  if (n < 3 || n > 14) issues.push(`${n} shots; use between 3 and 14`);
  sb.shots.forEach((s, i) => {
    const expected = `shot_${String(i + 1).padStart(2, "0")}`;
    if (s.id !== expected) issues.push(`shot ${i + 1} must have id ${expected}`);
    if (s.duration_s <= 0) issues.push(`${s.id} needs a positive duration`);
    if (s.motion_need === "essential" && s.duration_s > clipMax + 0.5)
      issues.push(
        `${s.id} is essential motion but ${s.duration_s}s exceeds the ${clipMax}s clip limit; split it or make it subtle`,
      );
    for (const id of s.entities_in_frame)
      if (!entityIds.includes(id)) issues.push(`${s.id} references unknown entity "${id}"`);
    for (const id of s.narration_line_ids)
      if (!lineIds.includes(id)) issues.push(`${s.id} references unknown narration line "${id}"`);
    if (!textAllowed && s.text_overlay)
      issues.push(`${s.id} has text_overlay but the brief allows no text`);
    if (s.narration_line_ids.length === 0 && i !== 0 && i !== n - 1)
      issues.push(`${s.id} has no narration lines but is not the opening or closing shot`);
  });
  const assigned = sb.shots.flatMap((s) => s.narration_line_ids);
  for (const id of lineIds) {
    const count = assigned.filter((a) => a === id).length;
    if (count === 0) issues.push(`narration line ${id} is not assigned to any shot`);
    if (count > 1) issues.push(`narration line ${id} is assigned to ${count} shots`);
  }
  // Lines must appear in order across shots.
  const order = assigned.map((id) => lineIds.indexOf(id));
  for (let i = 1; i < order.length; i++) {
    const prev = order[i - 1] ?? 0;
    const cur = order[i] ?? 0;
    if (cur < prev) {
      issues.push("narration lines must be assigned to shots in script order");
      break;
    }
  }
  const risk = assessStoryboardRisk(sb, {
    maxWordsOnScreen: ctx.maxWordsOnScreen,
    textAllowed,
    shotRange: ctx.shotRange,
  });
  if (risk.verdict === "fail" || risk.verdict === "revise") {
    for (const c of risk.checks)
      if (c.status !== "pass") issues.push(`risk check ${c.id}: ${c.detail}`);
  }
  return issues;
}
