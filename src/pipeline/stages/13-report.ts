import * as fs from "node:fs";
import * as path from "node:path";
import { writeReport } from "../../cost/report.js";
import type { StageDef } from "../stage.js";

export const reportStage: StageDef = {
  id: "report",
  version: "1",
  dir: "13_report",
  dependsOn: ["final_qc"],
  async run(ctx) {
    const { run } = ctx;
    const { report } = writeReport(run, ctx.stageDir);
    // Convenience copies at the run root.
    const final = run.abs("11_render/final.mp4");
    if (fs.existsSync(final)) fs.copyFileSync(final, path.join(run.runDir, "final.mp4"));
    fs.copyFileSync(path.join(ctx.stageDir, "report.md"), path.join(run.runDir, "report.md"));
    ctx.writeOutput({
      spent_usd: report.cost.spent_usd,
      estimated_usd: report.cost.estimated_usd,
      qc_status: report.qc_status,
      final_video: report.final_video,
    });
    run.events.info(
      this.id,
      `spent $${report.cost.spent_usd.toFixed(3)} of $${report.cost.hard_cap_usd.toFixed(2)} (estimated $${report.cost.estimated_usd.toFixed(2)}); QC ${report.qc_status ?? "n/a"}`,
    );
    return { status: "done" };
  },
};
