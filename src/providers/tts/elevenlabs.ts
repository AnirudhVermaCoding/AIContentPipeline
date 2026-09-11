import { ttsCost } from "../../config/pricing.js";
import type { WordTimestamp } from "../../schema/voice.js";
import { ProviderError } from "../../util/errors.js";
import { withRetry } from "../../util/retry.js";
import type { TtsProvider, TtsResult, TtsSynthesizeOptions } from "../types.js";

const BASE = "https://api.elevenlabs.io/v1";

interface TimestampResponse {
  audio_base64: string;
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
}

/** ElevenLabs adapter (adapted from OpenReels, MIT): with-timestamps endpoint, word aggregation. */
export class ElevenLabsTts implements TtsProvider {
  readonly id = "elevenlabs";
  readonly model: string;
  private readonly apiKey: string;

  constructor(opts: { apiKey: string; model: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
  }

  estimate(characters: number): number {
    return ttsCost(this.id, this.model, characters);
  }

  async synthesize(opts: TtsSynthesizeOptions): Promise<TtsResult> {
    const started = Date.now();
    const data = await withRetry(
      async (signal) => {
        const res = await fetch(`${BASE}/text-to-speech/${opts.voiceId}/with-timestamps`, {
          method: "POST",
          headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: opts.text,
            model_id: this.model,
            voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: opts.speed ?? 1 },
          }),
          signal: opts.signal ?? signal,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new ProviderError(this.id, `${res.status}: ${text.slice(0, 300)}`, {
            status: res.status,
            retryable: res.status === 429 || res.status >= 500,
          });
        }
        return (await res.json()) as TimestampResponse;
      },
      { attempts: 3, timeoutMs: 120_000, label: opts.label ?? "tts" },
    );
    const audio = Buffer.from(data.audio_base64, "base64");
    return {
      audio,
      format: "mp3",
      sampleRate: 44100,
      words: aggregateWords(data.alignment),
      characters: opts.text.length,
      provider: this.id,
      model: this.model,
      latencyMs: Date.now() - started,
      costUsd: this.estimate(opts.text.length),
    };
  }
}

function aggregateWords(a: TimestampResponse["alignment"]): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  let current = "";
  let start = -1;
  let end = -1;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i] ?? "";
    if (/\s/.test(ch)) {
      if (current && start >= 0) words.push({ word: current, start, end });
      current = "";
      start = -1;
      end = -1;
    } else {
      if (start < 0) start = a.character_start_times_seconds[i] ?? 0;
      end = a.character_end_times_seconds[i] ?? end;
      current += ch;
    }
  }
  if (current && start >= 0) words.push({ word: current, start, end });
  return words;
}
