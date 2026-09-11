import { probeImage, probeMedia } from "../media/probe.js";
import type { ShotRecord } from "../schema/shot.js";
import { StoryboardArtifactSchema } from "../schema/storyboard.js";
import { exists } from "../util/fs.js";
import type { RunContext } from "./run.js";
import { resetFrom } from "./runner.js";
import { loadShotRecord, saveShotRecord } from "./shots.js";
import { finalizeStill } from "./stages/08-animate.js";
import { ALL_STAGES } from "./stages/index.js";

/**
 * Human review actions on a run. Every function mutates shot records / the manifest exactly the
 * way the CLI `approve` command always did, records an audit entry, and resets the right stage so
 * the next resume does only the work the decision implies (per-shot idempotency does the rest).
 */

export interface KeyframeDecision {
  shotId: string;
  decision: "approve" | "reject";
  note?: string | null;
  /** Reviewer instruction fed to the prompter when the shot is regenerated. */
  instruction?: string | null;
  /** Hand-edited prompt used verbatim on regeneration (skips the image prompter). */
  prompt?: string | null;
}

export interface ApprovalSummary {
  approved: number;
  rejected: number;
  pending: number;
}

export function storyboardShotIds(run: RunContext): string[] {
  if (!run.hasOutput("04_storyboard")) return [];
  return run.readOutput("04_storyboard", StoryboardArtifactSchema).shots.map((s) => s.id);
}

function requireRecord(run: RunContext, shotId: string): ShotRecord {
  const rec = loadShotRecord(run, shotId);
  if (!rec) throw new Error(`${shotId}: no shot record yet`);
  return rec;
}

/**
 * Apply approve/reject decisions. With `approveRemainingPending` every pending shot without an
 * explicit decision is approved (the CLI's behaviour). Rejected shots regenerate on resume with
 * the note/instruction as feedback; approved keyframes are never touched again.
 */
export function applyKeyframeDecisions(
  run: RunContext,
  decisions: KeyframeDecision[],
  opts: { approveRemainingPending?: boolean; actor?: string } = {},
): ApprovalSummary {
  const byId = new Map(decisions.map((d) => [d.shotId, d]));
  const summary: ApprovalSummary = { approved: 0, rejected: 0, pending: 0 };
  for (const shotId of storyboardShotIds(run)) {
    const rec = loadShotRecord(run, shotId);
    if (!rec?.keyframe) continue;
    const d = byId.get(shotId);
    if (d?.decision === "reject") {
      const note = d.note ?? d.instruction ?? "rejected";
      rec.approval = { status: "rejected", note };
      rec.status = "rejected";
      rec.overrides = { prompt: d.prompt ?? null, instruction: d.instruction ?? d.note ?? null };
      summary.rejected += 1;
      run.repos.audit({
        actor: opts.actor,
        action: "keyframe.reject",
        target_type: "shot",
        target_id: shotId,
        run_id: run.runId,
        shot_id: shotId,
        details: { note, instruction: d.instruction ?? null, prompt_override: !!d.prompt },
      });
    } else if (
      d?.decision === "approve" ||
      (opts.approveRemainingPending && rec.approval.status === "pending")
    ) {
      if (rec.approval.status !== "approved") {
        rec.approval = { status: "approved", note: d?.note ?? null };
        rec.status = rec.final ? rec.status : "approved";
        run.repos.audit({
          actor: opts.actor,
          action: "keyframe.approve",
          target_type: "shot",
          target_id: shotId,
          run_id: run.runId,
          shot_id: shotId,
          details: { version: keyframeVersion(rec) },
        });
        run.repos.insertAsset({
          id: `${run.runId}:${shotId}:keyframe:v${keyframeVersion(rec) ?? 0}`,
          brand_id: run.manifest.brand_id,
          run_id: run.runId,
          shot_id: shotId,
          kind: "keyframe",
          path: rec.keyframe.path,
          description: rec.keyframe.prompt.slice(0, 200),
          tags: ["approved"],
          entities: run.manifest.product_id ? [run.manifest.product_id] : [],
        });
      }
      summary.approved += 1;
    } else if (rec.approval.status === "pending") {
      summary.pending += 1;
    }
    saveShotRecord(run, rec);
  }
  const stage = run.manifest.stages.keyframes;
  if (stage) stage.status = "pending";
  run.manifest.status = "running";
  run.save();
  return summary;
}

export function keyframeVersion(rec: ShotRecord): number | null {
  const kf = rec.keyframe?.path;
  if (!kf) return null;
  const a = rec.attempts.find((x) => x.kind === "keyframe" && x.path === kf);
  return a?.attempt ?? null;
}

/** Make an earlier keyframe version the shot's keyframe again (the newer file is kept). */
export async function selectKeyframeVersion(
  run: RunContext,
  shotId: string,
  attempt: number,
  actor?: string,
): Promise<ShotRecord> {
  const rec = requireRecord(run, shotId);
  const a = rec.attempts.find(
    (x) => x.kind === "keyframe" && x.attempt === attempt && x.path && x.status !== "failed",
  );
  if (!a?.path || !exists(run.abs(a.path))) {
    throw new Error(`${shotId}: keyframe version ${attempt} is not available`);
  }
  const dims = await probeImage(run.abs(a.path));
  rec.keyframe = {
    path: a.path,
    width: dims.width,
    height: dims.height,
    seed: typeof a.params.seed === "number" ? a.params.seed : null,
    prompt: a.prompt,
    prompt_version: a.prompt_version,
  };
  rec.approval = { status: "approved", note: `selected v${attempt}` };
  rec.status = "approved";
  rec.video = null;
  rec.final = null;
  rec.overrides = { prompt: null, instruction: null };
  saveShotRecord(run, rec);
  run.repos.audit({
    actor,
    action: "keyframe.select_version",
    target_type: "shot",
    target_id: shotId,
    run_id: run.runId,
    shot_id: shotId,
    details: { version: attempt },
  });
  resetFrom(run, ALL_STAGES, "keyframes");
  return rec;
}

/** Drop the shot's clip so the animate stage regenerates only this shot on resume. */
export function requestClipRegeneration(
  run: RunContext,
  shotId: string,
  instruction: string | null = null,
  actor?: string,
): ShotRecord {
  const rec = requireRecord(run, shotId);
  if (!rec.keyframe) throw new Error(`${shotId}: no keyframe to animate`);
  rec.video = null;
  rec.final = null;
  rec.status = rec.approval.status === "approved" ? "approved" : "keyframe_ready";
  rec.overrides = { prompt: rec.overrides?.prompt ?? null, instruction };
  saveShotRecord(run, rec);
  run.repos.audit({
    actor,
    action: "clip.regenerate",
    target_type: "shot",
    target_id: shotId,
    run_id: run.runId,
    shot_id: shotId,
    details: { instruction },
  });
  resetFrom(run, ALL_STAGES, "animate");
  return rec;
}

/** Use an earlier clip version as the shot's final asset. */
export async function selectClipVersion(
  run: RunContext,
  shotId: string,
  attempt: number,
  actor?: string,
): Promise<ShotRecord> {
  const rec = requireRecord(run, shotId);
  const a = rec.attempts.find(
    (x) => x.kind === "video" && x.attempt === attempt && x.path && x.status === "ok",
  );
  if (!a?.path || !exists(run.abs(a.path))) {
    throw new Error(`${shotId}: clip version ${attempt} is not available`);
  }
  const meta = await probeMedia(run.abs(a.path));
  rec.video = { path: a.path, prompt: a.prompt, meta };
  rec.final = { path: a.path, kind: "video", meta };
  rec.status = "done";
  saveShotRecord(run, rec);
  run.repos.audit({
    actor,
    action: "clip.select_version",
    target_type: "shot",
    target_id: shotId,
    run_id: run.runId,
    shot_id: shotId,
    details: { version: attempt },
  });
  resetFrom(run, ALL_STAGES, "animate");
  return rec;
}

/** Give up on animating this shot: its approved keyframe becomes an animated still. */
export async function useStillForShot(
  run: RunContext,
  shotId: string,
  actor?: string,
): Promise<ShotRecord> {
  const rec = requireRecord(run, shotId);
  if (!rec.keyframe) throw new Error(`${shotId}: no keyframe to use as a still`);
  rec.source = "STILL_MOTION";
  rec.status = "downgraded";
  rec.video = null;
  await finalizeStill(run, rec);
  run.events.decision({
    stage: "animate",
    category: "fallback",
    subject: shotId,
    options_considered: ["retry video", "STILL_MOTION"],
    reason: "operator chose to skip animation for this shot",
    shot: shotId,
  });
  run.repos.audit({
    actor,
    action: "clip.use_still",
    target_type: "shot",
    target_id: shotId,
    run_id: run.runId,
    shot_id: shotId,
  });
  resetFrom(run, ALL_STAGES, "animate");
  return rec;
}

/** Storyboard sign-off: production may spend from here on. */
export function approveStoryboard(run: RunContext, actor?: string): void {
  run.manifest.options.dry_run = false;
  run.manifest.status = "running";
  run.save();
  run.repos.audit({
    actor,
    action: "storyboard.approve",
    target_type: "run",
    target_id: run.runId,
    run_id: run.runId,
    details: { estimated_usd: run.manifest.cost.estimated_usd },
  });
}
