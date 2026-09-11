import * as path from "node:path";
import { promptVersions } from "../agents/prompts.js";
import type { ContinuityBible } from "../schema/continuity.js";
import type { ShotRoute } from "../schema/routing.js";
import { type ShotRecord, ShotRecordSchema } from "../schema/shot.js";
import type { Shot } from "../schema/storyboard.js";
import { ensureDir, exists, nowIso, readJson, shortHash, writeJsonAtomic } from "../util/fs.js";
import type { RunContext } from "./run.js";

export const SHOTS_DIR = "shots";

export function shotDir(run: RunContext, shotId: string): string {
  return ensureDir(path.join(run.runDir, SHOTS_DIR, shotId));
}

export function shotRecordPath(run: RunContext, shotId: string): string {
  return path.join(shotDir(run, shotId), "shot.json");
}

/** Everything that, when changed, should re-produce this shot and nothing else. */
export function computeShotHash(
  run: RunContext,
  shot: Shot,
  continuity: ContinuityBible,
  route: ShotRoute,
): string {
  const per = continuity.per_shot.find((p) => p.shot_id === shot.id) ?? null;
  const entities = continuity.entities.filter((e) => shot.entities_in_frame.includes(e.id));
  return shortHash({
    shot,
    per,
    entities,
    locks: continuity.locks,
    style_bible: continuity.style_bible,
    route: { source: route.source, video_seconds: route.video_seconds },
    prompts: promptVersions(["image-prompter", "motion-prompter"]),
    image: run.manifest.providers.image,
    video: run.manifest.providers.video,
    brand: run.manifest.brand_config_version,
  });
}

export function loadShotRecord(run: RunContext, shotId: string): ShotRecord | null {
  const file = shotRecordPath(run, shotId);
  return exists(file) ? readJson(file, ShotRecordSchema) : null;
}

export function newShotRecord(
  shotId: string,
  shotHash: string,
  source: ShotRecord["source"],
): ShotRecord {
  return {
    shot_id: shotId,
    status: "pending",
    shot_hash: shotHash,
    source,
    approval: { status: "none", note: null },
    attempts: [],
    keyframe: null,
    video: null,
    final: null,
    cost_usd: 0,
    updated_at: nowIso(),
  };
}

export function saveShotRecord(run: RunContext, record: ShotRecord): void {
  record.updated_at = nowIso();
  writeJsonAtomic(shotRecordPath(run, record.shot_id), record);
  run.repos.upsertShot(run.runId, record);
}

/** Load a record if it belongs to the current shot hash; otherwise start a fresh one. */
export function loadOrResetShot(
  run: RunContext,
  shotId: string,
  shotHash: string,
  source: ShotRecord["source"],
): { record: ShotRecord; reused: boolean } {
  const existing = loadShotRecord(run, shotId);
  if (existing && existing.shot_hash === shotHash) return { record: existing, reused: true };
  if (existing) {
    run.events.info(null, `${shotId}: inputs changed, re-producing`, undefined, shotId);
  }
  return { record: newShotRecord(shotId, shotHash, source), reused: false };
}

export interface ShotSummary {
  shot_id: string;
  status: ShotRecord["status"];
  source: ShotRecord["source"];
  keyframe: string | null;
  video: string | null;
  final: string | null;
  attempts: number;
  cost_usd: number;
  approval: ShotRecord["approval"]["status"];
}

export function summarize(records: ShotRecord[]): ShotSummary[] {
  return records.map((r) => ({
    shot_id: r.shot_id,
    status: r.status,
    source: r.source,
    keyframe: r.keyframe?.path ?? null,
    video: r.video?.path ?? null,
    final: r.final?.path ?? null,
    attempts: r.attempts.length,
    cost_usd: Math.round(r.cost_usd * 1000) / 1000,
    approval: r.approval.status,
  }));
}
