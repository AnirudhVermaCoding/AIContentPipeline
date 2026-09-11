import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { z } from "zod";

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write bytes to `<file>.part` then rename, so a crash never leaves a half-written artifact. */
export function writeFileAtomic(file: string, data: Buffer | string): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function writeJsonAtomic(file: string, value: unknown): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson<T>(file: string, schema?: z.ZodType<T>): T {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!schema) return raw as T;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid artifact ${file}: ${issues}`);
  }
  return parsed.data;
}

export function exists(file: string): boolean {
  return fs.existsSync(file);
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256File(file: string): string {
  return sha256(fs.readFileSync(file));
}

export function shortHash(value: unknown, length = 16): string {
  return sha256(stableStringify(value)).slice(0, length);
}

/** Deterministic JSON: sorted object keys at every level. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function appendJsonl(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

export function nowIso(): string {
  return new Date().toISOString();
}
