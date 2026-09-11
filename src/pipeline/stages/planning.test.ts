import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../../db/sqlite.js";
import { buildProviders } from "../../providers/registry.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { RoutingPlanSchema } from "../../schema/routing.js";
import { StoryboardArtifactSchema } from "../../schema/storyboard.js";
import { VoiceResultSchema } from "../../schema/voice.js";
import { createRun } from "../run.js";
import { runStages } from "../runner.js";
import { PLANNING_STAGES } from "./index.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicp-planning-"));
const fixtures = path.resolve("test/fixtures/llm");

beforeAll(() => {
  process.env.AICP_RUNS_DIR = path.join(tmp, "runs");
  process.env.AICP_DATA_DIR = path.join(tmp, "data");
});
afterAll(() => {
  closeDb();
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

async function planFor(brandId: string, topic: string, budget: number | null = null) {
  const run = createRun({
    brandId,
    topic,
    options: { ...options, budget_override_usd: budget },
    quiet: true,
  });
  run.providers = buildProviders(run.providerSettings, {
    mode: "mock",
    fixtureDirs: [path.join(fixtures, brandId), fixtures],
  });
  const result = await runStages(run, PLANNING_STAGES);
  return { run, result };
}

describe("planning stages 00-06 (mock providers)", () => {
  it("plans a Bachalogy video end to end with real timing and routing", async () => {
    const { run, result } = await planFor("bachalogy", "first steps with the Wobble Bot");
    expect(result.status).toBe("done");
    const brief = run.readOutput("00_brief", CreativeBriefSchema);
    expect(brief.pillar_id).toBe("everyday_play");
    const voice = run.readOutput("03_voice", VoiceResultSchema);
    expect(voice.lines).toHaveLength(6);
    expect(voice.duration_s).toBeGreaterThan(10);
    expect(fs.existsSync(run.abs(voice.audio_path ?? ""))).toBe(true);
    const sb = run.readOutput("04_storyboard", StoryboardArtifactSchema);
    expect(sb.conformed_to_voice).toBe(true);
    expect(sb.shot_start_s[0]).toBe(0);
    // Narration ends inside the last narrated shot.
    const lastLine = voice.lines[voice.lines.length - 1];
    expect(sb.total_duration_s).toBeGreaterThanOrEqual((lastLine?.end_s ?? 0) + sb.voice_offset_s);
    expect(sb.risk.verdict).not.toBe("fail");
    const plan = run.readOutput("06_route", RoutingPlanSchema);
    const video = plan.shots.filter((s) => s.source === "GEN_VIDEO");
    expect(video.map((s) => s.shot_id)).toEqual(["shot_04", "shot_02"].sort());
    expect(plan.totals.ai_video_seconds).toBeGreaterThanOrEqual(10);
    expect(plan.budget_check.status).toBe("ok");
    expect(plan.totals.est_total_usd).toBeLessThan(2.5);
    expect(run.budget.spentUsd).toBeGreaterThan(0);
    expect(run.repos.listGenerations(run.runId).filter((g) => g.kind === "tts")).toHaveLength(6);
  }, 120_000);

  it("plans a Mindcode video with research and a different edit intent", async () => {
    const { run, result } = await planFor("mindcode", "why habits stick");
    expect(result.status).toBe("done");
    const brief = run.readOutput("00_brief", CreativeBriefSchema);
    expect(brief.edit_mode_intent).toBe("ASSEMBLY");
    expect(brief.research_depth).toBe("light");
    const sb = run.readOutput("04_storyboard", StoryboardArtifactSchema);
    expect(sb.shots).toHaveLength(6);
    const plan = run.readOutput("06_route", RoutingPlanSchema);
    expect(plan.shots.filter((s) => s.source === "GEN_VIDEO").map((s) => s.shot_id)).toEqual([
      "shot_01",
      "shot_05",
    ]);
    expect(plan.promise_check.satisfied).toBe(true);
  }, 120_000);

  it("reports a budget conflict instead of cutting the story when the cap is too low", async () => {
    const { run, result } = await planFor("bachalogy", "first steps with the Wobble Bot", 0.6);
    expect(result.status).toBe("budget_conflict");
    expect(run.manifest.status).toBe("budget_conflict");
    const plan = run.readOutput("06_route", RoutingPlanSchema);
    expect(plan.budget_check.status).toBe("conflict");
    expect(plan.budget_check.alternatives.length).toBeGreaterThan(0);
  }, 120_000);

  it("is idempotent: a second run re-pays nothing", async () => {
    const { run } = await planFor("mindcode", "why habits stick");
    const before = run.repos.listGenerations(run.runId).length;
    const again = await runStages(run, PLANNING_STAGES);
    expect(again.status).toBe("done");
    expect(run.repos.listGenerations(run.runId).length).toBe(before);
  }, 120_000);
});
