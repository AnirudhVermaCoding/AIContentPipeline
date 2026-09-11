import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, openDb } from "../db/sqlite.js";
import { type FixtureResolver, fileFixtureResolver } from "../providers/llm/mock.js";
import { buildProviders } from "../providers/registry.js";
import { ContinuityBibleSchema } from "../schema/continuity.js";
import { RoutingPlanSchema } from "../schema/routing.js";
import { StoryboardArtifactSchema } from "../schema/storyboard.js";
import { RunInterruptedError, ValidationError } from "../util/errors.js";
import { writeJsonAtomic } from "../util/fs.js";
import { paidCall } from "./paid.js";
import { createRun, openRun, type RunControl } from "./run.js";
import { resetFrom, runStages } from "./runner.js";
import {
  computeShotHash,
  loadOrResetShot,
  nextAttemptNumber,
  saveShotRecord,
  shotDir,
} from "./shots.js";
import type { StageDef } from "./stage.js";
import { mergeContinuity } from "./stages/05-continuity.js";
import { PLANNING_STAGES } from "./stages/index.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicp-control-"));
const fixtures = path.resolve("test/fixtures/llm");

beforeAll(() => {
  process.env.AICP_RUNS_DIR = path.join(tmp, "runs");
  process.env.AICP_DATA_DIR = path.join(tmp, "data");
});

afterAll(() => {
  closeDb();
  delete process.env.AICP_BRANDS_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const options = {
  provider_mode: "mock" as const,
  approve_keyframes: false,
  budget_override_usd: null,
  ai_video_seconds_override: null,
  until: null,
  dry_run: false,
};

function makeStages(
  counter: Record<string, number>,
  body?: Partial<Record<string, StageDef["run"]>>,
) {
  const mk = (id: string, dir: string, dependsOn: string[]): StageDef => ({
    id,
    version: "1",
    dir,
    dependsOn,
    async run(ctx) {
      counter[id] = (counter[id] ?? 0) + 1;
      const custom = body?.[id];
      if (custom) return custom(ctx);
      ctx.writeOutput({ value: id });
      return { status: "done" };
    },
  });
  return [mk("a", "00_a", []), mk("b", "01_b", ["a"]), mk("c", "02_c", ["b"])];
}

describe("pause and cancel checkpoints", () => {
  it("pauses between stages without marking anything failed, then resumes", async () => {
    const counter: Record<string, number> = {};
    const run = createRun({ brandId: "bachalogy", topic: "t", options, quiet: true });
    const control: RunControl = {
      checkpoint(at) {
        if (at === "before b") throw new RunInterruptedError("paused", at);
      },
    };
    run.control = control;
    const r1 = await runStages(run, makeStages(counter));
    expect(r1.status).toBe("stopped");
    expect(run.manifest.status).toBe("stopped");
    expect(run.manifest.stop_reason).toBe("paused");
    expect(run.manifest.stages.a?.status).toBe("done");
    expect(run.manifest.stages.b?.status).toBe("pending");
    expect(counter).toEqual({ a: 1 });

    const resumed = openRun(run.runId, { quiet: true });
    const r2 = await runStages(resumed, makeStages(counter));
    expect(r2.status).toBe("done");
    expect(resumed.manifest.stop_reason).toBeNull();
    expect(counter).toEqual({ a: 1, b: 1, c: 1 });
  });

  it("cancels before a paid call: stage stays pending, nothing reserved, resume completes", async () => {
    const counter: Record<string, number> = {};
    const run = createRun({ brandId: "bachalogy", topic: "t", options, quiet: true });
    let cancel = true;
    run.control = {
      checkpoint(at) {
        if (cancel && at.startsWith("before b-call"))
          throw new RunInterruptedError("cancelled", at);
      },
    };
    const stages = () =>
      makeStages(counter, {
        b: async (ctx) => {
          await paidCall(
            ctx.run,
            {
              stageId: "b",
              kind: "llm",
              provider: "openai",
              model: "gpt-5.6-luna",
              label: "b-call",
              estimateUsd: 0.01,
            },
            async () => ({
              provider: "openai",
              model: "gpt-5.6-luna",
              latencyMs: 1,
              costUsd: 0.004,
            }),
          );
          ctx.writeOutput({ value: "b" });
          return { status: "done" };
        },
      });
    const r1 = await runStages(run, stages());
    expect(r1.status).toBe("stopped");
    expect(run.manifest.stop_reason).toBe("cancelled");
    expect(run.manifest.stages.b?.status).toBe("pending");
    expect(run.manifest.stages.b?.error).toBeNull();
    expect(run.repos.listGenerations(run.runId)).toHaveLength(0);

    cancel = false;
    const resumed = openRun(run.runId, { quiet: true });
    const r2 = await runStages(resumed, stages());
    expect(r2.status).toBe("done");
    const gens = resumed.repos.listGenerations(run.runId);
    expect(gens).toHaveLength(1);
    expect(gens[0]?.status).toBe("completed");
    expect(gens[0]?.actual_cost_usd).toBeCloseTo(0.004, 6);
    expect(gens[0]?.cost_source).toBe("CALCULATED_FROM_USAGE");
    expect(gens[0]?.pricing_version).toBeTruthy();
    expect(gens[0]?.started_at).toBeTruthy();
    expect(gens[0]?.completed_at).toBeTruthy();
    expect(counter.b).toBe(2);
  });
});

describe("ledger accounting", () => {
  it("keeps what the vendor charged for a failed call and books it as spend", async () => {
    const counter: Record<string, number> = {};
    const run = createRun({ brandId: "bachalogy", topic: "t", options, quiet: true });
    const stages = makeStages(counter, {
      b: async (ctx) => {
        await paidCall(
          ctx.run,
          {
            stageId: "b",
            kind: "llm",
            provider: "openai",
            model: "gpt-5.6-terra",
            label: "billed-but-invalid",
            estimateUsd: 0.02,
          },
          async () => {
            throw new ValidationError("schema mismatch", ["x"], {
              charged: { costUsd: 0.05, usage: { inputTokens: 10 }, requestId: "resp_1" },
            });
          },
        ).catch(() => undefined);
        await paidCall(
          ctx.run,
          {
            stageId: "b",
            kind: "image",
            provider: "fal",
            model: "fal-ai/flux-2-pro",
            label: "network-failure",
            estimateUsd: 0.03,
          },
          async () => {
            throw new Error("ECONNRESET");
          },
        ).catch(() => undefined);
        ctx.writeOutput({ value: "b" });
        return { status: "done" };
      },
    });
    const r = await runStages(run, stages);
    expect(r.status).toBe("done");
    const gens = run.repos.listGenerations(run.runId);
    expect(gens).toHaveLength(2);
    expect(gens[0]?.status).toBe("failed");
    expect(gens[0]?.actual_cost_usd).toBeCloseTo(0.05, 6);
    expect(gens[0]?.request_id).toBe("resp_1");
    expect(gens[1]?.status).toBe("failed");
    expect(gens[1]?.actual_cost_usd).toBe(0);
    expect(run.budget.spentUsd).toBeCloseTo(0.05, 6);
    expect(run.repos.spentForRun(run.runId)).toBeCloseTo(0.05, 6);
    const spend = openDb()
      .prepare(`SELECT amount_usd, note FROM budget_ledger WHERE run_id = ? AND kind = 'spend'`)
      .all(run.runId) as Array<{ amount_usd: number; note: string | null }>;
    expect(spend).toHaveLength(1);
    expect(spend[0]?.amount_usd).toBeCloseTo(0.05, 6);
    expect(spend[0]?.note).toMatch(/charged although/);
    expect(run.manifest.stages.b?.cost_usd).toBeCloseTo(0.05, 6);
  });
});

describe("shot versions", () => {
  it("never reuses a version number after a hash reset", () => {
    const run = createRun({ brandId: "bachalogy", topic: "t", options, quiet: true });
    const dir = shotDir(run, "shot_01");
    fs.writeFileSync(path.join(dir, "keyframe_v1.png"), "x");
    fs.writeFileSync(path.join(dir, "keyframe_v2.png"), "x");
    expect(nextAttemptNumber(run, "shot_01", "keyframe", null)).toBe(3);
    expect(nextAttemptNumber(run, "shot_01", "video", null)).toBe(1);
    const first = loadOrResetShot(run, "shot_01", "hash-a", "STILL");
    expect(first.reused).toBe(false);
    first.record.attempts.push({
      kind: "keyframe",
      attempt: 5,
      provider: "fal",
      model: "m",
      prompt: "p",
      prompt_version: "1",
      refs: [],
      params: {},
      latency_ms: 1,
      cost_usd: 0,
      status: "failed",
      error: "boom",
      path: null,
      checks: [],
    });
    saveShotRecord(run, first.record);
    expect(nextAttemptNumber(run, "shot_01", "keyframe", first.record)).toBe(6);
    const reset = loadOrResetShot(run, "shot_01", "hash-b", "STILL");
    expect(reset.reused).toBe(false);
    expect(reset.record.attempts).toHaveLength(0);
    const history = fs.readdirSync(path.join(dir, "history"));
    expect(history).toHaveLength(1);
    // Files on disk and archived attempts still count.
    expect(nextAttemptNumber(run, "shot_01", "keyframe", reset.record)).toBe(6);
    expect(fs.existsSync(path.join(dir, "keyframe_v1.png"))).toBe(true);
  });
});

describe("brand snapshot pinning", () => {
  it("keeps the brand version a run was created with unless the operator adopts the live file", () => {
    const brands = path.join(tmp, "brands-pin");
    fs.mkdirSync(path.join(brands, "bachalogy"), { recursive: true });
    const file = path.join(brands, "bachalogy", "brand.yaml");
    fs.copyFileSync(path.resolve("brands/bachalogy/brand.yaml"), file);
    process.env.AICP_BRANDS_DIR = brands;
    try {
      const run = createRun({
        brandId: "bachalogy",
        topic: "t",
        options: { ...options, brand_source: "snapshot" },
        quiet: true,
        createdBy: "studio",
      });
      const original = run.manifest.brand_config_version;
      expect(fs.existsSync(path.join(run.runDir, "brand.snapshot.json"))).toBe(true);
      fs.writeFileSync(
        file,
        fs.readFileSync(file, "utf8").replace("Toys that grow with the play", "Edited tagline"),
      );

      const pinned = openRun(run.runId, { quiet: true });
      expect(pinned.manifest.brand_config_version).toBe(original);
      expect(pinned.brand.profile.tagline).toBe("Toys that grow with the play");

      const live = openRun(run.runId, { quiet: true, brandSource: "live" });
      expect(live.manifest.brand_config_version).not.toBe(original);
      expect(live.brand.profile.tagline).toBe("Edited tagline");
    } finally {
      delete process.env.AICP_BRANDS_DIR;
    }
  });
});

describe("continuity preserve-unchanged merge", () => {
  it("restores locks, style and unchanged per-shot entries (unit)", () => {
    const base = ContinuityBibleSchema.parse(
      JSON.parse(
        fs.readFileSync(path.join(fixtures, "bachalogy/continuity-controller.json"), "utf8"),
      ),
    );
    const fresh = {
      ...base,
      style_bible: `${base.style_bible} rewritten`,
      locks: { ...base.locks, lighting: "different" },
      per_shot: base.per_shot.map((p) => ({ ...p, notes: `${p.notes} rewritten` })),
    };
    const hashes = Object.fromEntries(base.per_shot.map((p) => [p.shot_id, "same"]));
    const changed = { ...hashes, shot_02: "changed" };
    const allRefs = new Set(base.per_shot.flatMap((p) => p.reference_images));
    const { bible, preservedShots } = mergeContinuity(base, fresh, hashes, changed, true, allRefs);
    expect(bible.style_bible).toBe(base.style_bible);
    expect(bible.locks.lighting).toBe(base.locks.lighting);
    expect(preservedShots).not.toContain("shot_02");
    expect(bible.per_shot.find((p) => p.shot_id === "shot_01")?.notes).toBe(
      base.per_shot.find((p) => p.shot_id === "shot_01")?.notes,
    );
    expect(bible.per_shot.find((p) => p.shot_id === "shot_02")?.notes).toMatch(/rewritten$/);
    const differentEntities = mergeContinuity(base, fresh, hashes, changed, false, allRefs);
    expect(differentEntities.bible.style_bible).toMatch(/rewritten$/);
  });

  it("keeps unchanged shot hashes stable after a storyboard edit (planning stages, mock)", async () => {
    const run = createRun({ brandId: "bachalogy", topic: "first steps", options, quiet: true });
    let continuityCalls = 0;
    const rewriting: FixtureResolver = (label) => {
      if (label !== "continuity-controller") return undefined;
      continuityCalls += 1;
      if (continuityCalls < 2) return undefined;
      const base = JSON.parse(
        fs.readFileSync(path.join(fixtures, "bachalogy/continuity-controller.json"), "utf8"),
      );
      return {
        ...base,
        style_bible: `${base.style_bible} Rewritten by a second call.`,
        locks: { ...base.locks, lighting: `${base.locks.lighting}, altered` },
        per_shot: base.per_shot.map((p: { notes: string }) => ({
          ...p,
          notes: `${p.notes} altered`,
        })),
      };
    };
    run.providers = buildProviders(run.providerSettings, {
      mode: "mock",
      fixtureResolvers: [
        rewriting,
        fileFixtureResolver([path.join(fixtures, "bachalogy"), fixtures]),
      ],
    });
    const r1 = await runStages(run, PLANNING_STAGES);
    expect(r1.status).toBe("done");
    const sb = run.readOutput("04_storyboard", StoryboardArtifactSchema);
    const cont1 = run.readOutput("05_continuity", ContinuityBibleSchema);
    const plan1 = run.readOutput("06_route", RoutingPlanSchema);
    const routeOf = (plan: typeof plan1, id: string) => {
      const r = plan.shots.find((s) => s.shot_id === id);
      if (!r) throw new Error(id);
      return r;
    };
    const hashesBefore = Object.fromEntries(
      sb.shots.map((s) => [s.id, computeShotHash(run, s, cont1, routeOf(plan1, s.id))]),
    );

    // Operator edits one shot's description.
    const edited = structuredClone(sb);
    const second = edited.shots[1];
    if (!second) throw new Error("need shot_02");
    second.description = `${second.description} A red wooden ball rests beside the tiles.`;
    writeJsonAtomic(run.outputPath("04_storyboard"), edited);
    resetFrom(run, PLANNING_STAGES, "continuity");

    const r2 = await runStages(run, PLANNING_STAGES);
    expect(r2.status).toBe("done");
    expect(continuityCalls).toBe(2);
    const cont2 = run.readOutput("05_continuity", ContinuityBibleSchema);
    const plan2 = run.readOutput("06_route", RoutingPlanSchema);
    expect(cont2.style_bible).toBe(cont1.style_bible);
    expect(cont2.locks).toEqual(cont1.locks);
    const sb2 = run.readOutput("04_storyboard", StoryboardArtifactSchema);
    for (const s of sb2.shots) {
      const h = computeShotHash(run, s, cont2, routeOf(plan2, s.id));
      if (s.id === "shot_02") expect(h).not.toBe(hashesBefore[s.id]);
      else expect(h).toBe(hashesBefore[s.id]);
    }
    expect(cont2.per_shot.find((p) => p.shot_id === "shot_02")?.notes).toMatch(/altered$/);
  }, 120_000);
});
