import * as fs from "node:fs";
import * as path from "node:path";
import { promptVersions } from "../agents/prompts.js";
import { creativeHashInputs } from "../creative/controls.js";
import type { ContinuityBible } from "../schema/continuity.js";
import type { ShotRoute } from "../schema/routing.js";
import { type ShotRecord, ShotRecordSchema } from "../schema/shot.js";
import type { Shot } from "../schema/storyboard.js";
import { ensureDir, exists, nowIso, readJson, shortHash, writeJsonAtomic } from "../util/fs.js";
import type { RunContext } from "./run.js";

export const SHOTS_DIR = "shots";
export const SHOT_HISTORY_DIR = "history";

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
    // Creative controls shape the image/motion prompts; absent on pre-control runs (same hash).
    ...creativeHashInputs(run.manifest),
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

/** Records superseded by a hash change, kept so every paid attempt stays inspectable. */
export function listShotHistory(run: RunContext, shotId: string): ShotRecord[] {
  const dir = path.join(shotDir(run, shotId), SHOT_HISTORY_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJson(path.join(dir, f), ShotRecordSchema));
}

function archiveShotRecord(run: RunContext, record: ShotRecord): void {
  const dir = ensureDir(path.join(shotDir(run, record.shot_id), SHOT_HISTORY_DIR));
  const stamp = record.updated_at.replace(/[:.]/g, "-");
  writeJsonAtomic(path.join(dir, `${stamp}-${record.shot_hash}.json`), record);
}

/**
 * Load a record if it belongs to the current shot hash; otherwise archive it and start a fresh
 * one. Version numbers keep counting from the files on disk, so nothing is ever overwritten.
 */
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
    archiveShotRecord(run, existing);
  }
  return { record: newShotRecord(shotId, shotHash, source), reused: false };
}

const VERSION_FILE: Record<"keyframe" | "video", RegExp> = {
  keyframe: /^keyframe_v(\d+)\.png$/,
  video: /^video_v(\d+)\.mp4$/,
};

/**
 * Next version number for a shot's keyframe or clip: one past the highest version present on
 * disk or recorded in any attempt (current or archived), never a number already used.
 */
export function nextAttemptNumber(
  run: RunContext,
  shotId: string,
  kind: "keyframe" | "video",
  record?: ShotRecord | null,
): number {
  const dir = shotDir(run, shotId);
  let max = 0;
  for (const f of fs.readdirSync(dir)) {
    const m = VERSION_FILE[kind].exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const records = [record ?? loadShotRecord(run, shotId), ...listShotHistory(run, shotId)];
  for (const r of records) {
    if (!r) continue;
    for (const a of r.attempts) if (a.kind === kind) max = Math.max(max, a.attempt);
  }
  return max + 1;
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
