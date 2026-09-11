import type { QcCheck, StoryboardRiskReport } from "../schema/qc.js";
import type { Storyboard } from "../schema/storyboard.js";

/** Phrases that mark generic, interchangeable storyboards. Case-insensitive, whole-word-ish. */
export const GENERIC_PHRASES = [
  "a person",
  "a man",
  "a woman",
  "stunning",
  "breathtaking",
  "modern",
  "cutting-edge",
  "cutting edge",
  "cinematic",
  "epic",
  "beautiful",
  "high quality",
  "professional",
  "dynamic",
  "vibrant",
  "seamless",
  "next level",
  "journey",
  "unlock",
];

export interface RiskOptions {
  maxWordsOnScreen: number;
  textAllowed: boolean;
  shotRange: { min: number; max: number };
}

/**
 * Deterministic, zero-cost checks that run before any money is spent. They grade the storyboard
 * for the patterns that make AI video feel like a slideshow: repetition, genericness, decorative
 * shots, text over-reliance, missing hero moment.
 */
export function assessStoryboardRisk(sb: Storyboard, opts: RiskOptions): StoryboardRiskReport {
  const checks: QcCheck[] = [];
  const shots = sb.shots;
  const n = shots.length;
  let score = 0;
  const add = (id: string, ok: boolean, detail: string, weight = 1) => {
    checks.push({ id, status: ok ? "pass" : weight >= 1 ? "fail" : "warn", detail });
    if (!ok) score += weight;
  };

  add(
    "shot_count",
    n >= opts.shotRange.min && n <= opts.shotRange.max,
    `${n} shots (expected ${opts.shotRange.min}-${opts.shotRange.max})`,
    n < 3 || n > 14 ? 2 : 0.5,
  );

  const heroes = shots.filter((s) => s.hero_moment).length;
  add("one_hero_moment", heroes === 1, `${heroes} hero moment(s); exactly one expected`, 1);

  let longestRun = 0;
  let run = 0;
  let prev: string | null = null;
  for (const s of shots) {
    if (s.shot_size === prev && !s.hold_ok) run += 1;
    else run = 1;
    longestRun = Math.max(longestRun, run);
    prev = s.shot_size;
  }
  add(
    "shot_size_variety",
    longestRun <= 2,
    `longest run of identical shot size: ${longestRun}`,
    0.7,
  );

  const text = shots.map((s) => `${s.description} ${s.action} ${s.shot_intent}`.toLowerCase());
  const genericHits = text.filter((t) => GENERIC_PHRASES.some((p) => t.includes(p))).length;
  const genericRate = n ? genericHits / n : 0;
  add("generic_language", genericRate < 0.3, `${genericHits}/${n} shots use generic phrases`, 0.8);

  const uniqueDesc = new Set(shots.map((s) => s.description.trim().toLowerCase())).size;
  add("distinct_descriptions", uniqueDesc === n, `${uniqueDesc}/${n} distinct descriptions`, 1);

  const withIntent = shots.filter((s) => s.shot_intent.trim().split(/\s+/).length >= 4).length;
  add(
    "shot_intent_present",
    withIntent === n,
    `${withIntent}/${n} shots state why they exist`,
    0.6,
  );

  const textShots = shots.filter((s) => s.text_overlay);
  if (!opts.textAllowed) {
    add(
      "text_policy",
      textShots.length === 0,
      `${textShots.length} shots request text but the brief allows none`,
      1,
    );
  } else {
    const tooLong = textShots.filter(
      (s) => (s.text_overlay?.text.split(/\s+/).length ?? 0) > opts.maxWordsOnScreen,
    ).length;
    add(
      "text_length",
      tooLong === 0,
      `${tooLong} overlays exceed ${opts.maxWordsOnScreen} words`,
      0.5,
    );
    add(
      "text_overreliance",
      textShots.length <= Math.max(1, Math.floor(n / 3)),
      `${textShots.length}/${n} shots carry text`,
      0.7,
    );
  }

  const bakedText = shots.filter((s) =>
    /\b(logo|caption|subtitle|headline|price tag|watermark)\b/i.test(s.description),
  ).length;
  add(
    "no_baked_text",
    bakedText === 0,
    `${bakedText} descriptions ask for text inside the picture`,
    1,
  );

  const essential = shots.filter((s) => s.motion_need === "essential").length;
  add(
    "motion_restraint",
    essential <= Math.max(2, Math.ceil(n / 2)),
    `${essential}/${n} shots demand real motion`,
    0.4,
  );

  const verdict: StoryboardRiskReport["verdict"] =
    score < 1 ? "strong" : score < 2 ? "acceptable" : score < 3.5 ? "revise" : "fail";
  return { score: Math.round(score * 100) / 100, verdict, checks };
}
