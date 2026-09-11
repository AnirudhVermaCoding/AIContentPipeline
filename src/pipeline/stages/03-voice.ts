import * as fs from "node:fs";
import * as path from "node:path";
import { concatAudioWithGaps } from "../../media/ffmpeg.js";
import { probeMedia } from "../../media/probe.js";
import { ScriptSchema } from "../../schema/script.js";
import type { VoiceLine, VoiceResult, WordTimestamp } from "../../schema/voice.js";
import { exists, readJson, sha256, writeFileAtomic, writeJsonAtomic } from "../../util/fs.js";
import { paidCall } from "../paid.js";
import type { StageDef } from "../stage.js";

interface LineCache {
  text_hash: string;
  path: string;
  duration_s: number;
  words: WordTimestamp[] | null;
  characters: number;
  cost_usd: number;
}

/**
 * Per-line synthesis, then concatenation with the brand's gap. Line boundaries are therefore exact
 * without word timestamps. Each line is cached by text hash so a resume never re-pays.
 */
export const voiceStage: StageDef = {
  id: "voice",
  version: "1",
  dir: "03_voice",
  dependsOn: ["script"],
  extraInputs: (run) => ({ voice: run.brand.profile.voice, tts: run.manifest.providers.tts }),
  async run(ctx) {
    const { run } = ctx;
    const script = ctx.input("script", ScriptSchema);
    const b = run.brand.profile;
    const tts = run.providers.tts;
    if (script.music_only) {
      const out: VoiceResult = {
        music_only: true,
        provider: tts.id,
        model: tts.model,
        voice_id: b.voice.voice_id,
        audio_path: null,
        duration_s: script.est_duration_s,
        line_gap_s: b.voice.line_gap_s,
        lines: [],
        words: null,
        characters: 0,
        cost_usd: 0,
      };
      ctx.writeOutput(out);
      return { status: "done" };
    }

    const wantTimestamps =
      b.text_policy.captions === "when_needed" || b.text_policy.captions === "always";
    const linesDir = path.join(ctx.stageDir, "lines");
    fs.mkdirSync(linesDir, { recursive: true });
    const lines: VoiceLine[] = [];
    const words: WordTimestamp[] = [];
    let cursor = 0;
    let characters = 0;
    let cost = 0;
    const files: string[] = [];

    for (const line of script.narration) {
      const cacheFile = path.join(linesDir, `${line.id}.json`);
      const textHash = sha256(
        `${line.text}|${b.voice.voice_id}|${tts.model}|${b.voice.speed}`,
      ).slice(0, 16);
      let cached: LineCache | null = null;
      if (exists(cacheFile)) {
        const c = readJson<LineCache>(cacheFile);
        if (c.text_hash === textHash && exists(run.abs(c.path))) cached = c;
      }
      if (!cached) {
        const res = await paidCall(
          run,
          {
            stageId: this.id,
            kind: "tts",
            provider: tts.id,
            model: tts.model,
            label: `tts:${line.id}`,
            estimateUsd: tts.estimate(line.text.length),
            prompt: line.text,
          },
          () =>
            tts.synthesize({
              text: line.text,
              voiceId: b.voice.voice_id,
              speed: b.voice.speed,
              language: b.voice.language,
              style: b.voice.style,
              wantTimestamps,
              label: `tts:${line.id}`,
            }),
        );
        const file = path.join(linesDir, `${line.id}.${res.format}`);
        writeFileAtomic(file, res.audio);
        const meta = await probeMedia(file);
        cached = {
          text_hash: textHash,
          path: run.rel(file),
          duration_s: meta.duration_s,
          words: res.words,
          characters: res.characters,
          cost_usd: res.costUsd,
        };
        writeJsonAtomic(cacheFile, cached);
      } else {
        run.events.debug(this.id, `${line.id} reused from cache`);
      }
      const start = cursor;
      const end = start + cached.duration_s;
      lines.push({
        line_id: line.id,
        text: line.text,
        path: cached.path,
        start_s: start,
        end_s: end,
        duration_s: cached.duration_s,
      });
      if (cached.words)
        for (const w of cached.words)
          words.push({ word: w.word, start: start + w.start, end: start + w.end });
      files.push(run.abs(cached.path));
      characters += cached.characters;
      cost += cached.cost_usd;
      cursor = end + b.voice.line_gap_s;
    }

    const voiceFile = path.join(ctx.stageDir, "voice.mp3");
    await concatAudioWithGaps(files, b.voice.line_gap_s, voiceFile);
    const meta = await probeMedia(voiceFile);
    const out: VoiceResult = {
      music_only: false,
      provider: tts.id,
      model: tts.model,
      voice_id: b.voice.voice_id,
      audio_path: run.rel(voiceFile),
      duration_s: meta.duration_s,
      line_gap_s: b.voice.line_gap_s,
      lines,
      words: words.length ? words : null,
      characters,
      cost_usd: cost,
    };
    ctx.writeOutput(out);
    run.events.info(
      this.id,
      `${lines.length} lines, ${meta.duration_s.toFixed(1)}s narration, ${characters} chars`,
    );
    return { status: "done" };
  },
};
