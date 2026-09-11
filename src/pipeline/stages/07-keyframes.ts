import * as fs from "node:fs";
import * as path from "node:path";
import { runImagePrompter } from "../../agents/image-prompter.js";
import { promptVersions } from "../../agents/prompts.js";
import { probeImage } from "../../media/probe.js";
import { checkKeyframe } from "../../qc/keyframe.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { OUTPUT } from "../../schema/common.js";
import { ContinuityBibleSchema } from "../../schema/continuity.js";
import { RoutingPlanSchema } from "../../schema/routing.js";
import type { ShotRecord } from "../../schema/shot.js";
import type { Shot } from "../../schema/storyboard.js";
import { StoryboardArtifactSchema } from "../../schema/storyboard.js";
import { errorMessage, SafetyRejectionError } from "../../util/errors.js";
import { writeFileAtomic } from "../../util/fs.js";
import { paidCall } from "../paid.js";
import type { RunContext } from "../run.js";
import { computeShotHash, loadOrResetShot, saveShotRecord, shotDir, summarize } from "../shots.js";
import type { StageDef } from "../stage.js";

async function produceKeyframe(
  run: RunContext,
  stageId: string,
  shot: Shot,
  previous: Shot | null,
  previousKeyframe: string | null,
  record: ShotRecord,
  continuity: ReturnType<typeof ContinuityBibleSchema.parse>,
  feedback: string | null,
): Promise<void> {
  const b = run.brand.profile;
  const per = continuity.per_shot.find((p) => p.shot_id === shot.id);
  const refs = (per?.reference_images ?? []).map((r) => run.abs(r));
  // Continuity chain: the previous approved keyframe in the same location is a reference too.
  if (
    previousKeyframe &&
    previous &&
    previous.location_id === shot.location_id &&
    run.providers.image.supportsReferences &&
    refs.length < 4
  ) {
    refs.push(run.abs(previousKeyframe));
  }
  const maxAttempts = b.budget.keyframe_attempts;
  let lastFeedback = feedback;
  for (
    let attempt = record.attempts.filter((a) => a.kind === "keyframe").length + 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    const promptRes = await runImagePrompter(
      run,
      stageId,
      shot,
      continuity,
      previous,
      lastFeedback,
    );
    record.cost_usd += promptRes.costUsd;
    const started = Date.now();
    const file = path.join(shotDir(run, shot.id), `keyframe_v${attempt}.png`);
    try {
      const res = await paidCall(
        run,
        {
          stageId,
          shotId: shot.id,
          kind: "image",
          provider: run.providers.image.id,
          model: refs.length ? run.providers.image.editModel : run.providers.image.model,
          label: `keyframe:${shot.id}:v${attempt}`,
          estimateUsd: run.providers.image.estimate(OUTPUT.width, OUTPUT.height, refs.length),
          prompt: promptRes.data.prompt,
          promptVersion: promptRes.promptVersion,
          sourceAssets: refs.map((r) => run.rel(r)),
          resolution: `${OUTPUT.width}x${OUTPUT.height}`,
        },
        () =>
          run.providers.image.generate({
            prompt: promptRes.data.prompt,
            negativePrompt: promptRes.data.negative_prompt,
            width: OUTPUT.width,
            height: OUTPUT.height,
            referenceImages: refs,
            label: `keyframe:${shot.id}`,
          }),
      );
      writeFileAtomic(file, res.image);
      const dims = await probeImage(file);
      const qc = await checkKeyframe(file, {
        width: dims.width,
        height: dims.height,
        bytes: res.image.length,
        expected: { width: OUTPUT.width, height: OUTPUT.height },
      });
      record.cost_usd += res.costUsd;
      record.attempts.push({
        kind: "keyframe",
        attempt,
        provider: res.provider,
        model: res.model,
        prompt: promptRes.data.prompt,
        prompt_version: promptRes.promptVersion,
        refs: refs.map((r) => run.rel(r)),
        params: { negative_prompt: promptRes.data.negative_prompt, seed: res.seed },
        latency_ms: res.latencyMs,
        cost_usd: res.costUsd,
        status: qc.pass ? "ok" : "rejected",
        error: null,
        path: run.rel(file),
        checks: qc.checks,
      });
      if (qc.pass) {
        record.keyframe = {
          path: run.rel(file),
          width: dims.width,
          height: dims.height,
          seed: res.seed,
          prompt: promptRes.data.prompt,
          prompt_version: promptRes.promptVersion,
        };
        record.status = "keyframe_ready";
        saveShotRecord(run, record);
        return;
      }
      lastFeedback = `The previous image failed checks: ${qc.checks
        .filter((c) => c.status === "fail")
        .map((c) => `${c.id} (${c.detail})`)
        .join(", ")}. Produce a clearer, fully composed frame.`;
      run.events.warn(
        stageId,
        `keyframe attempt ${attempt} rejected: ${lastFeedback}`,
        undefined,
        shot.id,
      );
      saveShotRecord(run, record);
    } catch (err) {
      record.attempts.push({
        kind: "keyframe",
        attempt,
        provider: run.providers.image.id,
        model: run.providers.image.model,
        prompt: promptRes.data.prompt,
        prompt_version: promptRes.promptVersion,
        refs: refs.map((r) => run.rel(r)),
        params: {},
        latency_ms: Date.now() - started,
        cost_usd: 0,
        status: "failed",
        error: errorMessage(err),
        path: null,
        checks: [],
      });
      saveShotRecord(run, record);
      if (err instanceof SafetyRejectionError) {
        lastFeedback =
          "The image provider rejected the previous prompt for safety. Rewrite it to convey the same moment through atmosphere and implication, with nothing that could read as harmful.";
        run.events.warn(stageId, `safety rejection, re-prompting`, undefined, shot.id);
        continue;
      }
      throw err;
    }
  }
  record.status = "failed";
  saveShotRecord(run, record);
  throw new Error(`${shot.id}: no acceptable keyframe after ${maxAttempts} attempts`);
}

/**
 * Sequential keyframe production (so each shot can reference the previous approved frame), with
 * per-shot idempotency and an optional human approval gate before any paid animation.
 */
export const keyframesStage: StageDef = {
  id: "keyframes",
  version: "1",
  dir: "07_keyframes",
  dependsOn: ["brief", "storyboard", "continuity", "route"],
  paidMedia: true,
  extraInputs: (run) => ({
    prompts: promptVersions(["image-prompter"]),
    approve: run.options.approve_keyframes,
    attempts: run.brand.profile.budget.keyframe_attempts,
  }),
  async run(ctx) {
    const { run } = ctx;
    ctx.input("brief", CreativeBriefSchema);
    const storyboard = ctx.input("storyboard", StoryboardArtifactSchema);
    const continuity = ctx.input("continuity", ContinuityBibleSchema);
    const plan = ctx.input("route", RoutingPlanSchema);
    const records: ShotRecord[] = [];
    let previousKeyframe: string | null = null;
    let previousShot: Shot | null = null;

    for (const shot of storyboard.shots) {
      const route = plan.shots.find((r) => r.shot_id === shot.id);
      if (!route) throw new Error(`no route for ${shot.id}`);
      const hash = computeShotHash(run, shot, continuity, route);
      const { record, reused } = loadOrResetShot(run, shot.id, hash, route.source);
      record.source = route.source;

      const rejected = record.approval.status === "rejected";
      if (reused && record.keyframe && fs.existsSync(run.abs(record.keyframe.path)) && !rejected) {
        run.events.debug(this.id, "keyframe up to date", undefined, shot.id);
      } else {
        if (rejected) {
          run.events.info(
            this.id,
            `regenerating after rejection: ${record.approval.note ?? ""}`,
            undefined,
            shot.id,
          );
          record.keyframe = null;
          record.video = null;
          record.final = null;
        }
        await produceKeyframe(
          run,
          this.id,
          shot,
          previousShot,
          previousKeyframe,
          record,
          continuity,
          rejected
            ? `A reviewer rejected the previous keyframe: ${record.approval.note ?? "no note"}.`
            : null,
        );
        record.approval = run.options.approve_keyframes
          ? { status: "pending", note: null }
          : { status: "none", note: null };
        record.status = run.options.approve_keyframes ? "awaiting_approval" : "keyframe_ready";
        saveShotRecord(run, record);
        run.events.info(
          this.id,
          `keyframe ready (${record.attempts.filter((a) => a.kind === "keyframe").length} attempt(s), $${record.cost_usd.toFixed(3)})`,
          undefined,
          shot.id,
        );
      }
      records.push(record);
      previousKeyframe = record.keyframe?.path ?? null;
      previousShot = shot;
    }

    ctx.writeOutput({ shots: summarize(records) });
    const pending = records.filter((r) => r.approval.status === "pending");
    if (run.options.approve_keyframes && pending.length > 0) {
      return {
        status: "waiting_approval",
        message: `${pending.length} keyframe(s) await approval. Review runs/${run.manifest.brand_id}/${run.runId}/shots/*/keyframe_v*.png, then: pnpm cli approve ${run.runId} [--reject shot_03 "note"] && pnpm cli resume ${run.runId}`,
      };
    }
    return { status: "done" };
  },
};
