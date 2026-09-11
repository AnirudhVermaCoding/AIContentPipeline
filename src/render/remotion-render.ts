import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { dataDir } from "../config/env.js";
import type { RunContext } from "../pipeline/run.js";
import { COMPOSITION_ID } from "../remotion/props.js";
import type { Edl } from "../schema/edl.js";
import { ensureDir, sha256, sha256File } from "../util/fs.js";
import { buildProps, stageAssets } from "./props.js";

const remotionSrc = () => fileURLToPath(new URL("../remotion/", import.meta.url));
const packageRoot = () => fileURLToPath(new URL("../../", import.meta.url));

function hashDir(dir: string): string {
  const parts: string[] = [];
  const walk = (d: string) => {
    for (const e of fs
      .readdirSync(d, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else parts.push(`${path.relative(dir, p)}:${sha256File(p)}`);
    }
  };
  walk(dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot(), "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  parts.push(`remotion:${pkg.dependencies?.remotion ?? ""}`);
  parts.push(`schema:${sha256File(path.join(packageRoot(), "src/schema/edl.ts"))}`);
  return sha256(parts.join("\n")).slice(0, 16);
}

/** Bundle once per source hash; reuse across runs. */
export async function ensureBundle(
  log?: (m: string) => void,
): Promise<{ serveUrl: string; publicDir: string }> {
  const hash = hashDir(remotionSrc());
  const outDir = path.join(dataDir(), "remotion-bundle", hash);
  const publicDir = path.join(outDir, "public");
  if (fs.existsSync(path.join(outDir, "index.html"))) {
    ensureDir(publicDir);
    return { serveUrl: outDir, publicDir };
  }
  log?.(`bundling Remotion composition (${hash})`);
  const emptyPublic = ensureDir(path.join(dataDir(), "remotion-bundle", "empty-public"));
  const serveUrl = await bundle({
    entryPoint: path.join(remotionSrc(), "index.ts"),
    rootDir: packageRoot(),
    outDir,
    publicDir: emptyPublic,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
      },
    }),
  });
  ensureDir(publicDir);
  return { serveUrl, publicDir };
}

/**
 * Optional override for machines that cannot download Remotion's chrome-headless-shell
 * (REMOTION_BROWSER_EXECUTABLE). Set REMOTION_CHROME_MODE=chrome-for-testing when pointing at a
 * full Chrome binary instead of a headless shell.
 */
export function browserExecutable(): string | null {
  const fromEnv = process.env.REMOTION_BROWSER_EXECUTABLE;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  return null;
}

function chromeMode(): "headless-shell" | "chrome-for-testing" {
  return process.env.REMOTION_CHROME_MODE === "chrome-for-testing"
    ? "chrome-for-testing"
    : "headless-shell";
}

export async function renderWithRemotion(
  run: RunContext,
  edl: Edl,
  outputLocation: string,
  log?: (m: string) => void,
): Promise<void> {
  const { serveUrl, publicDir } = await ensureBundle(log);
  const staged = stageAssets(run, edl, publicDir);
  const inputProps = buildProps(run, edl, staged, run.brand.profile) as unknown as Record<
    string,
    unknown
  >;
  const exe = browserExecutable();
  if (!exe) await ensureBrowser();
  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
    chromeMode: chromeMode(),
    ...(exe ? { browserExecutable: exe } : {}),
  });
  const durationInFrames = Math.max(1, Math.round(edl.total_duration_s * edl.output.fps));
  log?.(`rendering ${durationInFrames} frames at ${edl.output.width}x${edl.output.height}`);
  await renderMedia({
    composition: {
      ...composition,
      width: edl.output.width,
      height: edl.output.height,
      fps: edl.output.fps,
      durationInFrames,
    },
    serveUrl,
    codec: "h264",
    crf: 20,
    outputLocation,
    inputProps,
    ...(exe ? { browserExecutable: exe } : {}),
    chromeMode: chromeMode(),
    chromiumOptions: { gl: "swangle" },
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct % 25 === 0) log?.(`render ${pct}%`);
    },
  });
  // Per-run assets are not needed in the bundle after the render.
  fs.rmSync(path.join(publicDir, "runs", run.runId), { recursive: true, force: true });
}
