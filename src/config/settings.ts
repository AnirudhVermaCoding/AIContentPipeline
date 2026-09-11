import type { BrandProfile, ProviderChoice } from "../brand/schema.js";
import type { ProviderSnapshot } from "../schema/manifest.js";

/**
 * Global provider defaults. Pipeline logic never names a vendor: it asks the registry for the
 * capability configured here (overridable per brand, then by CLI flags).
 */
export interface ProviderSettings {
  llm_creative: ProviderChoice;
  llm_fast: ProviderChoice;
  image: ProviderChoice;
  video: ProviderChoice;
  tts: ProviderChoice;
}

export const DEFAULT_PROVIDERS: ProviderSettings = {
  llm_creative: {
    provider: "openai",
    model: "gpt-5.6-terra",
    options: { reasoningEffort: "medium" },
  },
  llm_fast: {
    provider: "openai",
    model: "gpt-5.6-luna",
    options: { reasoningEffort: "low" },
  },
  image: {
    provider: "fal",
    model: "fal-ai/flux-2-pro",
    options: { editModel: "fal-ai/flux-2-pro/edit" },
  },
  video: {
    provider: "fal",
    model: "minimax/h3-max/image-to-video",
    options: { resolution: "768P", promptExpansionMode: "balanced" },
  },
  tts: {
    provider: "cartesia",
    model: "sonic-3.5",
    options: {},
  },
};

export interface ProviderOverrides {
  llm_creative?: Partial<ProviderChoice>;
  llm_fast?: Partial<ProviderChoice>;
  image?: Partial<ProviderChoice>;
  video?: Partial<ProviderChoice>;
  tts?: Partial<ProviderChoice>;
}

function merge(base: ProviderChoice, over?: Partial<ProviderChoice>): ProviderChoice {
  if (!over) return base;
  return {
    provider: over.provider ?? base.provider,
    model: over.model ?? base.model,
    options: { ...base.options, ...(over.options ?? {}) },
  };
}

/** defaults ← brand.providers ← explicit overrides (CLI). */
export function resolveProviders(
  brand: BrandProfile,
  overrides: ProviderOverrides = {},
): ProviderSettings {
  const brandTts: Partial<ProviderChoice> = {
    provider: brand.voice.provider,
    ...(brand.voice.model ? { model: brand.voice.model } : {}),
  };
  return {
    llm_creative: merge(
      merge(DEFAULT_PROVIDERS.llm_creative, brand.providers.llm_creative),
      overrides.llm_creative,
    ),
    llm_fast: merge(
      merge(DEFAULT_PROVIDERS.llm_fast, brand.providers.llm_fast),
      overrides.llm_fast,
    ),
    image: merge(merge(DEFAULT_PROVIDERS.image, brand.providers.image), overrides.image),
    video: merge(merge(DEFAULT_PROVIDERS.video, brand.providers.video), overrides.video),
    tts: merge(merge(merge(DEFAULT_PROVIDERS.tts, brandTts), brand.providers.tts), overrides.tts),
  };
}

export function snapshotProviders(p: ProviderSettings): ProviderSnapshot {
  return {
    llm_creative: { provider: p.llm_creative.provider, model: p.llm_creative.model },
    llm_fast: { provider: p.llm_fast.provider, model: p.llm_fast.model },
    image: { provider: p.image.provider, model: p.image.model },
    video: { provider: p.video.provider, model: p.video.model },
    tts: { provider: p.tts.provider, model: p.tts.model },
  };
}
