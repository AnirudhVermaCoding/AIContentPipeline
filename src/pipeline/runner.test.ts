import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { closeDb } from "../db/sqlite.js";
import { createRun, openRun } from "./run.js";
import { resetFrom, runStages } from "./runner.js";
import type { StageDef } from "./stage.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicp-runner-"));

beforeAll(() => {
  process.env.AICP_RUNS_DIR = path.join(tmp, "runs");
  process.env.AICP_DATA_DIR = path.join(tmp, "data");
});

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const Out = z.object({ value: z.string(), runs: z.number() });

function makeStages(counter: Record<string, number>, failOn?: string): StageDef[] {
  const mk = (id: string, dir: string, dependsOn: string[]): StageDef => ({
    id,
    version: "1",
    dir,
    dependsOn,
    async run(ctx) {
      counter[id] = (counter[id] ?? 0) + 1;
      if (failOn === id && counter[id] === 1) throw new Error(`boom in ${id}`);
      const upstream = dependsOn.map((d) => ctx.input(d, Out).value).join("+");
      ctx.writeOutput({ value: `${id}(${upstream})`, runs: counter[id] });
      return { status: "done" };
    },
  });
  return [mk("a", "00_a", []), mk("b", "01_b", ["a"]), mk("c", "02_c", ["b"])];
}

const options = {
  provider_mode: "mock" as const,
  approve_keyframes: false,
  budget_override_usd: null,
  ai_video_seconds_override: null,
  until: null,
  dry_run: false,
};

describe("stage runner", () => {
  it("runs stages in order, then skips them all on resume", async () => {
    const counter: Record<string, number> = {};
    const run = createRun({ brandId: "bachalogy", topic: "t", options, quiet: true });
    const r1 = await runStages(run, makeStages(counter));
    expect(r1.status).toBe("done");
    expect(counter).toEqual({ a: 1, b: 1, c: 1 });

    const again = openRun(run.runId, { quiet: true });
    const r2 = await runStages(again, makeStages(counter));
    expect(r2.status).toBe("done");
    expect(counter).toEqual({ a: 1, b: 1, c: 1 });
  });

  it("resumes after a failure without re-running earlier stages", async () => {
    const counter: Record<string, number> = {};
    const run = createRun({ brandId: "bachalogy", topic: "t", options, quiet: true });
    const r1 = await runStages(run, makeStages(counter, "c"));
    expect(r1.status).toBe("failed");
    expect(run.manifest.stages.c?.status).toBe("failed");

    const resumed = openRun(run.runId, { quiet: true });
    const r2 = await runStages(resumed, makeStages(counter, "c"));
    expect(r2.status).toBe("done");
    expect(counter).toEqual({ a: 1, b: 1, c: 2 });
  });

  it("re-runs downstream stages when an upstream output changes", async () => {
    const counter: Record<string, number> = {};
    const run = createRun({ brandId: "bachalogy", topic: "t", options, quiet: true });
    await runStages(run, makeStages(counter));
    const reopened = openRun(run.runId, { quiet: true });
    resetFrom(reopened, makeStages(counter), "b");
    await runStages(reopened, makeStages(counter));
    expect(counter).toEqual({ a: 1, b: 2, c: 2 });
    expect(reopened.readOutput("02_c", Out).value).toBe("c(b(a()))");
  });

  it("honours --until", async () => {
    const counter: Record<string, number> = {};
    const run = createRun({
      brandId: "bachalogy",
      topic: "t",
      options: { ...options, until: "b" },
      quiet: true,
    });
    const r = await runStages(run, makeStages(counter));
    expect(r.status).toBe("stopped");
    expect(counter).toEqual({ a: 1, b: 1 });
  });
});
