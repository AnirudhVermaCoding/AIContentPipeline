import * as path from "node:path";
import { audioEnvelope } from "../../media/ffmpeg.js";
import { ensureMockBed, loadMusicLibrary, pickTrack } from "../../media/music.js";
import type { AudioPlan } from "../../schema/audio.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { VoiceResultSchema } from "../../schema/voice.js";
import { writeJsonAtomic } from "../../util/fs.js";
import type { StageDef } from "../stage.js";

export const audioStage: StageDef = {
  id: "audio",
  version: "1",
  dir: "09_audio",
  dependsOn: ["brief", "voice"],
  extraInputs: (run) => ({ music: run.brand.profile.music, mode: run.options.provider_mode }),
  async run(ctx) {
    const { run } = ctx;
    const b = run.brand.profile;
    const brief = ctx.input("brief", CreativeBriefSchema);
    const voice = ctx.input("voice", VoiceResultSchema);

    let voicePlan: AudioPlan["voice"] = null;
    if (!voice.music_only && voice.audio_path) {
      const env = await audioEnvelope(run.abs(voice.audio_path), 0.1);
      const envFile = path.join(ctx.stageDir, "voice-envelope.json");
      writeJsonAtomic(envFile, { window_s: 0.1, rms_db: env });
      voicePlan = {
        path: voice.audio_path,
        duration_s: voice.duration_s,
        envelope_path: run.rel(envFile),
      };
    }

    let music: AudioPlan["music"] = null;
    let reason = "";
    if (b.music.policy === "never") {
      reason = "brand policy: no music";
    } else {
      const pick = pickTrack(loadMusicLibrary(), b.music.mood_tags, b.music.energy);
      if (pick) {
        music = {
          track_id: pick.track.id,
          path: pick.path,
          gain_db: b.music.gain_db,
          ducking: { attenuation_db: 12, attack_ms: 150, release_ms: 600 },
          fade_in_s: 0.8,
          fade_out_s: 1.5,
        };
        reason = `library track ${pick.track.id} matched tags ${b.music.mood_tags.join(", ")}`;
      } else if (run.options.provider_mode === "mock") {
        music = {
          track_id: "mock-bed",
          path: await ensureMockBed(),
          gain_db: b.music.gain_db,
          ducking: { attenuation_db: 12, attack_ms: 150, release_ms: 600 },
          fade_in_s: 0.8,
          fade_out_s: 1.5,
        };
        reason = "mock mode: synthetic bed (library has no matching track)";
      } else if (b.music.policy === "always") {
        reason = "brand wants music but the library has no matching track; continuing without";
        run.events.warn(this.id, reason);
      } else {
        reason = `no library track matches ${b.music.mood_tags.join(", ")}; the film runs without music`;
      }
    }
    if (voice.music_only && !music) {
      run.events.warn(this.id, "music-only script with no music track: the video will be silent");
    }
    const plan: AudioPlan = { voice: voicePlan, music, reason };
    ctx.writeOutput(plan);
    run.events.decision({
      stage: this.id,
      category: "audio",
      subject: "music",
      options_considered: ["library track", "no music", "mock bed"],
      reason: `${reason} (edit intent ${brief.edit_mode_intent})`,
    });
    run.events.info(
      this.id,
      music ? `music: ${music.track_id} at ${music.gain_db} dB with ducking` : "no music",
    );
    return { status: "done" };
  },
};
