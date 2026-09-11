import * as fs from "node:fs";
import * as path from "node:path";
import type { RunContext } from "../pipeline/run.js";
import type { Edl } from "../schema/edl.js";
import { ensureDir } from "../util/fs.js";
import { ffmpeg } from "./ffmpeg.js";

/**
 * FFmpeg-only finish for NONE / FINISH_ONLY: conform every shot to 720x1280@30, concat with hard
 * cuts, mix narration with music ducked by sidechain compression, normalise loudness. No text,
 * no transitions, no effects.
 */
export async function finishWithFfmpeg(run: RunContext, edl: Edl, out: string): Promise<void> {
  const { width, height, fps } = edl.output;
  const args: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  let inputIndex = 0;

  for (const item of edl.timeline) {
    const abs = run.abs(item.asset);
    const frames = Math.max(1, Math.round(item.duration_s * fps));
    if (item.kind === "video") {
      args.push("-i", abs);
      const clipLen = Math.max(0.1, item.out_s - item.in_s);
      const pad = Math.max(0, item.duration_s - clipLen);
      filters.push(
        `[${inputIndex}:v]trim=start=${item.in_s}:end=${item.out_s},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)},trim=duration=${item.duration_s},setpts=PTS-STARTPTS[v${inputIndex}]`,
      );
    } else {
      args.push("-loop", "1", "-t", (item.duration_s + 0.5).toFixed(3), "-i", abs);
      const motion =
        item.treatment === "ken_burns" || item.treatment === "parallax" ? item.treatment_amount : 0;
      const zoomTo = 1 + 0.1 * motion;
      const step = ((zoomTo - 1) / frames).toFixed(6);
      const zoom =
        motion > 0
          ? `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},zoompan=z='min(zoom+${step},${zoomTo})':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`
          : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps}`;
      filters.push(
        `[${inputIndex}:v]${zoom},trim=duration=${item.duration_s},setpts=PTS-STARTPTS[v${inputIndex}]`,
      );
    }
    labels.push(`[v${inputIndex}]`);
    inputIndex++;
  }
  filters.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=0,format=yuv420p[vout]`);

  const audioMaps: string[] = [];
  let hasAudio = false;
  const voiceIdx = edl.audio.voice_path ? inputIndex++ : -1;
  const musicIdx = edl.audio.music_path ? inputIndex++ : -1;
  if (voiceIdx >= 0) args.push("-i", run.abs(edl.audio.voice_path ?? ""));
  if (musicIdx >= 0) {
    const m = edl.audio.music_path ?? "";
    args.push("-stream_loop", "-1", "-i", path.isAbsolute(m) ? m : run.abs(m));
  }
  const delayMs = Math.round(edl.audio.voice_start_s * 1000);
  if (voiceIdx >= 0 && musicIdx >= 0) {
    const d = edl.audio.ducking;
    const fadeOutStart = Math.max(0, edl.total_duration_s - edl.audio.fade_out_s);
    filters.push(
      `[${voiceIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${delayMs}|${delayMs},apad,asplit=2[vkey][vmix]`,
      `[${musicIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${edl.audio.music_gain_db}dB,afade=t=in:d=0.8,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${edl.audio.fade_out_s}[m0]`,
      d
        ? `[m0][vkey]sidechaincompress=threshold=0.015:ratio=${Math.max(2, Math.round(d.attenuation_db / 2))}:attack=${d.attack_ms}:release=${d.release_ms}:makeup=1[m1]`
        : "[m0]anull[m1];[vkey]anullsink",
      `[vmix][m1]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`,
    );
    hasAudio = true;
  } else if (voiceIdx >= 0) {
    filters.push(
      `[${voiceIdx}:a]adelay=${delayMs}|${delayMs},apad,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`,
    );
    hasAudio = true;
  } else if (musicIdx >= 0) {
    const fadeOutStart = Math.max(0, edl.total_duration_s - edl.audio.fade_out_s);
    filters.push(
      `[${musicIdx}:a]volume=${edl.audio.music_gain_db}dB,afade=t=in:d=0.8,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${edl.audio.fade_out_s},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`,
    );
    hasAudio = true;
  }
  if (hasAudio) audioMaps.push("-map", "[aout]", "-c:a", "aac", "-b:a", "128k");
  else audioMaps.push("-an");

  ensureDir(path.dirname(out));
  const tmp = `${out}.part.mp4`;
  await ffmpeg([
    ...args,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    ...audioMaps,
    "-r",
    String(fps),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-t",
    edl.total_duration_s.toFixed(3),
    tmp,
  ]);
  fs.renameSync(tmp, out);
}
