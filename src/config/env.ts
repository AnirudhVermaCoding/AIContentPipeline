import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Minimal .env loader: reads ./.env once, never overrides variables already set in the process.
 * Kept in-house to avoid depending on CLI flag pass-through across tsx / node versions.
 */
let loaded = false;
export function loadEnv(cwd: string = process.cwd()): void {
  if (loaded) return;
  loaded = true;
  const file = path.join(cwd, ".env");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

export function requireEnv(name: string, hint: string): string {
  const v = env(name);
  if (!v) {
    throw new Error(`Missing environment variable ${name}. ${hint}`);
  }
  return v;
}

export function providerMode(): "live" | "mock" {
  return env("PROVIDER_MODE") === "mock" ? "mock" : "live";
}

export function runsDir(): string {
  return path.resolve(env("AICP_RUNS_DIR") ?? "runs");
}

export function dataDir(): string {
  return path.resolve(env("AICP_DATA_DIR") ?? "data");
}
