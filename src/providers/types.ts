import type { z } from "zod";
import type { LlmUsage } from "../config/pricing.js";
import type { WordTimestamp } from "../schema/voice.js";

/**
 * Vendor-neutral capability interfaces. Stages only ever talk to these; concrete adapters live
 * in providers/<capability>/ and are chosen by configuration through the registry.
 */

export interface CallMeta {
  provider: string;
  model: string;
  latencyMs: number;
  costUsd: number;
}

export interface LlmImageInput {
  data: Buffer;
  mediaType: string;
}

export interface LlmGenerateOptions<T> {
  instructions: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Optional images for vision tasks. */
  images?: LlmImageInput[];
  /** Let the model use a web search tool before answering (two-pass: search, then structure). */
  webSearch?: boolean;
  /** Short label for logs/ledger, e.g. "creative-director". */
  label?: string;
  signal?: AbortSignal;
}

export interface LlmResult<T> extends CallMeta {
  data: T;
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  generate<T>(opts: LlmGenerateOptions<T>): Promise<LlmResult<T>>;
}

export interface ImageGenerateOptions {
  prompt: string;
  width: number;
  height: number;
  seed?: number | null;
  /** Reference images (paths) for multi-reference editing / consistency. */
  referenceImages?: string[];
  negativePrompt?: string;
  label?: string;
  signal?: AbortSignal;
}

export interface ImageResult extends CallMeta {
  image: Buffer;
  seed: number | null;
  width: number;
  height: number;
}

export interface ImageProvider {
  readonly id: string;
  readonly model: string;
  /** Model used when reference images are supplied (may equal `model`). */
  readonly editModel: string;
  supportsReferences: boolean;
  estimate(width: number, height: number, referenceCount: number): number;
  generate(opts: ImageGenerateOptions): Promise<ImageResult>;
}

export interface VideoGenerateOptions {
  imagePath: string;
  prompt: string;
  durationSeconds: number;
  negativePrompt?: string;
  label?: string;
  signal?: AbortSignal;
}

export interface VideoResult extends CallMeta {
  /** Downloaded file (caller moves it into the run dir). */
  filePath: string;
  durationSeconds: number;
  resolution: string;
}

export interface VideoProvider {
  readonly id: string;
  readonly model: string;
  readonly resolution: string;
  readonly minSeconds: number;
  readonly maxSeconds: number;
  estimate(seconds: number): number;
  generate(opts: VideoGenerateOptions): Promise<VideoResult>;
}

export interface TtsSynthesizeOptions {
  text: string;
  voiceId: string;
  speed?: number;
  language?: string;
  style?: string;
  wantTimestamps?: boolean;
  label?: string;
  signal?: AbortSignal;
}

export interface TtsResult extends CallMeta {
  audio: Buffer;
  format: "mp3" | "wav";
  sampleRate: number;
  words: WordTimestamp[] | null;
  characters: number;
}

export interface TtsProvider {
  readonly id: string;
  readonly model: string;
  estimate(characters: number): number;
  synthesize(opts: TtsSynthesizeOptions): Promise<TtsResult>;
}

export interface Providers {
  llmCreative: LlmProvider;
  llmFast: LlmProvider;
  image: ImageProvider;
  video: VideoProvider;
  tts: TtsProvider;
}
