import * as fs from "node:fs";
import * as path from "node:path";
import { brandsRoot, loadBrand } from "../../brand/loader.js";
import { dataDir, env, providerMode, repoRoot, runsDir } from "../../config/env.js";
import { PRICING_AS_OF, pricingIsStale } from "../../config/pricing.js";
import {
  DEFAULT_PROVIDERS,
  type ProviderSettings,
  resolveProviders,
} from "../../config/settings.js";
import type { Db } from "../../db/sqlite.js";
import { ffmpegPath } from "../../media/ffmpeg.js";
import {
  checkProviders,
  IMAGE_ADAPTERS,
  LLM_ADAPTERS,
  TTS_ADAPTERS,
  VIDEO_ADAPTERS,
} from "../../providers/registry.js";
import { browserExecutable } from "../../render/remotion-render.js";
import type { HealthReport, ProviderStatus, ToolStatus } from "../api-types.js";

async function probe(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; detail: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    return { ok: res.ok, detail: res.ok ? "connected" : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Free-of-charge connectivity probes where a vendor offers one; never a paid call. */
async function connectivity(
  provider: string,
): Promise<{ status: ProviderStatus["connectivity"]; detail: string | null }> {
  if (provider === "openai") {
    const key = env("OPENAI_API_KEY");
    if (!key) return { status: "unknown", detail: null };
    const r = await probe("https://api.openai.com/v1/models?limit=1", {
      Authorization: `Bearer ${key}`,
    });
    return { status: r.ok ? "connected" : "unreachable", detail: r.detail };
  }
  if (provider === "cartesia") {
    const key = env("CARTESIA_API_KEY");
    if (!key) return { status: "unknown", detail: null };
    const r = await probe("https://api.cartesia.ai/voices?limit=1", {
      "X-API-Key": key,
      "Cartesia-Version": "2025-04-16",
    });
    return { status: r.ok ? "connected" : "unreachable", detail: r.detail };
  }
  if (provider === "elevenlabs") {
    const key = env("ELEVENLABS_API_KEY");
    if (!key) return { status: "unknown", detail: null };
    const r = await probe("https://api.elevenlabs.io/v1/user", { "xi-api-key": key });
    return { status: r.ok ? "connected" : "unreachable", detail: r.detail };
  }
  return { status: "not_checked", detail: "no free status endpoint; verified on first call" };
}

export async function healthReport(
  db: Db,
  brandId: string | null,
  opts: { probe?: boolean } = {},
): Promise<HealthReport> {
  let settings: ProviderSettings = DEFAULT_PROVIDERS;
  if (brandId) {
    try {
      settings = resolveProviders(loadBrand(brandId).profile);
    } catch {
      settings = DEFAULT_PROVIDERS;
    }
  }
  const check = checkProviders(settings);
  const table: Array<
    [
      ProviderStatus["capability"],
      { provider: string; model: string },
      Array<{ id: string; envKeys: string[] }>,
    ]
  > = [
    ["llm_creative", settings.llm_creative, LLM_ADAPTERS],
    ["llm_fast", settings.llm_fast, LLM_ADAPTERS],
    ["image", settings.image, IMAGE_ADAPTERS],
    ["video", settings.video, VIDEO_ADAPTERS],
    ["tts", settings.tts, TTS_ADAPTERS],
  ];
  const providers: ProviderStatus[] = [];
  for (const [capability, choice, adapters] of table) {
    const entry = adapters.find((a) => a.id === choice.provider);
    const envKeys = entry?.envKeys ?? [];
    const configured = envKeys.every((k) => !!env(k));
    const priced = !check.unpriced.some((u) => u.capability === capability);
    const conn =
      opts.probe && configured
        ? await connectivity(choice.provider)
        : { status: "not_checked" as const, detail: null };
    providers.push({
      capability,
      provider: choice.provider,
      model: choice.model,
      env_keys: envKeys,
      configured,
      priced,
      connectivity: configured ? conn.status : "unknown",
      detail: !configured ? `${envKeys.join(", ")} missing` : conn.detail,
    });
  }
  const tools: ToolStatus[] = [];
  try {
    const p = ffmpegPath();
    tools.push({
      id: "ffmpeg",
      label: "FFmpeg",
      status: fs.existsSync(p) ? "ready" : "missing",
      detail: p,
    });
  } catch (err) {
    tools.push({
      id: "ffmpeg",
      label: "FFmpeg",
      status: "missing",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  const exe = browserExecutable();
  const remotionCache = path.join(repoRoot(), "node_modules", ".remotion");
  const chromiumReady = !!exe || fs.existsSync(remotionCache);
  tools.push({
    id: "chromium",
    label: "Chromium (headless)",
    status: chromiumReady ? "ready" : "missing",
    detail: exe
      ? exe
      : fs.existsSync(remotionCache)
        ? "Remotion-managed browser cached"
        : "will be downloaded by Remotion on first render (or set REMOTION_BROWSER_EXECUTABLE)",
  });
  const bundleDir = path.join(dataDir(), "remotion-bundle");
  const bundled =
    fs.existsSync(bundleDir) &&
    fs.readdirSync(bundleDir).some((d) => fs.existsSync(path.join(bundleDir, d, "index.html")));
  tools.push({
    id: "remotion",
    label: "Remotion",
    status: "ready",
    detail: bundled ? "composition bundle cached" : "composition will be bundled on first render",
  });
  try {
    const qc = db.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    tools.push({
      id: "sqlite",
      label: "SQLite",
      status: qc?.quick_check === "ok" ? "ready" : "error",
      detail: path.join(dataDir(), "pipeline.db"),
    });
  } catch (err) {
    tools.push({
      id: "sqlite",
      label: "SQLite",
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    fs.mkdirSync(runsDir(), { recursive: true });
    fs.accessSync(runsDir(), fs.constants.W_OK);
    tools.push({ id: "runs_dir", label: "Runs folder", status: "ready", detail: runsDir() });
  } catch (err) {
    tools.push({
      id: "runs_dir",
      label: "Runs folder",
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  return {
    provider_mode: providerMode(),
    providers,
    tools,
    pricing: { as_of: PRICING_AS_OF, stale: pricingIsStale() },
    paths: { root: repoRoot(), runs: runsDir(), data: dataDir(), brands: brandsRoot() },
    checked_at: new Date().toISOString(),
  };
}
