import type { z } from "zod";
import type { LlmUsage } from "../config/pricing.js";
import type { WordTimestamp } from "../schema/voice.js";

/**
 * Vendor-neutral capability interfaces. Stages only ever talk to these; concrete adapters live
 * in providers/<capability>/ and are chosen by configuration through the registry.
 */

/**
 * Where a cost figure comes from. Every ledger row and every number the UI shows carries one:
 * PROVIDER_REPORTED = the vendor returned a billed amount; CALCULATED_FROM_USAGE = exact usage
 * units the vendor returned priced with our versioned table; ESTIMATED = nothing happened yet.
 */
export type CostSource = "PROVIDER_REPORTED" | "CALCULATED_FROM_USAGE" | "ESTIMATED";

/** Usage units in one normalised shape for the ledger, whatever the capability. */
export interface NormalizedUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  image_count?: number;
  video_seconds?: number;
  audio_characters?: number;
  audio_seconds?: number;
}

export interface CallMeta {
  provider: string;
  model: string;
  latencyMs: number;
  costUsd: number;
  /** Defaults to CALCULATED_FROM_USAGE when the adapter priced real usage locally. */
  costSource?: CostSource;
  /** Only when the vendor itself reported a billed amount. */
  providerCostUsd?: number | null;
  /** Vendor request / response id when available (fal request id, OpenAI response id). */
  requestId?: string | null;
}

/** Live progress of a queued generation, as the vendor reports it (never a fake percentage). */
export interface GenerationStatusUpdate {
  status: "queued" | "in_progress" | "completed";
  queuePosition?: number | null;
  message?: string;
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
  onStatus?: (update: GenerationStatusUpdate) => void;
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
  onStatus?: (update: GenerationStatusUpdate) => void;
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
