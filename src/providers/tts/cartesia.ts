import { ttsCost } from "../../config/pricing.js";
import type { WordTimestamp } from "../../schema/voice.js";
import { ProviderError } from "../../util/errors.js";
import { withRetry } from "../../util/retry.js";
import type { TtsProvider, TtsResult, TtsSynthesizeOptions } from "../types.js";

const BASE = "https://api.cartesia.ai";
const VERSION = "2025-04-16";

export interface CartesiaOptions {
  apiKey: string;
  model: string; // sonic-3.5
}

/**
 * Cartesia Sonic. `/tts/bytes` for plain audio (line-level timing comes from per-line synthesis);
 * `/tts/sse` with `add_timestamps` only when word timestamps are requested (captions).
 */
export class CartesiaTts implements TtsProvider {
  readonly id = "cartesia";
  readonly model: string;
  private readonly apiKey: string;

  constructor(opts: CartesiaOptions) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
  }

  estimate(characters: number): number {
    return ttsCost(this.id, this.model, characters);
  }

  private headers(): Record<string, string> {
    return {
      "Cartesia-Version": VERSION,
      Authorization: `Bearer ${this.apiKey}`,
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  private body(
    opts: TtsSynthesizeOptions,
    container: "mp3" | "raw",
    extra: Record<string, unknown> = {},
  ) {
    return {
      model_id: this.model,
      transcript: opts.text,
      voice: { mode: "id", id: opts.voiceId },
      language: opts.language ?? "en",
      output_format:
        container === "mp3"
          ? { container: "mp3", bit_rate: 128000, sample_rate: 44100 }
          : { container: "raw", encoding: "pcm_s16le", sample_rate: 44100 },
      ...(opts.speed && opts.speed !== 1 ? { speed: opts.speed } : {}),
      ...extra,
    };
  }

  async synthesize(opts: TtsSynthesizeOptions): Promise<TtsResult> {
    const started = Date.now();
    if (opts.wantTimestamps) return this.synthesizeWithTimestamps(opts, started);
    const audio = await withRetry(
      async (signal) => {
        const res = await fetch(`${BASE}/tts/bytes`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(this.body(opts, "mp3")),
          signal: opts.signal ?? signal,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new ProviderError(this.id, `tts/bytes ${res.status}: ${text.slice(0, 300)}`, {
            status: res.status,
            retryable: res.status === 429 || res.status >= 500,
          });
        }
        return Buffer.from(await res.arrayBuffer());
      },
      { attempts: 3, timeoutMs: 120_000, label: opts.label ?? "tts" },
    );
    if (audio.length === 0) throw new ProviderError(this.id, "empty audio", { retryable: true });
    return {
      audio,
      format: "mp3",
      sampleRate: 44100,
      words: null,
      characters: opts.text.length,
      provider: this.id,
      model: this.model,
      latencyMs: Date.now() - started,
      costUsd: this.estimate(opts.text.length),
    };
  }

  private async synthesizeWithTimestamps(
    opts: TtsSynthesizeOptions,
    started: number,
  ): Promise<TtsResult> {
    const { audio, words } = await withRetry(
      async (signal) => {
        const res = await fetch(`${BASE}/tts/sse`, {
          method: "POST",
          headers: { ...this.headers(), Accept: "text/event-stream" },
          body: JSON.stringify(this.body(opts, "raw", { add_timestamps: true })),
          signal: opts.signal ?? signal,
        });
        if (!res.ok || !res.body) {
          const text = res.body ? await res.text() : "";
          throw new ProviderError(this.id, `tts/sse ${res.status}: ${text.slice(0, 300)}`, {
            status: res.status,
            retryable: res.status === 429 || res.status >= 500,
          });
        }
        const chunks: Buffer[] = [];
        const words: WordTimestamp[] = [];
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number = buffer.indexOf("\n\n");
          while (idx >= 0) {
            const event = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = event
              .split("\n")
              .find((l) => l.startsWith("data:"))
              ?.slice(5)
              .trim();
            if (dataLine) {
              const msg = JSON.parse(dataLine) as {
                type?: string;
                data?: string;
                word_timestamps?: { words: string[]; start: number[]; end: number[] };
              };
              if (msg.type === "chunk" && msg.data) chunks.push(Buffer.from(msg.data, "base64"));
              if (msg.type === "timestamps" && msg.word_timestamps) {
                const wt = msg.word_timestamps;
                wt.words.forEach((w, i) => {
                  words.push({ word: w, start: wt.start[i] ?? 0, end: wt.end[i] ?? 0 });
                });
              }
            }
            idx = buffer.indexOf("\n\n");
          }
        }
        return { audio: Buffer.concat(chunks), words };
      },
      { attempts: 3, timeoutMs: 180_000, label: opts.label ?? "tts" },
    );
    if (audio.length === 0) throw new ProviderError(this.id, "empty audio", { retryable: true });
    // raw pcm_s16le mono 44.1k → wrap into a WAV container
    return {
      audio: pcmToWav(audio, 44100, 1),
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

export function pcmToWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
