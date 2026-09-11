import * as path from "node:path";
import { finishWithFfmpeg } from "../../media/finish.js";
import { probeMedia } from "../../media/probe.js";
import { renderWithRemotion } from "../../render/remotion-render.js";
import { EdlSchema } from "../../schema/edl.js";
import type { StageDef } from "../stage.js";

export const renderStage: StageDef = {
  id: "render",
  version: "1",
  dir: "11_render",
  dependsOn: ["edit"],
  extraInputs: () => ({ renderer: "remotion+ffmpeg", version: 1 }),
  async run(ctx) {
    const { run } = ctx;
    const edl = ctx.input("edit", EdlSchema);
    const out = path.join(ctx.stageDir, "final.mp4");
    const useFfmpeg = edl.mode === "NONE" || edl.mode === "FINISH_ONLY";
    const started = Date.now();
    if (useFfmpeg) {
      run.events.info(this.id, `finishing with ffmpeg (${edl.mode})`);
      await finishWithFfmpeg(run, edl, out);
    } else {
      run.events.info(this.id, `rendering with Remotion (${edl.mode})`);
      await renderWithRemotion(run, edl, out, (m) => run.events.info(this.id, m));
    }
    const meta = await probeMedia(out);
    ctx.writeOutput({
      path: run.rel(out),
      mode: edl.mode,
      renderer: useFfmpeg ? "ffmpeg" : "remotion",
      meta,
      render_ms: Date.now() - started,
    });
    run.events.info(
      this.id,
      `final.mp4 ${meta.width}x${meta.height} ${meta.duration_s.toFixed(1)}s in ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
    return { status: "done" };
  },
};
