import * as os from "node:os";
import * as path from "node:path";
import { videoCost } from "../../config/pricing.js";
import { imageToVideo } from "../../media/ffmpeg.js";
import type { VideoGenerateOptions, VideoProvider, VideoResult } from "../types.js";

/** Offline video generator: a slow push-in on the keyframe, 24 fps, no audio (like H3 Max). */
export class MockVideo implements VideoProvider {
  readonly id: string;
  readonly model: string;
  readonly resolution: string;
  readonly minSeconds = 5;
  readonly maxSeconds = 10;

  constructor(opts: { provider: string; model: string; resolution?: string }) {
    this.id = opts.provider;
    this.model = opts.model;
    this.resolution = opts.resolution ?? "768P";
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
    const out = path.join(
      os.tmpdir(),
      `aicp-mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
    );
    await imageToVideo(opts.imagePath, out, {
      seconds,
      width: 432,
      height: 768,
      fps: 24,
      zoomTo: 1.1,
    });
    return {
      filePath: out,
      durationSeconds: seconds,
      resolution: this.resolution,
      provider: this.id,
      model: this.model,
      latencyMs: Date.now() - started,
      costUsd: this.estimate(seconds),
    };
  }
}
