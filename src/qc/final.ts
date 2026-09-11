import type { BrandProfile } from "../brand/schema.js";
import type { CreativeBrief } from "../schema/brief.js";
import type { Edl } from "../schema/edl.js";
import type { FinalQcReport, QcCheck } from "../schema/qc.js";
import type { AssetMeta } from "../schema/shot.js";

export interface FinalQcInput {
  brand: BrandProfile;
  brief: CreativeBrief;
  edl: Edl;
  probe: AssetMeta;
  fileBytes: number;
  integratedLufs: number | null;
  /** Seconds of generated video that actually made the cut, and the share of runtime it covers. */
  generatedSeconds: number;
  motionRatio: number;
  downgradeLogged: boolean;
}

/**
 * Deterministic final checks on the rendered file: format, duration, audio, loudness, text safe
 * zones, and the motion promise. Vision checks can be layered on later behind the same report.
 */
export function assessFinal(input: FinalQcInput): FinalQcReport {
  const checks: QcCheck[] = [];
  const { brand, brief, edl, probe } = input;
  const push = (id: string, status: QcCheck["status"], detail: string) =>
    checks.push({ id, status, detail });

  push(
    "resolution",
    probe.width === edl.output.width && probe.height === edl.output.height ? "pass" : "fail",
    `${probe.width}x${probe.height} (expected ${edl.output.width}x${edl.output.height})`,
  );
  push(
    "fps",
    probe.fps === null ? "warn" : Math.abs(probe.fps - edl.output.fps) <= 1 ? "pass" : "warn",
    `${probe.fps ?? "unknown"} fps (expected ${edl.output.fps})`,
  );
  const durationDelta = Math.abs(probe.duration_s - edl.total_duration_s);
  push(
    "duration_matches_edl",
    durationDelta < 0.6 ? "pass" : "warn",
    `${probe.duration_s.toFixed(2)}s vs EDL ${edl.total_duration_s.toFixed(2)}s`,
  );
  const short = edl.mode === "NONE" || edl.mode === "FINISH_ONLY";
  const min = short ? brief.target_duration_s * 0.5 : brand.pacing.duration_s.min * 0.85;
  const max = short ? brief.target_duration_s * 1.25 : brand.pacing.duration_s.max * 1.15;
  push(
    "duration_in_range",
    probe.duration_s >= min && probe.duration_s <= max ? "pass" : "warn",
    `${probe.duration_s.toFixed(1)}s (expected ${min.toFixed(0)}-${max.toFixed(0)}s for ${edl.mode})`,
  );
  const expectsAudio = !!(edl.audio.voice_path || edl.audio.music_path);
  push(
    "audio_present",
    !expectsAudio ? "pass" : probe.has_audio ? "pass" : "fail",
    expectsAudio
      ? probe.has_audio
        ? "audio track present"
        : "audio track missing"
      : "silent by design",
  );
  if (expectsAudio) {
    const l = input.integratedLufs;
    push(
      "loudness",
      l === null ? "warn" : l >= -19 && l <= -10 ? "pass" : "warn",
      l === null ? "could not measure" : `${l.toFixed(1)} LUFS (target -14 ±4)`,
    );
  }
  push(
    "file_size",
    input.fileBytes > 200_000 ? "pass" : "fail",
    `${Math.round(input.fileBytes / 1024)} KB`,
  );

  // Text safe zones: overlays are placed inside the brand's safe area by construction; verify word counts.
  const tooLong = edl.text_overlays.filter(
    (o) => o.text.trim().split(/\s+/).length > brand.text_policy.max_words_on_screen,
  );
  push(
    "text_policy",
    tooLong.length === 0 ? "pass" : "warn",
    `${edl.text_overlays.length} overlay(s); ${tooLong.length} exceed ${brand.text_policy.max_words_on_screen} words`,
  );
  const hookOnly =
    brand.text_policy.captions === "brand_hook_only" || brand.text_policy.captions === "never";
  push(
    "text_restraint",
    hookOnly && (edl.text_overlays.length > 1 || edl.captions) ? "fail" : "pass",
    `${edl.text_overlays.length} overlay(s), captions ${edl.captions ? "on" : "off"} (policy ${brand.text_policy.captions})`,
  );

  // Motion promise on what actually shipped.
  const p = brief.motion_promise;
  const met = input.generatedSeconds >= p.min_ai_video_s && input.motionRatio >= p.min_motion_ratio;
  push(
    "motion_promise",
    met ? "pass" : input.downgradeLogged ? "warn" : "fail",
    `${input.generatedSeconds}s generated (promise ≥ ${p.min_ai_video_s}s), ratio ${input.motionRatio.toFixed(2)} (≥ ${p.min_motion_ratio})${met ? "" : input.downgradeLogged ? "; downgrade was logged" : "; SILENT DOWNGRADE"}`,
  );

  const status: FinalQcReport["status"] = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "warn")
      ? "pass_with_warnings"
      : "pass";
  return {
    status,
    checks,
    probe: {
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      duration_s: probe.duration_s,
      has_audio: probe.has_audio,
      integrated_lufs: input.integratedLufs,
    },
  };
}
