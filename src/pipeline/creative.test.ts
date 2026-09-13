import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { controlsForRun, creativeHashInputs } from "../creative/controls.js";
import { closeDb } from "../db/sqlite.js";
import type { FixtureResolver } from "../providers/llm/mock.js";
import { buildProviders } from "../providers/registry.js";
import { CreativeBriefSchema } from "../schema/brief.js";
import { ContinuityBibleSchema } from "../schema/continuity.js";
import type { RunOptions } from "../schema/manifest.js";
import { RoutingPlanSchema } from "../schema/routing.js";
import { StoryboardArtifactSchema } from "../schema/storyboard.js";
import { readJson } from "../util/fs.js";
import {
  applyKeyframeDecisions,
  requestClipRegeneration,
  requestConceptRegeneration,
  requestStoryboardShotRegeneration,
} from "./approval.js";
import { loadManifest } from "./manifest.js";
import { createRun, openRun, type RunContext } from "./run.js";
import { computeInputsHash, runStages } from "./runner.js";
import { loadShotRecord } from "./shots.js";
import { briefStage, type DirectorRecord } from "./stages/00-brief.js";
import { ALL_STAGES, PLANNING_STAGES } from "./stages/index.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicp-creative-"));
const fixtures = path.resolve("test/fixtures/llm");
const brandsCopy = path.join(tmp, "brands");

beforeAll(() => {
  process.env.AICP_RUNS_DIR = path.join(tmp, "runs");
  process.env.AICP_DATA_DIR = path.join(tmp, "data");
  // A private copy of brands/ so a test can edit brand.yaml without touching the repo.
  fs.cpSync(path.resolve("brands"), brandsCopy, { recursive: true });
  process.env.AICP_BRANDS_DIR = brandsCopy;
});
afterAll(() => {
  closeDb();
  delete process.env.AICP_BRANDS_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const base: RunOptions = {
  provider_mode: "mock",
  approve_keyframes: false,
  budget_override_usd: null,
  ai_video_seconds_override: null,
  until: null,
  dry_run: false,
};

/** Capture every prompt the mock LLM receives, keyed by call label (first label wins). */
function capture(): { prompts: Map<string, string>; resolver: FixtureResolver } {
  const prompts = new Map<string, string>();
  return {
    prompts,
    resolver: (label, prompt) => {
      if (!prompts.has(label)) prompts.set(label, prompt);
      return undefined;
    },
  };
}

function attach(run: RunContext, resolvers: FixtureResolver[] = []): RunContext {
  run.providers = buildProviders(run.providerSettings, {
    mode: "mock",
    fixtureDirs: [path.join(fixtures, run.manifest.brand_id), fixtures],
    fixtureResolvers: resolvers,
  });
  return run;
}

function start(
  brandId: string,
  topic: string,
  options: Partial<RunOptions> = {},
  resolvers: FixtureResolver[] = [],
): RunContext {
  return attach(
    createRun({
      brandId,
      topic,
      goal: "drive purchase intent",
      options: { ...base, ...options },
      quiet: true,
    }),
    resolvers,
  );
}

describe("creative controls: persistence and backwards compatibility", () => {
  it("uses the defaults when neither the run nor the brand set anything", () => {
    const run = start("mindcode", "defaults");
    expect(run.manifest.options.creative_freedom).toBe(0.65);
    expect(run.manifest.options.goal_focus).toBe(0.85);
    expect(controlsForRun(run).sources).toEqual({
      creative_freedom: "default",
      goal_focus: "default",
    });
  });

  it("takes the brand's creative_defaults and lets the run override them", () => {
    const fromBrand = start("bachalogy", "brand defaults");
    expect(fromBrand.manifest.options.creative_freedom).toBe(0.7);
    expect(fromBrand.manifest.options.goal_focus).toBe(0.9);
    const overridden = start("bachalogy", "run override", { creative_freedom: 0.2 });
    expect(overridden.manifest.options.creative_freedom).toBe(0.2);
    expect(overridden.manifest.options.goal_focus).toBe(0.9);
    expect(controlsForRun(overridden).creative_label).toBe("Safe");
    expect(controlsForRun(overridden).sources).toEqual({
      creative_freedom: "run",
      goal_focus: "brand",
    });
    expect(controlsForRun(fromBrand).sources).toEqual({
      creative_freedom: "brand",
      goal_focus: "brand",
    });
  });

  it("keeps the run's values when the brand file changes afterwards", () => {
    const run = start("bachalogy", "pinned");
    const file = path.join(brandsCopy, "bachalogy", "brand.yaml");
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace("creative_freedom: 0.70", "creative_freedom: 0.10")
        .replace("goal_focus: 0.90", "goal_focus: 0.20"),
    );
    try {
      const pinned = openRun(run.runId, { quiet: true, brandSource: "snapshot" });
      expect(pinned.manifest.options.creative_freedom).toBe(0.7);
      expect(controlsForRun(pinned)).toMatchObject({ creative_freedom: 0.7, goal_focus: 0.9 });
      // Even a run that adopts the live brand keeps its own stored values.
      const live = openRun(run.runId, { quiet: true, brandSource: "live" });
      expect(controlsForRun(live)).toMatchObject({ creative_freedom: 0.7, goal_focus: 0.9 });
      // A new run picks up the edited defaults.
      const fresh = start("bachalogy", "after edit");
      expect(fresh.manifest.options.creative_freedom).toBe(0.1);
    } finally {
      fs.writeFileSync(
        file,
        fs
          .readFileSync(file, "utf8")
          .replace("creative_freedom: 0.10", "creative_freedom: 0.70")
          .replace("goal_focus: 0.20", "goal_focus: 0.90"),
      );
    }
  });

  it("loads old runs without the fields and leaves their hashes untouched", () => {
    const run = start("mindcode", "legacy");
    const withControls = computeInputsHash(run, briefStage, ALL_STAGES);
    // Simulate a manifest written before the controls existed.
    delete run.manifest.options.creative_freedom;
    delete run.manifest.options.goal_focus;
    run.save();
    const legacy = openRun(run.runId, { quiet: true });
    const m = loadManifest(legacy.runDir);
    expect(m.options.creative_freedom).toBeUndefined();
    expect(creativeHashInputs(m)).toEqual({});
    const extra = briefStage.extraInputs?.(legacy) as Record<string, unknown>;
    expect("creative" in extra).toBe(false);
    const legacyHash = computeInputsHash(legacy, briefStage, ALL_STAGES);
    expect(legacyHash).not.toBe(withControls);
    // Deterministic: the legacy hash is what a pre-control build would have computed (no key).
    expect(computeInputsHash(legacy, briefStage, ALL_STAGES)).toBe(legacyHash);
    // Generation still works with resolved defaults.
    expect(controlsForRun(legacy)).toMatchObject({ creative_freedom: 0.65, goal_focus: 0.85 });
  });
});

describe("creative controls: prompts", () => {
  it("changes the Creative Director's guidance with the dials and keeps research factual", async () => {
    const low = capture();
    const high = capture();
    const a = start("mindcode", "prompt low", { creative_freedom: 0.15, goal_focus: 0.3 }, [
      low.resolver,
    ]);
    const b = start("mindcode", "prompt high", { creative_freedom: 0.9, goal_focus: 0.95 }, [
      high.resolver,
    ]);
    expect((await runStages(a, PLANNING_STAGES)).status).toBe("done");
    expect((await runStages(b, PLANNING_STAGES)).status).toBe("done");
    const lowDirector = low.prompts.get("creative-director") as string;
    const highDirector = high.prompts.get("creative-director:candidates") as string;
    expect(lowDirector).toContain("Creative Freedom: 0.15 — Safe");
    expect(lowDirector).toContain("Goal Focus: 0.30 — Loose");
    expect(lowDirector).not.toContain("## Concept candidates");
    expect(highDirector).toContain("Creative Freedom: 0.90 — Wild");
    expect(highDirector).toContain("Goal Focus: 0.95 — Goal-first");
    expect(highDirector).toContain("Rank concepts first by goal alignment");
    expect(highDirector).toContain("Draft 3 genuinely different concepts");
    // Hard constraints are present at both settings, verbatim.
    for (const p of [lowDirector, highDirector]) {
      expect(p).toContain("## Locked (never loosened by creative freedom)");
      expect(p).toContain("Product identity:");
      expect(p).toContain("Factual claims: only claims from the brand profile");
    }
    // Research never receives creative guidance: identical prompt at both settings.
    const lowResearch = low.prompts.get("researcher");
    const highResearch = high.prompts.get("researcher");
    expect(lowResearch).toBeTruthy();
    expect(lowResearch).toBe(highResearch);
    expect(lowResearch).not.toContain("Creative Freedom");
    // The director's candidates and ranking are recorded for provenance.
    const record = readJson<DirectorRecord>(path.join(b.runDir, "00_brief", "director.json"));
    expect(record.candidate_count).toBe(3);
    expect(record.candidates.length).toBeGreaterThanOrEqual(2);
    expect(record.ranking.length).toBe(record.candidates.length);
    expect(record.controls).toMatchObject({ creative_label: "Wild", goal_label: "Goal-first" });
    const singles = readJson<DirectorRecord>(path.join(a.runDir, "00_brief", "director.json"));
    expect(singles.candidate_count).toBe(1);
  }, 120_000);

  it("gives the storyboard artist and the image prompter the controls, with identity locked", async () => {
    const cap = capture();
    const run = start("bachalogy", "prompt production", { creative_freedom: 1, goal_focus: 0.9 }, [
      cap.resolver,
    ]);
    expect(
      (
        await runStages(
          run,
          ALL_STAGES.filter(
            (s) =>
              s.id !== "animate" &&
              !["audio", "edit", "render", "final_qc", "report"].includes(s.id),
          ),
        )
      ).status,
    ).toBe("done");
    const storyboard = cap.prompts.get("storyboard-artist") as string;
    expect(storyboard).toContain("## Creative controls");
    expect(storyboard).toContain("Creative Freedom: 1.00 — Wild");
    expect(storyboard).toContain("Every shot must have clear narrative utility toward the goal");
    expect(storyboard).toContain("Structure: between 3 and 14 shots");
    const image = cap.prompts.get("image-prompter:shot_01") as string;
    const creativeAt = image.indexOf("## CREATIVE VARIABLES");
    const lockedAt = image.indexOf("## LOCKED IDENTITY VARIABLES");
    expect(creativeAt).toBeGreaterThan(0);
    expect(lockedAt).toBeGreaterThan(creativeAt);
    expect(image.slice(lockedAt)).toContain("Identity block (restate verbatim):");
    expect(image.slice(lockedAt)).toContain("Product identity: Wobble Bot");
    expect(image.slice(lockedAt)).toContain("identity-critical colours never change");
  }, 180_000);
});

describe("creative controls: routing and budget stay hard", () => {
  it("routes identically at creative freedom 0.1 and 1.0 for the same story", async () => {
    const low = start("bachalogy", "route low", { creative_freedom: 0.1 });
    const high = start("bachalogy", "route high", { creative_freedom: 1 });
    expect((await runStages(low, PLANNING_STAGES)).status).toBe("done");
    expect((await runStages(high, PLANNING_STAGES)).status).toBe("done");
    const a = low.readOutput("06_route", RoutingPlanSchema);
    const b = high.readOutput("06_route", RoutingPlanSchema);
    expect(b.totals.ai_video_seconds).toBe(a.totals.ai_video_seconds);
    expect(b.shots.map((s) => [s.shot_id, s.source])).toEqual(
      a.shots.map((s) => [s.shot_id, s.source]),
    );
    // Planning prompts differ in length, so LLM spend (and therefore est_total) may differ by a
    // fraction of a cent; the media plan itself must be identical.
    expect(b.totals.est_image_usd).toBeCloseTo(a.totals.est_image_usd, 6);
    expect(b.totals.est_video_usd).toBeCloseTo(a.totals.est_video_usd, 6);
  }, 120_000);

  it("still blocks on the hard cap at creative freedom 1.0", async () => {
    const run = start("bachalogy", "cap", { creative_freedom: 1, budget_override_usd: 0.6 });
    const r = await runStages(run, PLANNING_STAGES);
    expect(r.status).toBe("budget_conflict");
    expect(run.manifest.cost.hard_cap_usd).toBe(0.6);
  }, 120_000);
});

describe("variation strength", () => {
  it("persists on regenerated keyframes and clips", async () => {
    const run = start("bachalogy", "variation", { approve_keyframes: true });
    expect((await runStages(run, ALL_STAGES)).status).toBe("waiting_approval");
    applyKeyframeDecisions(
      run,
      [{ shotId: "shot_01", decision: "reject", instruction: "lower camera", variation: "small" }],
      { approveRemainingPending: true },
    );
    expect(loadShotRecord(run, "shot_01")?.overrides?.variation).toBe("small");
    expect((await runStages(run, ALL_STAGES)).status).toBe("waiting_approval");
    const kf = loadShotRecord(run, "shot_01");
    const latest = kf?.attempts.filter((a) => a.kind === "keyframe").at(-1);
    expect(latest?.attempt).toBe(2);
    expect(latest?.params.variation_strength).toBe("small");
    // Consumed with the instruction: the next regeneration starts clean.
    expect(kf?.overrides?.variation ?? null).toBeNull();
    applyKeyframeDecisions(run, [], { approveRemainingPending: true });
    expect((await runStages(run, ALL_STAGES)).status).toBe("done");
    requestClipRegeneration(run, "shot_02", "slower", "test", "different");
    expect(loadShotRecord(run, "shot_02")?.overrides?.variation).toBe("different");
    expect((await runStages(run, ALL_STAGES)).status).toBe("done");
    const clip = loadShotRecord(run, "shot_02");
    const clips = clip?.attempts.filter((a) => a.kind === "video") ?? [];
    expect(clips.map((a) => a.attempt)).toEqual([1, 2]);
    expect(clips.at(-1)?.params.variation_strength).toBe("different");
    expect(clips[0]?.params.variation_strength).toBeUndefined();
  }, 300_000);

  it("rewrites one storyboard shot and re-produces only that shot", async () => {
    const run = start("bachalogy", "shot rewrite");
    expect((await runStages(run, PLANNING_STAGES)).status).toBe("done");
    // Produce keyframes so we can prove only one is regenerated.
    const keyframes = ALL_STAGES.filter((s) => s.id === "keyframes");
    expect((await runStages(run, [...PLANNING_STAGES, ...keyframes])).status).toBe("done");
    const before = run.readOutput("04_storyboard", StoryboardArtifactSchema);
    const contBefore = run.readOutput("05_continuity", ContinuityBibleSchema);
    const imagesBefore = run.repos
      .listGenerations(run.runId)
      .filter((g) => g.kind === "image").length;
    const hashesBefore = Object.fromEntries(
      before.shots.map((s) => [s.id, loadShotRecord(run, s.id)?.shot_hash]),
    );

    const reset = requestStoryboardShotRegeneration(run, "shot_03", {
      variation: "small",
      instruction: "lower the camera",
      actor: "test",
    });
    expect(reset[0]).toBe("storyboard");
    expect(run.manifest.pending_regeneration?.shot_id).toBe("shot_03");
    expect(run.manifest.options.dry_run).toBe(true);
    run.manifest.options.dry_run = false;
    run.save();
    expect((await runStages(run, [...PLANNING_STAGES, ...keyframes])).status).toBe("done");

    const after = run.readOutput("04_storyboard", StoryboardArtifactSchema);
    expect(after.regeneration).toMatchObject({
      target: "storyboard_shot",
      shot_id: "shot_03",
      variation: "small",
      instruction: "lower the camera",
    });
    expect(run.manifest.pending_regeneration ?? null).toBeNull();
    for (const s of before.shots) {
      const next = after.shots.find((x) => x.id === s.id);
      if (s.id === "shot_03") {
        expect(next?.description).not.toBe(s.description);
        expect(next?.narration_line_ids).toEqual(s.narration_line_ids);
        expect(next?.entities_in_frame).toEqual(s.entities_in_frame);
        expect(next?.duration_s).toBe(s.duration_s);
      } else {
        expect(next).toEqual(s);
      }
    }
    const contAfter = run.readOutput("05_continuity", ContinuityBibleSchema);
    expect(contAfter.locks).toEqual(contBefore.locks);
    for (const s of before.shots) {
      const hash = loadShotRecord(run, s.id)?.shot_hash;
      if (s.id === "shot_03") expect(hash).not.toBe(hashesBefore[s.id]);
      else expect(hash).toBe(hashesBefore[s.id]);
    }
    const imagesAfter = run.repos
      .listGenerations(run.runId)
      .filter((g) => g.kind === "image").length;
    expect(imagesAfter).toBe(imagesBefore + 1);
    expect(run.events.decisions().some((d) => d.subject === "shot_count")).toBe(true);
  }, 300_000);

  it("regenerates the concept with a variation and keeps the earlier director record", async () => {
    const run = start("bachalogy", "concept regen");
    expect((await runStages(run, [briefStage])).status).toBe("done");
    const first = run.readOutput("00_brief", CreativeBriefSchema);
    requestConceptRegeneration(run, {
      variation: "different",
      instruction: "no parent in the film",
      actor: "test",
    });
    expect(run.manifest.pending_regeneration?.target).toBe("concept");
    run.manifest.options.dry_run = false;
    run.save();
    const cap = capture();
    attach(run, [cap.resolver]);
    expect((await runStages(run, [briefStage])).status).toBe("done");
    const prompt = cap.prompts.get("creative-director:candidates") as string;
    expect(prompt).toContain("Variation: COMPLETELY DIFFERENT");
    expect(prompt).toContain("Instruction: no parent in the film");
    expect(prompt).toContain(`Previous version: ${first.concept}`);
    const record = readJson<DirectorRecord>(path.join(run.runDir, "00_brief", "director.json"));
    expect(record.regeneration?.variation).toBe("different");
    expect(record.previous_concept).toBe(first.concept);
    expect(fs.readdirSync(path.join(run.runDir, "00_brief", "history"))).toHaveLength(1);
    expect(run.manifest.pending_regeneration ?? null).toBeNull();
  }, 120_000);
});
