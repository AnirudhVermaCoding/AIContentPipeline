import { z } from "zod";

/**
 * Closed vocabularies shared by several artifacts. Keeping these as enums (rather than prose)
 * lets deterministic checks reason about the storyboard before any money is spent.
 */

export const ShotSize = z.enum([
  "extreme_wide",
  "wide",
  "medium_wide",
  "medium",
  "medium_close",
  "close_up",
  "extreme_close_up",
  "insert",
]);
export type ShotSize = z.infer<typeof ShotSize>;

export const CameraAngle = z.enum([
  "eye_level",
  "low",
  "high",
  "overhead",
  "dutch",
  "over_the_shoulder",
  "pov",
]);
export type CameraAngle = z.infer<typeof CameraAngle>;

export const CameraMovement = z.enum([
  "static",
  "handheld_subtle",
  "slow_push_in",
  "slow_pull_out",
  "pan_left",
  "pan_right",
  "tilt_up",
  "tilt_down",
  "tracking",
  "orbit",
  "crane_up",
  "crane_down",
  "rack_focus",
]);
export type CameraMovement = z.infer<typeof CameraMovement>;

export const Lens = z.enum(["24mm", "35mm", "50mm", "85mm", "100mm_macro", "135mm"]);
export type Lens = z.infer<typeof Lens>;

export const Importance = z.enum(["hero", "support", "filler"]);
export type Importance = z.infer<typeof Importance>;

export const MotionNeed = z.enum(["none", "subtle", "essential"]);
export type MotionNeed = z.infer<typeof MotionNeed>;

export const NarrativeRole = z.enum([
  "hook",
  "establish",
  "introduce",
  "build",
  "payoff",
  "emotional_beat",
  "evidence",
  "resolution",
  "cta",
]);
export type NarrativeRole = z.infer<typeof NarrativeRole>;

export const AssetSource = z.enum(["REUSE", "STOCK", "STILL", "STILL_MOTION", "GEN_VIDEO"]);
export type AssetSource = z.infer<typeof AssetSource>;

export const EditMode = z.enum(["NONE", "FINISH_ONLY", "LIGHT", "ASSEMBLY"]);
export type EditMode = z.infer<typeof EditMode>;

export const TextOverlayIntent = z.enum(["none", "hook_only", "captions"]);
export type TextOverlayIntent = z.infer<typeof TextOverlayIntent>;

export const ResearchDepth = z.enum(["none", "light", "deep"]);
export type ResearchDepth = z.infer<typeof ResearchDepth>;

export const MotionPromiseKind = z.enum(["motion_led", "mixed", "still_led"]);
export type MotionPromiseKind = z.infer<typeof MotionPromiseKind>;

export const StillTreatment = z.enum(["none", "ken_burns", "parallax", "hold"]);
export type StillTreatment = z.infer<typeof StillTreatment>;

export const OUTPUT = { width: 720, height: 1280, fps: 30 } as const;
