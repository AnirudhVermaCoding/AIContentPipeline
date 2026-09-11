import { promptVersions } from "../../agents/prompts.js";
import { runStoryboardArtist } from "../../agents/storyboard-artist.js";
import { assessStoryboardRisk } from "../../qc/storyboard-risk.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { ScriptSchema } from "../../schema/script.js";
import type { Shot, Storyboard, StoryboardArtifact } from "../../schema/storyboard.js";
import { type VoiceResult, VoiceResultSchema } from "../../schema/voice.js";
import type { StageDef } from "../stage.js";

/**
 * Conform the LLM's shot durations to measured narration: shots carrying lines span from the
 * midpoint of the previous gap to the midpoint of the next gap; silent opening/closing shots keep
 * their planned length and offset the voice track.
 */
export function conformToVoice(
  sb: Storyboard,
  voice: VoiceResult,
): { shots: Shot[]; starts: number[]; voiceOffset: number } {
  const shots = sb.shots.map((s) => ({ ...s }));
  if (voice.music_only || voice.lines.length === 0) {
    let t = 0;
    const starts = shots.map((s) => {
      const st = t;
      t += s.duration_s;
      return st;
    });
    return { shots, starts, voiceOffset: 0 };
  }
  const lineById = new Map(voice.lines.map((l) => [l.line_id, l]));
  const firstNarrated = shots.findIndex((s) => s.narration_line_ids.length > 0);
  const lastNarrated =
    shots.length - 1 - [...shots].reverse().findIndex((s) => s.narration_line_ids.length > 0);
  const voiceOffset = shots.slice(0, firstNarrated).reduce((n, s) => n + s.duration_s, 0);
  const tailPad = 0.6;
  const leadPad = 0.35;

  const spans = shots.map((s) => {
    const ls = s.narration_line_ids
      .map((id) => lineById.get(id))
      .filter((l): l is NonNullable<typeof l> => !!l);
    if (!ls.length) return null;
    return {
      start: Math.min(...ls.map((l) => l.start_s)),
      end: Math.max(...ls.map((l) => l.end_s)),
    };
  });

  const starts: number[] = new Array(shots.length).fill(0);
  let t = 0;
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const span = spans[i];
    if (!shot) continue;
    if (!span) {
      starts[i] = t;
      t += shot.duration_s;
      continue;
    }
    // Boundary with previous narrated shot: midpoint of the gap; first narrated shot starts leadPad before its line.
    const prevSpan = i > 0 ? spans[i - 1] : null;
    const shotStart =
      i === firstNarrated
        ? voiceOffset
        : prevSpan
          ? voiceOffset + (prevSpan.end + span.start) / 2
          : t;
    const nextSpan = i < shots.length - 1 ? spans[i + 1] : null;
    const shotEnd =
      i === lastNarrated
        ? voiceOffset + span.end + tailPad
        : nextSpan
          ? voiceOffset + (span.end + nextSpan.start) / 2
          : voiceOffset + span.end + leadPad;
    const start = Math.max(t, shotStart);
    starts[i] = start;
    shot.duration_s = Math.max(0.8, Math.round((shotEnd - start) * 100) / 100);
    t = start + shot.duration_s;
  }
  return { shots, starts, voiceOffset };
}

export const storyboardStage: StageDef = {
  id: "storyboard",
  version: "1",
  dir: "04_storyboard",
  dependsOn: ["brief", "script", "voice"],
  extraInputs: () => ({ prompts: promptVersions(["storyboard-artist"]) }),
  async run(ctx) {
    const { run } = ctx;
    const brief = ctx.input("brief", CreativeBriefSchema);
    const script = ctx.input("script", ScriptSchema);
    const voice = ctx.input("voice", VoiceResultSchema);
    const result = await runStoryboardArtist(run, this.id, brief, script, voice);
    const b = run.brand.profile;
    const risk = assessStoryboardRisk(result.data, {
      maxWordsOnScreen: b.text_policy.max_words_on_screen,
      textAllowed: brief.text_overlay_intent !== "none",
      shotRange: b.pacing.shot_count_hint,
    });
    const conformed = conformToVoice(result.data, voice);
    const total = conformed.shots.reduce((n, s) => n + s.duration_s, 0);
    const artifact: StoryboardArtifact = {
      ...result.data,
      shots: conformed.shots,
      total_duration_s: Math.round(total * 100) / 100,
      shot_start_s: conformed.starts,
      voice_offset_s: conformed.voiceOffset,
      conformed_to_voice: !voice.music_only,
      risk,
    };
    ctx.writeOutput(artifact);
    run.repos.insertQc(run.runId, this.id, null, risk.verdict, risk);
    run.events.decision({
      stage: this.id,
      category: "storyboard",
      subject: "shot_count",
      options_considered: [
        `brand hint ${b.pacing.shot_count_hint.min}-${b.pacing.shot_count_hint.max}`,
      ],
      reason: `${artifact.shots.length} shots, ${artifact.shots.filter((s) => s.motion_need === "essential").length} need real motion; risk ${risk.verdict} (${risk.score})`,
    });
    run.events.info(
      this.id,
      `${artifact.shots.length} shots over ${artifact.total_duration_s}s; risk ${risk.verdict}`,
    );
    return { status: "done" };
  },
};
