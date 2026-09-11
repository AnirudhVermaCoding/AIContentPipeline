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
