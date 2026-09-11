import * as fs from "node:fs";
import { createFalClient, type FalClient } from "@fal-ai/client";
import { imageCost } from "../../config/pricing.js";
import { ProviderError, SafetyRejectionError } from "../../util/errors.js";
import { withRetry } from "../../util/retry.js";
import type { ImageGenerateOptions, ImageProvider, ImageResult } from "../types.js";

export interface FalFlux2Options {
  apiKey: string;
  model: string; // e.g. fal-ai/flux-2-pro
  editModel?: string; // e.g. fal-ai/flux-2-pro/edit
}

interface FalImageOutput {
  images?: Array<{ url: string; width?: number; height?: number; content_type?: string }>;
  seed?: number;
}

/** FLUX.2 on fal: text-to-image, or multi-reference edit when reference images are supplied. */
export class FalFlux2Image implements ImageProvider {
  readonly id = "fal";
  readonly model: string;
  readonly editModel: string;
  readonly supportsReferences = true;
  private readonly client: FalClient;

  constructor(opts: FalFlux2Options) {
    this.model = opts.model;
    this.editModel = opts.editModel ?? `${opts.model}/edit`;
    this.client = createFalClient({ credentials: opts.apiKey });
  }

  estimate(width: number, height: number, referenceCount: number): number {
    const model = referenceCount > 0 ? this.editModel : this.model;
    return imageCost(this.id, model, width, height, referenceCount * 1.0);
  }

  async generate(opts: ImageGenerateOptions): Promise<ImageResult> {
    const started = Date.now();
    const refs = opts.referenceImages ?? [];
    const useEdit = refs.length > 0;
    const endpoint = useEdit ? this.editModel : this.model;

    const imageUrls: string[] = [];
    for (const ref of refs) {
      const blob = new Blob([new Uint8Array(fs.readFileSync(ref))], { type: "image/png" });
      imageUrls.push(await this.client.storage.upload(blob));
    }

    const input: Record<string, unknown> = {
      prompt: opts.prompt,
      image_size: { width: opts.width, height: opts.height },
      num_images: 1,
      output_format: "png",
      enable_safety_checker: true,
      ...(opts.seed != null ? { seed: opts.seed } : {}),
      ...(useEdit ? { image_urls: imageUrls } : {}),
    };

    const result = await withRetry(
      async () => {
        try {
          return await this.client.subscribe(endpoint, {
            input,
            pollInterval: 3000,
            timeout: 300_000,
            logs: false,
          });
        } catch (err) {
          throw this.wrap(err);
        }
      },
      { attempts: 3, label: opts.label ?? "image" },
    );

    const data = result.data as FalImageOutput;
    const first = data.images?.[0];
    if (!first?.url) throw new ProviderError(this.id, "no image returned", { retryable: true });
    const res = await fetch(first.url);
    if (!res.ok)
      throw new ProviderError(this.id, `download failed (${res.status})`, { retryable: true });
    const image = Buffer.from(await res.arrayBuffer());
    if (image.length === 0)
      throw new ProviderError(this.id, "empty image download", { retryable: true });
    return {
      image,
      seed: data.seed ?? null,
      width: first.width ?? opts.width,
      height: first.height ?? opts.height,
      provider: this.id,
      model: endpoint,
      latencyMs: Date.now() - started,
      costUsd: this.estimate(opts.width, opts.height, refs.length),
    };
  }

  private wrap(err: unknown): Error {
    const e = err as { message?: string; status?: number; body?: unknown };
    const msg =
      `${e.message ?? String(err)} ${e.body ? JSON.stringify(e.body).slice(0, 300) : ""}`.trim();
    if (/nsfw|safety|content policy|flagged/i.test(msg))
      return new SafetyRejectionError(this.id, msg, err);
    const status = e.status;
    const retryable = status === undefined ? true : status === 429 || status >= 500;
    return new ProviderError(this.id, msg, { cause: err, retryable, status });
  }
}
