import type { z } from "zod";
import { llmEstimate } from "../config/pricing.js";
import { paidCall } from "../pipeline/paid.js";
import type { RunContext } from "../pipeline/run.js";
import type { LlmImageInput, LlmProvider } from "../providers/types.js";
import { errorMessage, ValidationError } from "../util/errors.js";
import { loadPrompt } from "./prompts.js";

export interface AgentCall<T> {
  /** Prompt file name in prompts/ (also the ledger label). */
  name: string;
  /** Which model tier does the work. */
  tier: "creative" | "fast";
  schema: z.ZodType<T>;
  userMessage: string;
  stageId: string;
  shotId?: string | null;
  webSearch?: boolean;
  images?: LlmImageInput[];
  /** Semantic checks beyond the schema; returned issues are fed back and the call retried. */
  validate?: (data: T) => string[];
  maxAttempts?: number;
  /** Extra label suffix for per-shot calls, e.g. shot id. */
  labelSuffix?: string;
  expectedOutputTokens?: number;
}

export interface AgentResult<T> {
  data: T;
  costUsd: number;
  attempts: number;
  promptVersion: string;
}

/**
 * Run one agent: load its versioned prompt, call the configured LLM through the paid-call ledger,
 * validate, and on validation failure retry with the issues fed back (bounded).
 */
export async function callAgent<T>(run: RunContext, call: AgentCall<T>): Promise<AgentResult<T>> {
  const prompt = loadPrompt(call.name);
  const llm: LlmProvider =
    call.tier === "creative" ? run.providers.llmCreative : run.providers.llmFast;
  const maxAttempts = call.maxAttempts ?? 3;
  const label = call.labelSuffix ? `${call.name}:${call.labelSuffix}` : call.name;
  let feedback = "";
  let totalCost = 0;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const userMessage = feedback ? `${call.userMessage}\n\n${feedback}` : call.userMessage;
    const inputTokens = Math.ceil((prompt.text.length + userMessage.length) / 4) + 300;
    const outputTokens = call.expectedOutputTokens ?? (call.tier === "creative" ? 2500 : 900);
    try {
      const result = await paidCall(
        run,
        {
          stageId: call.stageId,
          shotId: call.shotId ?? null,
          kind: "llm",
          provider: llm.id,
          model: llm.model,
          label,
          estimateUsd:
            llmEstimate(llm.id, llm.model, inputTokens, outputTokens) * (call.webSearch ? 3 : 1),
          prompt: userMessage,
          promptVersion: prompt.version,
        },
        () =>
          llm.generate<T>({
            instructions: prompt.text,
            prompt: userMessage,
            schema: call.schema,
            images: call.images,
            webSearch: call.webSearch,
            label,
          }),
      );
      totalCost += result.costUsd;
      const issues = call.validate ? call.validate(result.data) : [];
      if (issues.length === 0) {
        return {
          data: result.data,
          costUsd: totalCost,
          attempts: attempt,
          promptVersion: prompt.version,
        };
      }
      lastIssues = issues;
      run.events.warn(call.stageId, `${label}: attempt ${attempt} rejected: ${issues.join(" | ")}`);
      feedback = `PREVIOUS ATTEMPT WAS REJECTED. Fix every issue below and return the complete corrected object:\n${issues.map((i) => `- ${i}`).join("\n")}`;
    } catch (err) {
      if (err instanceof ValidationError && attempt < maxAttempts) {
        lastIssues = err.issues;
        run.events.warn(call.stageId, `${label}: attempt ${attempt} invalid: ${errorMessage(err)}`);
        feedback = `PREVIOUS ATTEMPT DID NOT MATCH THE REQUIRED FORMAT:\n${err.issues.map((i) => `- ${i}`).join("\n")}\nReturn the complete corrected object.`;
        continue;
      }
      throw err;
    }
  }
  throw new ValidationError(`${label}: rejected after ${maxAttempts} attempts`, lastIssues);
}
