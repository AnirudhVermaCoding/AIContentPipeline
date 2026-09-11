import * as fs from "node:fs";
import * as path from "node:path";
import pLimit from "p-limit";
import { runMotionPrompter } from "../../agents/motion-prompter.js";
import { promptVersions } from "../../agents/prompts.js";
import { probeMedia } from "../../media/probe.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { ContinuityBibleSchema } from "../../schema/continuity.js";
import { RoutingPlanSchema } from "../../schema/routing.js";
import type { ShotRecord } from "../../schema/shot.js";
import type { Shot } from "../../schema/storyboard.js";
import { StoryboardArtifactSchema } from "../../schema/storyboard.js";
import { BudgetExceededError, errorMessage, ProviderError } from "../../util/errors.js";
import { paidCall } from "../paid.js";
import type { RunContext } from "../run.js";
import { computeShotHash, loadOrResetShot, saveShotRecord, shotDir, summarize } from "../shots.js";
import type { StageDef } from "../stage.js";

async function finalizeStill(run: RunContext, record: ShotRecord): Promise<void> {
  if (!record.keyframe) throw new Error(`${record.shot_id}: no keyframe to finalise`);
  record.final = {
    path: record.keyframe.path,
    kind: "image",
    meta: {
      duration_s: 0,
      width: record.keyframe.width,
      height: record.keyframe.height,
      fps: null,
      has_audio: false,
    },
  };
  record.status = record.status === "downgraded" ? "downgraded" : "done";
  saveShotRecord(run, record);
}

async function animate(
  run: RunContext,
  stageId: string,
  shot: Shot,
  record: ShotRecord,
  continuity: ReturnType<typeof ContinuityBibleSchema.parse>,
  seconds: number,
  stillFallbackAllowed: boolean,
): Promise<void> {
  if (!record.keyframe) throw new Error(`${shot.id}: cannot animate without a keyframe`);
  const keyframeAbs = run.abs(record.keyframe.path);
  const attempt = record.attempts.filter((a) => a.kind === "video").length + 1;
  const promptRes = await runMotionPrompter(
    run,
    stageId,
    shot,
    continuity,
    seconds,
    record.keyframe.prompt,
  );
  record.cost_usd += promptRes.costUsd;
  const started = Date.now();
  try {
    const res = await paidCall(
      run,
      {
        stageId,
        shotId: shot.id,
        kind: "video",
        provider: run.providers.video.id,
        model: run.providers.video.model,
        label: `video:${shot.id}:v${attempt}`,
        estimateUsd: run.providers.video.estimate(seconds),
        prompt: promptRes.data.prompt,
        promptVersion: promptRes.promptVersion,
        sourceAssets: [record.keyframe.path],
        durationS: seconds,
        resolution: run.providers.video.resolution,
      },
      () =>
        run.providers.video.generate({
          imagePath: keyframeAbs,
          prompt: promptRes.data.prompt,
          durationSeconds: seconds,
          label: `video:${shot.id}`,
        }),
    );
    const file = path.join(shotDir(run, shot.id), `video_v${attempt}.mp4`);
    fs.renameSync(res.filePath, file);
    const meta = await probeMedia(file);
    record.cost_usd += res.costUsd;
    record.attempts.push({
      kind: "video",
      attempt,
      provider: res.provider,
      model: res.model,
      prompt: promptRes.data.prompt,
      prompt_version: promptRes.promptVersion,
      refs: [record.keyframe.path],
      params: { duration: seconds, resolution: res.resolution },
      latency_ms: res.latencyMs,
      cost_usd: res.costUsd,
      status: "ok",
      error: null,
      path: run.rel(file),
      checks: [
        {
          id: "duration",
          status: meta.duration_s >= seconds * 0.8 ? "pass" : "warn",
          detail: `${meta.duration_s.toFixed(2)}s of ${seconds}s`,
        },
        {
          id: "dimensions",
          status: meta.height > meta.width ? "pass" : "fail",
          detail: `${meta.width}x${meta.height}`,
        },
      ],
    });
    record.video = { path: run.rel(file), prompt: promptRes.data.prompt, meta };
    record.final = { path: run.rel(file), kind: "video", meta };
    record.status = "done";
    saveShotRecord(run, record);
    run.events.info(
      stageId,
      `clip ready: ${meta.duration_s.toFixed(1)}s ${meta.width}x${meta.height}, $${res.costUsd.toFixed(3)}`,
      undefined,
      shot.id,
    );
  } catch (err) {
    record.attempts.push({
      kind: "video",
      attempt,
      provider: run.providers.video.id,
      model: run.providers.video.model,
      prompt: promptRes.data.prompt,
      prompt_version: promptRes.promptVersion,
      refs: [record.keyframe.path],
      params: { duration: seconds },
      latency_ms: Date.now() - started,
      cost_usd: 0,
      status: "failed",
      error: errorMessage(err),
      path: null,
      checks: [],
    });
    saveShotRecord(run, record);
    if (err instanceof BudgetExceededError) throw err;
    if (err instanceof ProviderError && stillFallbackAllowed) {
      run.events.warn(
        stageId,
        `video generation failed (${errorMessage(err)}); falling back to an animated still`,
        undefined,
        shot.id,
      );
      run.events.decision({
        stage: stageId,
        category: "fallback",
        subject: shot.id,
        options_considered: ["retry video", "STILL_MOTION"],
        reason: `provider failure after retries: ${errorMessage(err)}`,
        shot: shot.id,
      });
      record.status = "downgraded";
      record.source = "STILL_MOTION";
      await finalizeStill(run, record);
      return;
    }
    throw err;
  }
}

/** Parallel image-to-video for GEN_VIDEO shots; stills are finalised as-is. Per-shot idempotent. */
export const animateStage: StageDef = {
  id: "animate",
  version: "1",
  dir: "08_animate",
  dependsOn: ["storyboard", "continuity", "route", "keyframes"],
  paidMedia: true,
  extraInputs: () => ({ prompts: promptVersions(["motion-prompter"]) }),
  async run(ctx) {
    const { run } = ctx;
    const brief = ctx.input("brief", CreativeBriefSchema);
    const storyboard = ctx.input("storyboard", StoryboardArtifactSchema);
    const continuity = ctx.input("continuity", ContinuityBibleSchema);
    const plan = ctx.input("route", RoutingPlanSchema);
    const limit = pLimit(3);
    const records: ShotRecord[] = [];

    const tasks = storyboard.shots.map((shot) =>
      limit(async () => {
        const route = plan.shots.find((r) => r.shot_id === shot.id);
        if (!route) throw new Error(`no route for ${shot.id}`);
        const hash = computeShotHash(run, shot, continuity, route);
        const { record } = loadOrResetShot(run, shot.id, hash, route.source);
        if (!record.keyframe)
          throw new Error(`${shot.id}: keyframes stage did not produce a keyframe`);
        if (record.approval.status === "rejected")
          throw new Error(`${shot.id} is rejected; approve or regenerate first`);
        if (
          record.final &&
          fs.existsSync(run.abs(record.final.path)) &&
          (record.status === "done" || record.status === "downgraded")
        ) {
          run.events.debug(this.id, "up to date", undefined, shot.id);
          records.push(record);
          return;
        }
        if (route.source === "GEN_VIDEO" && route.video_seconds) {
          const allowStill = brief.motion_promise.still_fallback_allowed || !shot.hero_moment;
          await animate(run, this.id, shot, record, continuity, route.video_seconds, allowStill);
        } else {
          await finalizeStill(run, record);
        }
        records.push(record);
      }),
    );
    const results = await Promise.allSettled(tasks);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length) {
      const budget = failed.find((f) => f.reason instanceof BudgetExceededError);
      throw budget ? budget.reason : failed[0]?.reason;
    }
    records.sort((a, b) => a.shot_id.localeCompare(b.shot_id));
    ctx.writeOutput({ shots: summarize(records) });
    const clips = records.filter((r) => r.final?.kind === "video").length;
    run.events.info(this.id, `${clips} clip(s), ${records.length - clips} still(s)`);
    return { status: "done" };
  },
};
