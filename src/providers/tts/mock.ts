import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ttsCost } from "../../config/pricing.js";
import { makeToneWav } from "../../media/ffmpeg.js";
import type { TtsProvider, TtsResult, TtsSynthesizeOptions } from "../types.js";

/** Offline TTS: a low tone whose length follows the text (≈ 12.5 characters per second). */
export class MockTts implements TtsProvider {
  readonly id: string;
  readonly model: string;

  constructor(opts: { provider: string; model: string }) {
    this.id = opts.provider;
    this.model = opts.model;
  }

  estimate(characters: number): number {
    return ttsCost(this.id, this.model, characters);
  }

  async synthesize(opts: TtsSynthesizeOptions): Promise<TtsResult> {
    const started = Date.now();
    const seconds = Math.max(0.6, opts.text.length / 12.5 / (opts.speed ?? 1));
    const tmp = path.join(
      os.tmpdir(),
      `aicp-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
    );
    await makeToneWav(tmp, seconds, 180 + (opts.text.length % 7) * 20);
    const audio = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    const words = opts.wantTimestamps
      ? opts.text
          .split(/\s+/)
          .filter(Boolean)
          .map((w, i, arr) => ({
            word: w,
            start: (seconds * i) / arr.length,
            end: (seconds * (i + 1)) / arr.length,
          }))
      : null;
    return {
      audio,
      format: "wav",
      sampleRate: 44100,
      words,
      characters: opts.text.length,
      provider: this.id,
      model: this.model,
      latencyMs: Date.now() - started,
      costUsd: this.estimate(opts.text.length),
    };
  }
}
