/**
 * The single versioned price table (USD, regular list prices; promotions excluded).
 * Keys are `${provider}:${model}`. Every estimate and every ledger row reads from here.
 */
export const PRICING_AS_OF = "2026-09-11";
const STALE_AFTER_DAYS = 60;

export interface LlmPrice {
  input_per_m: number;
  cached_input_per_m: number;
  output_per_m: number;
  note?: string;
}

export interface ImagePrice {
  /** Price for the first megapixel of output. */
  first_megapixel: number;
  /** Price per additional output megapixel. */
  extra_megapixel: number;
  /** Price per megapixel of reference (input) image, if the endpoint bills inputs. */
  input_megapixel: number;
}

export interface VideoPrice {
  per_second: Record<string, number>;
  default_resolution: string;
}

export interface TtsPrice {
  per_character: number;
}

export const PRICING = {
  llm: {
    "openai:gpt-5.6-terra": {
      input_per_m: 2,
      cached_input_per_m: 0.2,
      output_per_m: 12,
      note: "cached input assumed at 10% of input",
    },
    "openai:gpt-5.6-luna": {
      input_per_m: 0.2,
      cached_input_per_m: 0.02,
      output_per_m: 1.2,
      note: "cached input assumed at 10% of input",
    },
  } as Record<string, LlmPrice>,
  image: {
    "fal:fal-ai/flux-2-pro": { first_megapixel: 0.03, extra_megapixel: 0.015, input_megapixel: 0 },
    "fal:fal-ai/flux-2-pro/edit": {
      first_megapixel: 0.03,
      extra_megapixel: 0.015,
      input_megapixel: 0.015,
    },
    "fal:fal-ai/flux-2": { first_megapixel: 0.012, extra_megapixel: 0.012, input_megapixel: 0 },
  } as Record<string, ImagePrice>,
  video: {
    "fal:minimax/h3-max/image-to-video": {
      per_second: { "480P": 0.05, "768P": 0.08, "1080P": 0.16 },
      default_resolution: "768P",
    },
    "fal:minimax/h3/image-to-video": {
      per_second: { "480P": 0.05, "768P": 0.06 },
      default_resolution: "768P",
    },
    "fal:minimax/h3-max/reference-to-video": {
      per_second: { "480P": 0.05, "768P": 0.08, "1080P": 0.16 },
      default_resolution: "768P",
    },
  } as Record<string, VideoPrice>,
  tts: {
    "cartesia:sonic-3.5": { per_character: 50 / 1_000_000 },
    "cartesia:sonic-3": { per_character: 50 / 1_000_000 },
    "elevenlabs:eleven_multilingual_v2": { per_character: 0.00018 },
    "elevenlabs:eleven_v3": { per_character: 0.00018 },
  } as Record<string, TtsPrice>,
};

const key = (provider: string, model: string) => `${provider}:${model}`;

export function pricingIsStale(now = new Date()): boolean {
  const asOf = new Date(PRICING_AS_OF).getTime();
  return (now.getTime() - asOf) / 86_400_000 > STALE_AFTER_DAYS;
}

export interface LlmUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export function llmCost(provider: string, model: string, usage: LlmUsage): number {
  const p = PRICING.llm[key(provider, model)];
  if (!p) return 0;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (
    (uncached * p.input_per_m +
      usage.cachedInputTokens * p.cached_input_per_m +
      usage.outputTokens * p.output_per_m) /
    1_000_000
  );
}

/** Estimate an LLM call from expected token counts (no cache). */
export function llmEstimate(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  return llmCost(provider, model, {
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    reasoningTokens: 0,
  });
}

export function imageCost(
  provider: string,
  model: string,
  width: number,
  height: number,
  referenceMegapixels = 0,
): number {
  const p = PRICING.image[key(provider, model)];
  if (!p) return 0;
  const mp = (width * height) / 1_000_000;
  const output = p.first_megapixel + Math.max(0, Math.ceil(mp) - 1) * p.extra_megapixel;
  return output + referenceMegapixels * p.input_megapixel;
}

export function videoCost(
  provider: string,
  model: string,
  seconds: number,
  resolution?: string,
): number {
  const p = PRICING.video[key(provider, model)];
  if (!p) return 0;
  const res = resolution ?? p.default_resolution;
  const rate = p.per_second[res] ?? p.per_second[p.default_resolution] ?? 0;
  return seconds * rate;
}

export function ttsCost(provider: string, model: string, characters: number): number {
  const p = PRICING.tts[key(provider, model)];
  if (!p) return 0;
  return characters * p.per_character;
}

export function hasPricing(
  kind: "llm" | "image" | "video" | "tts",
  provider: string,
  model: string,
): boolean {
  return key(provider, model) in PRICING[kind];
}
