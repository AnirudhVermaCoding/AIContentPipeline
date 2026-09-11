import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type ModelMessage, Output, stepCountIs } from "ai";
import { llmCost } from "../../config/pricing.js";
import { ProviderError, SafetyRejectionError, ValidationError } from "../../util/errors.js";
import { withRetry } from "../../util/retry.js";
import type { LlmGenerateOptions, LlmProvider, LlmResult } from "../types.js";

export interface OpenAiLlmOptions {
  model: string;
  apiKey: string;
  reasoningEffort?: string;
  /** Default false for creative work: allow the schema to be validated by zod, not OpenAI strict mode. */
  strictJsonSchema?: boolean;
}

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
};

function toUsage(u: Usage) {
  return {
    inputTokens: u.inputTokens ?? 0,
    cachedInputTokens: u.inputTokenDetails?.cacheReadTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    reasoningTokens: u.outputTokenDetails?.reasoningTokens ?? 0,
  };
}

/**
 * OpenAI adapter on the AI SDK (Responses API). Structured output through `Output.object`,
 * vision through file parts, web search through the provider tool (two-pass: search freely,
 * then structure the findings — adapted from OpenReels' BaseLLM).
 */
export class OpenAiLlm implements LlmProvider {
  readonly id = "openai";
  readonly model: string;
  private readonly provider;
  private readonly reasoningEffort: string | undefined;
  private readonly strict: boolean;

  constructor(opts: OpenAiLlmOptions) {
    this.model = opts.model;
    this.provider = createOpenAI({ apiKey: opts.apiKey });
    this.reasoningEffort = opts.reasoningEffort;
    this.strict = opts.strictJsonSchema ?? false;
  }

  private providerOptions() {
    return {
      openai: {
        ...(this.reasoningEffort ? { reasoningEffort: this.reasoningEffort } : {}),
        strictJsonSchema: this.strict,
      },
    };
  }

  private userMessage<T>(opts: LlmGenerateOptions<T>): ModelMessage {
    if (!opts.images || opts.images.length === 0) {
      return { role: "user", content: opts.prompt };
    }
    return {
      role: "user",
      content: [
        { type: "text", text: opts.prompt },
        ...opts.images.map((img) => ({
          type: "file" as const,
          mediaType: img.mediaType,
          data: img.data,
        })),
      ],
    };
  }

  async generate<T>(opts: LlmGenerateOptions<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    const label = opts.label ?? "llm";
    const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
    const add = (u: Usage) => {
      const x = toUsage(u);
      usage.inputTokens += x.inputTokens;
      usage.cachedInputTokens += x.cachedInputTokens;
      usage.outputTokens += x.outputTokens;
      usage.reasoningTokens += x.reasoningTokens;
    };

    let researchText: string | null = null;
    if (opts.webSearch) {
      // Pass 1: free-form with the web search tool.
      const pass1 = await withRetry(
        (signal) =>
          generateText({
            model: this.provider(this.model),
            instructions: opts.instructions,
            messages: [this.userMessage(opts)],
            tools: { web_search: this.provider.tools.webSearch({}) },
            stopWhen: stepCountIs(6),
            providerOptions: this.providerOptions(),
            abortSignal: opts.signal ?? signal,
          }),
        { attempts: 3, timeoutMs: 240_000, label: `${label}:search` },
      ).catch((err) => {
        throw this.wrap(err);
      });
      add(pass1.usage as Usage);
      researchText = pass1.text;
    }

    const instructions = researchText
      ? `${opts.instructions}\n\nYou already researched this. Use only the findings below to produce the structured answer.`
      : opts.instructions;
    const message: ModelMessage = researchText
      ? { role: "user", content: `${opts.prompt}\n\n## Research findings\n${researchText}` }
      : this.userMessage(opts);

    const result = await withRetry(
      (signal) =>
        generateText({
          model: this.provider(this.model),
          instructions,
          messages: [message],
          output: Output.object({ schema: opts.schema }),
          providerOptions: this.providerOptions(),
          abortSignal: opts.signal ?? signal,
        }),
      { attempts: 3, timeoutMs: 240_000, label },
    ).catch((err) => {
      throw this.wrap(err);
    });
    add(result.usage as Usage);
    const requestId = (result.response as { id?: string } | undefined)?.id ?? null;
    // The model was billed for this response even if we reject it below.
    const charged = {
      costUsd: llmCost(this.id, this.model, usage),
      usage: { ...usage },
      requestId,
    };
    const data = result.output as T | undefined;
    if (data == null) {
      throw new ValidationError(`${label}: model returned no structured output`, [], { charged });
    }
    const parsed = opts.schema.safeParse(data);
    if (!parsed.success) {
      throw new ValidationError(
        `${label}: structured output failed validation`,
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        { charged },
      );
    }
    return {
      data: parsed.data,
      usage,
      provider: this.id,
      model: this.model,
      latencyMs: Date.now() - started,
      costUsd: charged.costUsd,
      costSource: "CALCULATED_FROM_USAGE",
      requestId,
    };
  }

  private wrap(err: unknown): Error {
    if (err instanceof ProviderError || err instanceof ValidationError) return err;
    const e = err as { message?: string; statusCode?: number; status?: number; name?: string };
    const msg = e.message ?? String(err);
    const status = e.statusCode ?? e.status;
    if (/content_policy|safety|refus/i.test(msg))
      return new SafetyRejectionError(this.id, msg, err);
    const retryable =
      status === undefined
        ? /timeout|abort|ECONN|fetch failed/i.test(msg)
        : status === 429 || status >= 500;
    return new ProviderError(this.id, msg, { cause: err, retryable, status });
  }
}
