import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import { ensureDir } from "../util/fs.js";

const execFileAsync = promisify(execFile);

export function ffmpegPath(): string {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  throw new Error(
    "ffmpeg binary not found. Run `pnpm install` (ffmpeg-static downloads it) or set FFMPEG_PATH.",
  );
}

export async function ffmpeg(args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
  const { stderr } = await execFileAsync(ffmpegPath(), ["-hide_banner", "-y", ...args], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 600_000,
  });
  return stderr;
}

/** Write to a `.part` sibling, then rename, so consumers never see a half-written file. */
async function withAtomicOutput(out: string, fn: (tmp: string) => Promise<void>): Promise<string> {
  ensureDir(path.dirname(out));
  const tmp = `${out}.part${path.extname(out)}`;
  await fn(tmp);
  fs.renameSync(tmp, out);
  return out;
}

/** A silent-ish test tone WAV of the given length (mock TTS). */
export async function makeToneWav(out: string, seconds: number, hz = 220): Promise<string> {
  return withAtomicOutput(out, async (tmp) => {
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${hz}:sample_rate=44100:duration=${seconds.toFixed(3)}`,
      "-af",
      "volume=0.15",
      "-ac",
      "1",
      tmp,
    ]);
  });
}

/** Concatenate audio files with a fixed gap of silence between them; returns total seconds. */
export async function concatAudioWithGaps(
  files: string[],
  gapSeconds: number,
  out: string,
): Promise<string> {
  if (files.length === 0) throw new Error("concatAudioWithGaps: no input files");
  return withAtomicOutput(out, async (tmp) => {
    const args: string[] = [];
    for (const f of files) args.push("-i", f);
    const parts: string[] = [];
    let filter = "";
    files.forEach((_f, i) => {
      // Normalise every input to mono 44.1 kHz, then pad the gap after it (except the last).
      const pad = i < files.length - 1 ? `,apad=pad_dur=${gapSeconds}` : "";
      filter += `[${i}:a]aformat=sample_rates=44100:channel_layouts=mono${pad}[a${i}];`;
      parts.push(`[a${i}]`);
    });
    filter += `${parts.join("")}concat=n=${files.length}:v=0:a=1[out]`;
    await ffmpeg([
      ...args,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      tmp,
    ]);
  });
}

/** Animate a still into a short clip with a slow push-in (mock video, or STILL_MOTION fallback). */
export async function imageToVideo(
  image: string,
  out: string,
  opts: { seconds: number; width: number; height: number; fps?: number; zoomTo?: number },
): Promise<string> {
  const fps = opts.fps ?? 24;
  const frames = Math.round(opts.seconds * fps);
  const zoomTo = opts.zoomTo ?? 1.08;
  const zoomStep = ((zoomTo - 1) / frames).toFixed(6);
  return withAtomicOutput(out, async (tmp) => {
    await ffmpeg([
      "-loop",
      "1",
      "-i",
      image,
      "-vf",
      `scale=${opts.width * 2}:${opts.height * 2}:force_original_aspect_ratio=increase,crop=${opts.width * 2}:${opts.height * 2},zoompan=z='min(zoom+${zoomStep},${zoomTo})':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${opts.width}x${opts.height}:fps=${fps},format=yuv420p`,
      "-t",
      opts.seconds.toFixed(3),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-an",
      tmp,
    ]);
  });
}

/** Extract one frame at `seconds` as PNG. */
export async function extractFrame(video: string, seconds: number, out: string): Promise<string> {
  return withAtomicOutput(out, async (tmp) => {
    await ffmpeg(["-ss", seconds.toFixed(3), "-i", video, "-frames:v", "1", tmp]);
  });
}

/** Integrated loudness (LUFS) via ebur128; null if it cannot be measured. */
export async function integratedLoudness(file: string): Promise<number | null> {
  try {
    const log = await ffmpeg([
      "-i",
      file,
      "-filter_complex",
      "ebur128=peak=true",
      "-f",
      "null",
      "-",
    ]);
    const m = log.match(/I:\s+(-?[\d.]+)\s+LUFS/g);
    if (!m || m.length === 0) return null;
    const last = m[m.length - 1]?.match(/(-?[\d.]+)/);
    return last ? Number(last[1]) : null;
  } catch {
    return null;
  }
}

/** RMS envelope of an audio file, one value per window (seconds). */
export async function audioEnvelope(file: string, windowS = 0.1): Promise<number[]> {
  const { stdout } = await execFileAsync(
    ffmpegPath(),
    [
      "-hide_banner",
      "-i",
      file,
      "-af",
      `aresample=8000,astats=metadata=1:reset=${Math.max(1, Math.round((windowS * 8000) / 1024))},ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`,
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const values: number[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/RMS_level=(-?[\d.]+|-inf)/);
    if (m) values.push(m[1] === "-inf" ? -90 : Number(m[1]));
  }
  return values;
}
