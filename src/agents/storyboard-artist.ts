import type { RunContext } from "../pipeline/run.js";
import { assessStoryboardRisk } from "../qc/storyboard-risk.js";
import type { CreativeBrief } from "../schema/brief.js";
import { CameraAngle, CameraMovement, Lens, ShotSize } from "../schema/common.js";
import type { Script } from "../schema/script.js";
import { type Storyboard, StoryboardSchema } from "../schema/storyboard.js";
import type { VoiceResult } from "../schema/voice.js";
import { type AgentResult, callAgent } from "./base.js";

export function knownEntityIds(run: RunContext, brief: CreativeBrief): Set<string> {
  const ids = new Set(run.brand.profile.entities.map((e) => e.id));
  for (const e of brief.entities_needed) ids.add(e.id);
  return ids;
}

export async function runStoryboardArtist(
  run: RunContext,
  stageId: string,
  brief: CreativeBrief,
  script: Script,
  voice: VoiceResult,
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
shot_size: ${ShotSize.options.join(", ")}
angle: ${CameraAngle.options.join(", ")}
movement: ${CameraMovement.options.join(", ")}
lens: ${Lens.options.join(", ")}
entity ids: ${entityIds.join(", ") || "none"}
Shot count for this brand: usually ${b.pacing.shot_count_hint.min}-${b.pacing.shot_count_hint.max}. Hold bias: ${b.pacing.hold_bias}.
Shots with motion_need "essential" become generated clips of at most ${clipMax} s, so keep them at or under ${clipMax} s.
Silent shots (no narration lines) are only allowed as the opening or closing shot.

Return the Storyboard.`;

  const textAllowed = brief.text_overlay_intent !== "none";
  const lineIds = voice.lines.map((l) => l.line_id);
  return callAgent(run, {
    name: "storyboard-artist",
    tier: "creative",
    schema: StoryboardSchema,
    userMessage,
    stageId,
    expectedOutputTokens: 3500,
    validate: (sb) => {
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
          if (!lineIds.includes(id))
            issues.push(`${s.id} references unknown narration line "${id}"`);
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
        maxWordsOnScreen: b.text_policy.max_words_on_screen,
        textAllowed,
        shotRange: b.pacing.shot_count_hint,
      });
      if (risk.verdict === "fail" || risk.verdict === "revise") {
        for (const c of risk.checks)
          if (c.status !== "pass") issues.push(`risk check ${c.id}: ${c.detail}`);
      }
      return issues;
    },
  });
}
