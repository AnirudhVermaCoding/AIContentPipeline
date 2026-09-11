import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../../db/sqlite.js";
import { probeMedia } from "../../media/probe.js";
import { buildProviders } from "../../providers/registry.js";
import { EdlSchema } from "../../schema/edl.js";
import { createRun } from "../run.js";
import { runStages } from "../runner.js";
import { ALL_STAGES } from "./index.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicp-render-"));
const fixtures = path.resolve("test/fixtures/llm");

beforeAll(() => {
  process.env.AICP_RUNS_DIR = path.join(tmp, "runs");
  process.env.AICP_DATA_DIR = path.join(tmp, "data");
  // Sandboxes without network can point Remotion at a local chrome-headless-shell binary.
  const shell = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
  if (!process.env.REMOTION_BROWSER_EXECUTABLE && fs.existsSync(shell)) {
    process.env.REMOTION_BROWSER_EXECUTABLE = shell;
  }
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

function start(brandId: string, topic: string, until: string | null = null) {
  const run = createRun({ brandId, topic, options: { ...options, until }, quiet: true });
  run.providers = buildProviders(run.providerSettings, {
    mode: "mock",
    fixtureDirs: [path.join(fixtures, brandId), fixtures],
  });
  return run;
}

describe("audio, edit and render (mock providers)", () => {
  it("renders the Bachalogy film with Remotion in LIGHT mode (hook line + end card)", async () => {
    const run = start("bachalogy", "first steps with the Wobble Bot");
    const r = await runStages(run, ALL_STAGES);
    expect(r.status).toBe("done");
    const edl = run.readOutput("10_edit", EdlSchema);
    expect(edl.mode).toBe("LIGHT");
    expect(edl.text_overlays).toHaveLength(1);
    expect(edl.end_card).not.toBeNull();
    expect(edl.transitions.every((t) => t.type === "cut")).toBe(true);
    const out = run.abs("11_render/final.mp4");
    expect(fs.existsSync(out)).toBe(true);
    const meta = await probeMedia(out);
    expect(meta.width).toBe(720);
    expect(meta.height).toBe(1280);
    expect(meta.has_audio).toBe(true);
    expect(Math.abs(meta.duration_s - edl.total_duration_s)).toBeLessThan(0.6);
  }, 600_000);

  it("finishes a FINISH_ONLY cut with ffmpeg only", async () => {
    // Plan and produce normally, then narrow the edit policy so the edit stage must pick FINISH_ONLY.
    const run = start("mindcode", "why habits stick", "audio");
    const planned = await runStages(run, ALL_STAGES);
    expect(planned.status).toBe("stopped");
    run.brand.profile.edit_defaults.modes_allowed = ["FINISH_ONLY"];
    run.brand.profile.edit_defaults.logo_placement = "none";
    run.brand.profile.cta.end_card = false;
    run.manifest.options.until = null;
    const r = await runStages(run, ALL_STAGES);
    expect(r.status).toBe("done");
    const edl = run.readOutput("10_edit", EdlSchema);
    expect(edl.mode).toBe("FINISH_ONLY");
    expect(edl.text_overlays).toHaveLength(0);
    expect(edl.end_card).toBeNull();
    const meta = await probeMedia(run.abs("11_render/final.mp4"));
    expect(meta.width).toBe(720);
    expect(meta.height).toBe(1280);
    expect(meta.has_audio).toBe(true);
    expect(Math.abs(meta.duration_s - edl.total_duration_s)).toBeLessThan(0.6);
  }, 600_000);
});
