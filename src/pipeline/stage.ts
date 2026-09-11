import type { z } from "zod";
import type { RunContext } from "./run.js";

export type StageOutcome =
  | { status: "done" }
  | { status: "waiting_approval"; message: string }
  | {
      status: "budget_conflict";
      message: string;
      alternatives: { description: string; est_total_usd: number; cost_of: string }[];
    };

/**
 * A pipeline stage. `inputs()` returns whatever should invalidate this stage when it changes
 * (upstream stage ids are expanded to their output hashes by the runner). `run()` writes its
 * artifact through `ctx.writeOutput()` and returns an outcome.
 */
export interface StageDef {
  id: string;
  /** Bump when the stage's logic changes in a way that should invalidate old outputs. */
  version: string;
  /** Folder name inside the run dir, e.g. "00_brief". */
  dir: string;
  /** Upstream stage ids whose outputs feed this stage. */
  dependsOn: string[];
  /** Extra values that should invalidate the stage (prompt versions, provider config). */
  extraInputs?: (run: RunContext) => unknown;
  /** True if this stage may spend money on media generation (used by --dry-run). */
  paidMedia?: boolean;
  run(ctx: StageContext): Promise<StageOutcome>;
}

export interface StageContext {
  run: RunContext;
  stage: StageDef;
  stageDir: string;
  /** Write the stage's main artifact (`output.json`). */
  writeOutput<T>(value: T): string;
  /** Read an upstream stage's artifact, validated. */
  input<T>(stageId: string, schema: z.ZodType<T>): T;
  /** Read a file inside the stage dir. */
  file(name: string): string;
}

export interface StageOutputRef {
  path: string;
  hash: string;
}
