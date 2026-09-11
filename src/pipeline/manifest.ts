import * as fs from "node:fs";
import * as path from "node:path";
import { runsDir } from "../config/env.js";
import { type RunManifest, RunManifestSchema } from "../schema/manifest.js";
import { exists, nowIso, readJson, writeJsonAtomic } from "../util/fs.js";

export const MANIFEST_FILE = "manifest.json";

export function newRunId(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${rand}`;
}

export function runDirFor(brandId: string, runId: string, root: string = runsDir()): string {
  return path.join(root, brandId, runId);
}

export function manifestPath(runDir: string): string {
  return path.join(runDir, MANIFEST_FILE);
}

export function loadManifest(runDir: string): RunManifest {
  const file = manifestPath(runDir);
  if (!exists(file)) throw new Error(`No run manifest at ${file}`);
  return readJson(file, RunManifestSchema);
}

export function saveManifest(runDir: string, manifest: RunManifest): void {
  manifest.updated_at = nowIso();
  writeJsonAtomic(manifestPath(runDir), manifest);
}

/** Find a run directory by id by scanning brand folders (the DB is only an index). */
export function findRunDir(runId: string, root: string = runsDir()): string | null {
  if (!fs.existsSync(root)) return null;
  for (const brand of fs.readdirSync(root, { withFileTypes: true })) {
    if (!brand.isDirectory()) continue;
    const candidate = path.join(root, brand.name, runId);
    if (exists(manifestPath(candidate))) return candidate;
  }
  return null;
}
