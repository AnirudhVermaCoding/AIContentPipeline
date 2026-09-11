import * as path from "node:path";
import type { ProviderChoice } from "../brand/schema.js";
import { env } from "../config/env.js";
import { hasPricing } from "../config/pricing.js";
import type { ProviderSettings } from "../config/settings.js";
import { FalFlux2Image } from "./image/fal-flux2.js";
import { MockImage } from "./image/mock.js";
import { type FixtureResolver, fileFixtureResolver, MockLlm } from "./llm/mock.js";
import { OpenAiLlm } from "./llm/openai.js";
import { CartesiaTts } from "./tts/cartesia.js";
import { ElevenLabsTts } from "./tts/elevenlabs.js";
import { MockTts } from "./tts/mock.js";
import type { ImageProvider, LlmProvider, Providers, TtsProvider, VideoProvider } from "./types.js";
import { FalMinimaxVideo } from "./video/fal-minimax.js";
import { MockVideo } from "./video/mock.js";

/**
 * Capability registry: which adapters exist, which env keys they need, and how to build them from
 * a ProviderChoice. Adding a vendor means adding an entry here; nothing else in the pipeline
 * changes.
 */
export interface AdapterEntry<T> {
  id: string;
  envKeys: string[];
  build(choice: ProviderChoice): T;
}

const key = (name: string, hint: string): string => {
  const v = env(name);
  if (!v) throw new Error(`Missing ${name}. ${hint}`);
  return v;
};

export const LLM_ADAPTERS: AdapterEntry<LlmProvider>[] = [
  {
    id: "openai",
    envKeys: ["OPENAI_API_KEY"],
    build: (c) =>
      new OpenAiLlm({
        model: c.model,
        apiKey: key("OPENAI_API_KEY", "Create one at https://platform.openai.com/api-keys"),
        reasoningEffort:
          typeof c.options.reasoningEffort === "string" ? c.options.reasoningEffort : undefined,
        strictJsonSchema: c.options.strictJsonSchema === true,
      }),
  },
];

export const IMAGE_ADAPTERS: AdapterEntry<ImageProvider>[] = [
  {
    id: "fal",
    envKeys: ["FAL_KEY"],
    build: (c) =>
      new FalFlux2Image({
        apiKey: key("FAL_KEY", "Create one at https://fal.ai/dashboard/keys"),
        model: c.model,
        editModel: typeof c.options.editModel === "string" ? c.options.editModel : undefined,
      }),
  },
];

export const VIDEO_ADAPTERS: AdapterEntry<VideoProvider>[] = [
  {
    id: "fal",
    envKeys: ["FAL_KEY"],
    build: (c) =>
      new FalMinimaxVideo({
        apiKey: key("FAL_KEY", "Create one at https://fal.ai/dashboard/keys"),
        model: c.model,
        resolution: typeof c.options.resolution === "string" ? c.options.resolution : undefined,
        promptExpansionMode:
          typeof c.options.promptExpansionMode === "string"
            ? c.options.promptExpansionMode
            : undefined,
      }),
  },
];

export const TTS_ADAPTERS: AdapterEntry<TtsProvider>[] = [
  {
    id: "cartesia",
    envKeys: ["CARTESIA_API_KEY"],
    build: (c) =>
      new CartesiaTts({
        apiKey: key("CARTESIA_API_KEY", "Create one at https://play.cartesia.ai/keys"),
        model: c.model,
      }),
  },
  {
    id: "elevenlabs",
    envKeys: ["ELEVENLABS_API_KEY"],
    build: (c) =>
      new ElevenLabsTts({
        apiKey: key("ELEVENLABS_API_KEY", "Create one at https://elevenlabs.io"),
        model: c.model,
      }),
  },
];

function pick<T>(kind: string, adapters: AdapterEntry<T>[], choice: ProviderChoice): T {
  const entry = adapters.find((a) => a.id === choice.provider);
  if (!entry) {
    throw new Error(
      `No ${kind} adapter "${choice.provider}". Known: ${adapters.map((a) => a.id).join(", ")}`,
    );
  }
  return entry.build(choice);
}

export interface BuildOptions {
  mode: "live" | "mock";
  fixtureDirs?: string[];
  fixtureResolvers?: FixtureResolver[];
  mockImageColor?: string;
}

export function buildProviders(settings: ProviderSettings, opts: BuildOptions): Providers {
  if (opts.mode === "mock") {
    const resolvers: FixtureResolver[] = [
      ...(opts.fixtureResolvers ?? []),
      fileFixtureResolver(opts.fixtureDirs ?? [path.resolve("test/fixtures/llm")]),
    ];
    return {
      llmCreative: new MockLlm({
        provider: settings.llm_creative.provider,
        model: settings.llm_creative.model,
        resolvers,
      }),
      llmFast: new MockLlm({
        provider: settings.llm_fast.provider,
        model: settings.llm_fast.model,
        resolvers,
      }),
      image: new MockImage({
        provider: settings.image.provider,
        model: settings.image.model,
        editModel:
          typeof settings.image.options.editModel === "string"
            ? settings.image.options.editModel
            : undefined,
        color: opts.mockImageColor,
      }),
      video: new MockVideo({
        provider: settings.video.provider,
        model: settings.video.model,
        resolution:
          typeof settings.video.options.resolution === "string"
            ? settings.video.options.resolution
            : undefined,
      }),
      tts: new MockTts({ provider: settings.tts.provider, model: settings.tts.model }),
    };
  }
  return {
    llmCreative: pick("llm", LLM_ADAPTERS, settings.llm_creative),
    llmFast: pick("llm", LLM_ADAPTERS, settings.llm_fast),
    image: pick("image", IMAGE_ADAPTERS, settings.image),
    video: pick("video", VIDEO_ADAPTERS, settings.video),
    tts: pick("tts", TTS_ADAPTERS, settings.tts),
  };
}

export interface EnvCheck {
  ok: boolean;
  missing: Array<{ capability: string; provider: string; envKey: string }>;
  unpriced: Array<{ capability: string; provider: string; model: string }>;
}

/** Report which keys are missing for the selected providers (live mode) and which models lack prices. */
export function checkProviders(settings: ProviderSettings): EnvCheck {
  const missing: EnvCheck["missing"] = [];
  const unpriced: EnvCheck["unpriced"] = [];
  const table: Array<
    [string, ProviderChoice, AdapterEntry<unknown>[], "llm" | "image" | "video" | "tts"]
  > = [
    ["llm_creative", settings.llm_creative, LLM_ADAPTERS, "llm"],
    ["llm_fast", settings.llm_fast, LLM_ADAPTERS, "llm"],
    ["image", settings.image, IMAGE_ADAPTERS, "image"],
    ["video", settings.video, VIDEO_ADAPTERS, "video"],
    ["tts", settings.tts, TTS_ADAPTERS, "tts"],
  ];
  for (const [capability, choice, adapters, kind] of table) {
    const entry = adapters.find((a) => a.id === choice.provider);
    for (const k of entry?.envKeys ?? []) {
      if (!env(k)) missing.push({ capability, provider: choice.provider, envKey: k });
    }
    if (!hasPricing(kind, choice.provider, choice.model)) {
      unpriced.push({ capability, provider: choice.provider, model: choice.model });
    }
  }
  return { ok: missing.length === 0, missing, unpriced };
}
