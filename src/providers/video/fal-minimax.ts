import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createFalClient, type FalClient } from "@fal-ai/client";
import { videoCost } from "../../config/pricing.js";
import { ProviderError, SafetyRejectionError } from "../../util/errors.js";
import { writeFileAtomic } from "../../util/fs.js";
import { withRetry } from "../../util/retry.js";
import { queueUpdate } from "../image/fal-flux2.js";
import type { VideoGenerateOptions, VideoProvider, VideoResult } from "../types.js";

export interface FalMinimaxOptions {
  apiKey: string;
  model: string; // minimax/h3-max/image-to-video
  resolution?: string; // "768P"
  promptExpansionMode?: string; // "balanced"
}

interface FalVideoOutput {
  video?: { url: string };
}

/**
 * MiniMax H3 / H3 Max image-to-video on fal. Reference-to-video variants are deliberately not
 * wired here; they slot in as another VideoProvider once confirmed.
 */
export class FalMinimaxVideo implements VideoProvider {
  readonly id = "fal";
  readonly model: string;
  readonly resolution: string;
  readonly minSeconds = 5;
  readonly maxSeconds = 10;
  private readonly client: FalClient;
  private readonly promptExpansionMode: string;

  constructor(opts: FalMinimaxOptions) {
    this.model = opts.model;
    this.resolution = opts.resolution ?? "768P";
    this.promptExpansionMode = opts.promptExpansionMode ?? "balanced";
    this.client = createFalClient({ credentials: opts.apiKey });
  }

  estimate(seconds: number): number {
    return videoCost(this.id, this.model, seconds, this.resolution);
  }

  async generate(opts: VideoGenerateOptions): Promise<VideoResult> {
    const started = Date.now();
    const seconds = Math.min(
      this.maxSeconds,
      Math.max(this.minSeconds, Math.round(opts.durationSeconds)),
    );
    const blob = new Blob([new Uint8Array(fs.readFileSync(opts.imagePath))], { type: "image/png" });
    const imageUrl = await this.client.storage.upload(blob);

    const result = await withRetry(
      async () => {
        try {
          return await this.client.subscribe(this.model, {
            input: {
              prompt: opts.prompt,
              image_url: imageUrl,
              duration: seconds,
              resolution: this.resolution,
              prompt_expansion_mode: this.promptExpansionMode,
              enable_safety_checker: true,
            },
            pollInterval: 4000,
            timeout: 900_000,
            logs: false,
            onQueueUpdate: (status) => opts.onStatus?.(queueUpdate(status)),
          });
        } catch (err) {
          throw this.wrap(err);
        }
      },
      { attempts: 2, label: opts.label ?? "video" },
    );

    const url = (result.data as FalVideoOutput).video?.url;
    if (!url) throw new ProviderError(this.id, "no video url returned", { retryable: true });
    const res = await fetch(url);
    if (!res.ok)
      throw new ProviderError(this.id, `download failed (${res.status})`, { retryable: true });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0)
      throw new ProviderError(this.id, "empty video download", { retryable: true });
    const filePath = path.join(
      os.tmpdir(),
      `aicp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
    );
    writeFileAtomic(filePath, buf);
    return {
      filePath,
      durationSeconds: seconds,
      resolution: this.resolution,
      provider: this.id,
      model: this.model,
      latencyMs: Date.now() - started,
      costUsd: this.estimate(seconds),
      costSource: "CALCULATED_FROM_USAGE",
      requestId: result.requestId ?? null,
    };
  }

  private wrap(err: unknown): Error {
    const e = err as { message?: string; status?: number; body?: unknown };
    const msg =
      `${e.message ?? String(err)} ${e.body ? JSON.stringify(e.body).slice(0, 300) : ""}`.trim();
    if (/nsfw|safety|content policy|flagged|sensitive/i.test(msg))
      return new SafetyRejectionError(this.id, msg, err);
    const status = e.status;
    const retryable = status === undefined ? true : status === 429 || status >= 500;
    return new ProviderError(this.id, msg, { cause: err, retryable, status });
  }
}
