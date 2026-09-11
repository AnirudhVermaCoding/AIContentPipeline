import * as fs from "node:fs";
import * as path from "node:path";
import { llmCost } from "../../config/pricing.js";
import { ValidationError } from "../../util/errors.js";
import type { LlmGenerateOptions, LlmProvider, LlmResult } from "../types.js";

export type FixtureResolver = (label: string, prompt: string) => unknown | undefined;

/**
 * Offline LLM: answers from JSON fixtures keyed by the call label. The fixture must satisfy the
 * caller's schema, so mock runs exercise the same validation as live runs. Usage is fixed so the
 * cost report is deterministic (prices come from the configured model).
 */
export class MockLlm implements LlmProvider {
  readonly id: string;
  readonly model: string;
  private readonly resolvers: FixtureResolver[];

  constructor(opts: { provider: string; model: string; resolvers?: FixtureResolver[] }) {
    this.id = opts.provider;
    this.model = opts.model;
    this.resolvers = opts.resolvers ?? [];
  }

  async generate<T>(opts: LlmGenerateOptions<T>): Promise<LlmResult<T>> {
    const label = opts.label ?? "llm";
    let raw: unknown;
    for (const r of this.resolvers) {
      raw = r(label, opts.prompt);
      if (raw !== undefined) break;
    }
    if (raw === undefined) {
      throw new Error(`MockLlm: no fixture for label "${label}"`);
    }
    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        `MockLlm fixture for "${label}" fails the schema`,
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    }
    const usage = {
      inputTokens: 6000 + Math.round(opts.prompt.length / 4),
      cachedInputTokens: 0,
      outputTokens: 1200,
      reasoningTokens: 0,
    };
    return {
      data: parsed.data,
      usage,
      provider: this.id,
      model: this.model,
      latencyMs: 5,
      costUsd: llmCost(this.id, this.model, usage),
    };
  }
}

/** Resolver that reads `<dir>/<label>.json` (label sanitised) and falls back to base labels. */
export function fileFixtureResolver(dirs: string[]): FixtureResolver {
  return (label) => {
    const candidates = [label, label.replace(/:.*$/, "")];
    for (const dir of dirs) {
      for (const c of candidates) {
        const file = path.join(dir, `${c.replace(/[^a-z0-9_-]/gi, "_")}.json`);
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
      }
    }
    return undefined;
  };
}
