import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "../config/env.js";
import { ensureDir } from "../util/fs.js";
import { ffmpeg } from "./ffmpeg.js";

export interface MusicTrack {
  id: string;
  file: string;
  mood_tags: string[];
  energy: "low" | "medium" | "high";
  duration_s: number;
  license?: string;
  source?: string;
}

export function musicDir(): string {
  return (
    process.env.AICP_MUSIC_DIR ?? fileURLToPath(new URL("../../assets/music/", import.meta.url))
  );
}

export function loadMusicLibrary(): MusicTrack[] {
  const file = path.join(musicDir(), "music.json");
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { tracks?: MusicTrack[] };
  return (raw.tracks ?? []).filter((t) => fs.existsSync(path.join(musicDir(), t.file)));
}

/** Score tracks by tag overlap and energy match; null when nothing fits. */
export function pickTrack(
  library: MusicTrack[],
  moodTags: string[],
  energy: "low" | "medium" | "high",
): { track: MusicTrack; path: string; score: number } | null {
  const wanted = new Set(moodTags.map((t) => t.toLowerCase()));
  let best: { track: MusicTrack; score: number } | null = null;
  for (const t of library) {
    const overlap = t.mood_tags.filter((x) => wanted.has(x.toLowerCase())).length;
    const score = overlap + (t.energy === energy ? 0.5 : 0);
    if (score > 0 && (!best || score > best.score)) best = { track: t, score };
  }
  return best ? { ...best, path: path.join(musicDir(), best.track.file) } : null;
}

/** A quiet synthetic bed (filtered noise with slow movement) for mock runs only. */
export async function ensureMockBed(seconds = 70): Promise<string> {
  const dir = ensureDir(path.join(dataDir(), "mock-music"));
  const file = path.join(dir, `bed-${seconds}s.mp3`);
  if (fs.existsSync(file)) return file;
  const tmp = `${file}.part.mp3`;
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=color=brown:sample_rate=44100:duration=${seconds}:amplitude=0.3`,
    "-af",
    "lowpass=f=600,tremolo=f=0.15:d=0.4,volume=0.6",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "96k",
    tmp,
  ]);
  fs.renameSync(tmp, file);
  return file;
}

/** Copy a track into the library, measure it and register it in music.json. */
export async function addTrack(opts: {
  file: string;
  id?: string;
  moodTags: string[];
  energy: "low" | "medium" | "high";
  license?: string;
  source?: string;
}): Promise<MusicTrack> {
  const { probeMedia } = await import("./probe.js");
  if (!fs.existsSync(opts.file)) throw new Error(`No such file: ${opts.file}`);
  const dir = ensureDir(musicDir());
  const id = (opts.id ?? path.basename(opts.file, path.extname(opts.file)))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const target = path.join(dir, `${id}${path.extname(opts.file).toLowerCase() || ".mp3"}`);
  if (path.resolve(target) !== path.resolve(opts.file)) fs.copyFileSync(opts.file, target);
  const meta = await probeMedia(target);
  const track: MusicTrack = {
    id,
    file: path.basename(target),
    mood_tags: opts.moodTags.map((t) => t.trim().toLowerCase()).filter(Boolean),
    energy: opts.energy,
    duration_s: Math.round(meta.duration_s * 10) / 10,
    ...(opts.license ? { license: opts.license } : {}),
    ...(opts.source ? { source: opts.source } : {}),
  };
  const catalog = path.join(dir, "music.json");
  const raw = fs.existsSync(catalog)
    ? (JSON.parse(fs.readFileSync(catalog, "utf8")) as { tracks?: MusicTrack[] })
    : {};
  const tracks = (raw.tracks ?? []).filter((t) => t.id !== id);
  tracks.push(track);
  fs.writeFileSync(catalog, `${JSON.stringify({ tracks }, null, 2)}\n`);
  return track;
}
