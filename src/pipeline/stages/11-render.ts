import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeAudio } from "../../media/ffmpeg.js";
import { finishWithFfmpeg } from "../../media/finish.js";
import { probeMedia } from "../../media/probe.js";
import { type RenderProgress, renderWithRemotion } from "../../render/remotion-render.js";
import { EdlSchema } from "../../schema/edl.js";
import { nowIso, writeJsonAtomic } from "../../util/fs.js";
import type { StageDef } from "../stage.js";

export const RENDER_PROGRESS_FILE = "progress.json";

/** What the studio shows while rendering: real phases and Remotion's own frame counters. */
export interface RenderProgressFile extends RenderProgress {
  renderer: "remotion" | "ffmpeg";
  mode: string;
  output: { width: number; height: number; fps: number };
  started_at: string;
  updated_at: string;
  done: boolean;
  error: string | null;
}

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
    const totalFrames = Math.max(1, Math.round(edl.total_duration_s * edl.output.fps));
    const state: RenderProgressFile = {
      renderer: useFfmpeg ? "ffmpeg" : "remotion",
      mode: edl.mode,
      output: edl.output,
      phase: "preparing",
      progress: 0,
      rendered_frames: 0,
      encoded_frames: 0,
      total_frames: totalFrames,
      elapsed_ms: 0,
      started_at: nowIso(),
      updated_at: nowIso(),
      done: false,
      error: null,
    };
    const file = ctx.file(RENDER_PROGRESS_FILE);
    const publish = (
      patch: Partial<RenderProgress> & { done?: boolean; error?: string | null },
    ) => {
      Object.assign(state, patch, { elapsed_ms: Date.now() - started, updated_at: nowIso() });
      writeJsonAtomic(file, state);
    };
    publish({ phase: "preparing" });
    try {
      if (useFfmpeg) {
        run.events.info(this.id, `finishing with ffmpeg (${edl.mode})`);
        publish({ phase: "encoding" });
        await finishWithFfmpeg(run, edl, out);
        publish({
          phase: "encoding",
          progress: 1,
          rendered_frames: totalFrames,
          encoded_frames: totalFrames,
        });
      } else {
        run.events.info(this.id, `rendering with Remotion (${edl.mode})`);
        const raw = path.join(ctx.stageDir, "render_raw.mp4");
        await renderWithRemotion(
          run,
          edl,
          raw,
          (m) => run.events.info(this.id, m),
          (p) => publish(p),
        );
        const hasAudio = !!(edl.audio.voice_path || edl.audio.music_path);
        publish({ phase: "normalizing_audio", progress: 1 });
        if (hasAudio) await normalizeAudio(raw, out);
        else fs.copyFileSync(raw, out);
        fs.unlinkSync(raw);
      }
    } catch (err) {
      publish({ phase: "failed", error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    const meta = await probeMedia(out);
    publish({ phase: "done", progress: 1, done: true });
    ctx.writeOutput({
      path: run.rel(out),
      mode: edl.mode,
      renderer: useFfmpeg ? "ffmpeg" : "remotion",
      meta,
      render_ms: Date.now() - started,
    });
    run.repos.setRunSummary(run.runId, { duration_s: meta.duration_s });
    run.events.info(
      this.id,
      `final.mp4 ${meta.width}x${meta.height} ${meta.duration_s.toFixed(1)}s in ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
    return { status: "done" };
  },
};
