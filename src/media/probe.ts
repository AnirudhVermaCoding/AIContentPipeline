import { ALL_FORMATS, FilePathSource, Input } from "mediabunny";
import type { AssetMeta } from "../schema/shot.js";

/** Pure-JS media probe (no ffprobe binary): duration, dimensions, fps, audio presence. */
export async function probeMedia(file: string): Promise<AssetMeta> {
  const input = new Input({ source: new FilePathSource(file), formats: ALL_FORMATS });
  try {
    const duration = await input.computeDuration();
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    let fps: number | null = null;
    let width = 0;
    let height = 0;
    if (video) {
      width = video.displayWidth;
      height = video.displayHeight;
      try {
        const stats = await video.computePacketStats(120);
        fps = Math.round(stats.averagePacketRate * 100) / 100;
      } catch {
        fps = null;
      }
    }
    return { duration_s: duration, width, height, fps, has_audio: audio !== null };
  } finally {
    input.dispose();
  }
}

export async function probeImage(file: string): Promise<{ width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(file).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}
