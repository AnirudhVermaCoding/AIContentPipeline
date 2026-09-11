import * as fs from "node:fs";
import { z } from "zod";
import { integratedLoudness } from "../../media/ffmpeg.js";
import { probeMedia } from "../../media/probe.js";
import { assessFinal } from "../../qc/final.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { EdlSchema } from "../../schema/edl.js";
import { RoutingPlanSchema } from "../../schema/routing.js";
import { StoryboardArtifactSchema } from "../../schema/storyboard.js";
import { loadShotRecord } from "../shots.js";
import type { StageDef } from "../stage.js";

const RenderOutput = z.object({ path: z.string(), mode: z.string(), renderer: z.string() });

export const finalQcStage: StageDef = {
  id: "final_qc",
  version: "1",
  dir: "12_final_qc",
  dependsOn: ["brief", "storyboard", "route", "edit", "render"],
  async run(ctx) {
    const { run } = ctx;
    const brief = ctx.input("brief", CreativeBriefSchema);
    const storyboard = ctx.input("storyboard", StoryboardArtifactSchema);
    const plan = ctx.input("route", RoutingPlanSchema);
    const edl = ctx.input("edit", EdlSchema);
    const rendered = ctx.input("render", RenderOutput);
    const file = run.abs(rendered.path);
    const probe = await probeMedia(file);
    const lufs = probe.has_audio ? await integratedLoudness(file) : null;

    // What real motion actually shipped.
    let generatedSeconds = 0;
    let motionDuration = 0;
    let downgradeLogged = false;
    for (const shot of storyboard.shots) {
      const record = loadShotRecord(run, shot.id);
      const route = plan.shots.find((r) => r.shot_id === shot.id);
      if (record?.final?.kind === "video") {
        generatedSeconds += route?.video_seconds ?? record.final.meta.duration_s;
        motionDuration += shot.duration_s;
      }
      if (record?.status === "downgraded") downgradeLogged = true;
    }
    const total = storyboard.shots.reduce((n, s) => n + s.duration_s, 0);

    const report = assessFinal({
      brand: run.brand.profile,
      brief,
      edl,
      probe,
      fileBytes: fs.statSync(file).size,
      integratedLufs: lufs,
      generatedSeconds,
      motionRatio: total > 0 ? motionDuration / total : 0,
      downgradeLogged,
    });
    ctx.writeOutput(report);
    run.repos.insertQc(run.runId, this.id, null, report.status, report);
    const failed = report.checks.filter((c) => c.status === "fail");
    const warned = report.checks.filter((c) => c.status === "warn");
    run.events[report.status === "fail" ? "error" : report.status === "pass" ? "info" : "warn"](
      this.id,
      `${report.status}${failed.length ? `: ${failed.map((c) => `${c.id} (${c.detail})`).join("; ")}` : ""}${warned.length ? ` | warnings: ${warned.map((c) => c.id).join(", ")}` : ""}`,
    );
    return { status: "done" };
  },
};
