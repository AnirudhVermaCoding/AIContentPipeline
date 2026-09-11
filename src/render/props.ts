import * as fs from "node:fs";
import * as path from "node:path";
import type { BrandProfile } from "../brand/schema.js";
import type { RunContext } from "../pipeline/run.js";
import type { BrandVideoProps } from "../remotion/props.js";
import type { Edl } from "../schema/edl.js";
import { ensureDir, readJson } from "../util/fs.js";

/**
 * Music volume per frame: brand gain, ducked under narration using the voice envelope, with
 * attack/release smoothing and fades. Computed once here so the composition stays pure.
 */
export function musicVolumeCurve(
  edl: Edl,
  envelope: { window_s: number; rms_db: number[] } | null,
  fps: number,
): number[] {
  const frames = Math.max(1, Math.round(edl.total_duration_s * fps));
  const gain = edl.audio.music_gain_db;
  const duck = edl.audio.ducking;
  const out: number[] = new Array(frames);
  let current = gain;
  const attackPerFrame = duck
    ? duck.attenuation_db / Math.max(1, (duck.attack_ms / 1000) * fps)
    : 0;
  const releasePerFrame = duck
    ? duck.attenuation_db / Math.max(1, (duck.release_ms / 1000) * fps)
    : 0;
  const fadeIn = Math.round(0.8 * fps);
  const fadeOut = Math.round(edl.audio.fade_out_s * fps);
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    let active = false;
    if (duck && envelope && edl.audio.voice_path) {
      const vt = t - edl.audio.voice_start_s;
      if (vt >= 0) {
        const idx = Math.floor(vt / envelope.window_s);
        const level = envelope.rms_db[idx];
        active = level !== undefined && level > -45;
      }
    }
    const target = active && duck ? gain - duck.attenuation_db : gain;
    if (current > target) current = Math.max(target, current - attackPerFrame);
    else if (current < target) current = Math.min(target, current + releasePerFrame);
    let linear = 10 ** (current / 20);
    if (f < fadeIn) linear *= f / fadeIn;
    if (f > frames - fadeOut) linear *= Math.max(0, (frames - f) / fadeOut);
    out[f] = Math.round(linear * 10000) / 10000;
  }
  return out;
}

/** Copy every asset the EDL references into the bundle's public dir and rewrite paths. */
export function stageAssets(run: RunContext, edl: Edl, publicDir: string): Edl {
  const base = path.join("runs", run.runId);
  const copy = (source: string, relTarget: string): string => {
    const target = path.join(publicDir, base, relTarget);
    ensureDir(path.dirname(target));
    if (!fs.existsSync(target)) fs.copyFileSync(source, target);
    return `${base}/${relTarget}`.split(path.sep).join("/");
  };
  const rewritten: Edl = JSON.parse(JSON.stringify(edl));
  for (const item of rewritten.timeline) {
    item.asset = copy(run.abs(item.asset), item.asset);
  }
  if (rewritten.audio.voice_path)
    rewritten.audio.voice_path = copy(
      run.abs(edl.audio.voice_path ?? ""),
      edl.audio.voice_path ?? "",
    );
  if (rewritten.audio.music_path) {
    const src = edl.audio.music_path ?? "";
    rewritten.audio.music_path = copy(
      path.isAbsolute(src) ? src : run.abs(src),
      `music/${path.basename(src)}`,
    );
  }
  if (rewritten.logo)
    rewritten.logo.path = copy(
      edl.logo?.path ?? "",
      `brand/${path.basename(edl.logo?.path ?? "logo.png")}`,
    );
  return rewritten;
}

export function buildProps(
  run: RunContext,
  edl: Edl,
  staged: Edl,
  brand: BrandProfile,
): BrandVideoProps {
  const envelope = edl.audio.envelope_path
    ? readJson<{ window_s: number; rms_db: number[] }>(run.abs(edl.audio.envelope_path))
    : null;
  return {
    edl: staged,
    brand: {
      name: brand.name,
      colors: brand.visual.colors,
      fonts: brand.visual.fonts,
      safeZone: brand.text_policy.safe_zone,
    },
    musicVolumeByFrame: staged.audio.music_path
      ? musicVolumeCurve(edl, envelope, edl.output.fps)
      : [],
    logoSrc: staged.logo ? staged.logo.path : null,
  };
}
