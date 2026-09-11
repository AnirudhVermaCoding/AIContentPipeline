import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../../db/sqlite.js";
import { buildProviders } from "../../providers/registry.js";
import { createRun, openRun } from "../run.js";
import { runStages } from "../runner.js";
import { loadShotRecord, saveShotRecord } from "../shots.js";
import { ALL_STAGES } from "./index.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicp-production-"));
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

function attach(run: ReturnType<typeof createRun>) {
  run.providers = buildProviders(run.providerSettings, {
    mode: "mock",
    fixtureDirs: [path.join(fixtures, run.manifest.brand_id), fixtures],
  });
  return run;
}

describe("production stages 07-08 (mock providers)", () => {
  it("produces keyframes for every shot and clips for routed shots, then is idempotent", async () => {
    const run = attach(
      createRun({ brandId: "bachalogy", topic: "first steps", options, quiet: true }),
    );
    const r = await runStages(run, ALL_STAGES);
    expect(r.status).toBe("done");
    const shots = ["shot_01", "shot_02", "shot_03", "shot_04", "shot_05", "shot_06"].map((id) =>
      loadShotRecord(run, id),
    );
    for (const s of shots) {
      expect(s?.keyframe).toBeTruthy();
      expect(fs.existsSync(run.abs(s?.final?.path ?? ""))).toBe(true);
    }
    expect(shots.filter((s) => s?.final?.kind === "video").map((s) => s?.shot_id)).toEqual([
      "shot_02",
      "shot_04",
    ]);
    const gens = run.repos.listGenerations(run.runId);
    expect(gens.filter((g) => g.kind === "image" && g.status === "completed")).toHaveLength(6);
    expect(gens.filter((g) => g.kind === "video" && g.status === "completed")).toHaveLength(2);

    const before = gens.length;
    const again = openRun(run.runId, { quiet: true });
    attach(again);
    const r2 = await runStages(again, ALL_STAGES);
    expect(r2.status).toBe("done");
    expect(again.repos.listGenerations(run.runId).length).toBe(before);
  }, 240_000);

  it("pauses for keyframe approval and regenerates a rejected shot on resume", async () => {
    const run = attach(
      createRun({
        brandId: "mindcode",
        topic: "why habits stick",
        options: { ...options, approve_keyframes: true },
        quiet: true,
      }),
    );
    const r = await runStages(run, ALL_STAGES);
    expect(r.status).toBe("waiting_approval");
    expect(run.manifest.status).toBe("waiting_approval");
    const gens = run.repos.listGenerations(run.runId);
    expect(gens.filter((g) => g.kind === "video")).toHaveLength(0);

    // Approve all but one, reject shot_03 with a note.
    for (const id of ["shot_01", "shot_02", "shot_03", "shot_04", "shot_05", "shot_06"]) {
      const rec = loadShotRecord(run, id);
      if (!rec) throw new Error(`missing ${id}`);
      rec.approval =
        id === "shot_03"
          ? { status: "rejected", note: "too dark" }
          : { status: "approved", note: null };
      saveShotRecord(run, rec);
    }
    const stage = run.manifest.stages.keyframes;
    if (stage) stage.status = "pending";
    run.save();
    const imagesBefore = gens.filter((g) => g.kind === "image").length;

    const resumed = attach(openRun(run.runId, { quiet: true }));
    const r2 = await runStages(resumed, ALL_STAGES);
    // shot_03 was regenerated and is pending again (approval mode still on).
    expect(r2.status).toBe("waiting_approval");
    const gens2 = resumed.repos.listGenerations(run.runId);
    expect(gens2.filter((g) => g.kind === "image").length).toBe(imagesBefore + 1);
    expect(loadShotRecord(resumed, "shot_03")?.approval.status).toBe("pending");
    expect(loadShotRecord(resumed, "shot_01")?.approval.status).toBe("approved");
  }, 240_000);
});
