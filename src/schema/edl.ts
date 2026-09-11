import { z } from "zod";
import { EditMode, StillTreatment } from "./common.js";

export const TimelineItem = z.object({
  shot_id: z.string(),
  asset: z.string().describe("Path relative to the run dir"),
  kind: z.enum(["video", "image"]),
  in_s: z.number().describe("Trim start inside the asset"),
  out_s: z.number().describe("Trim end inside the asset"),
  start_s: z.number().describe("Position on the timeline"),
  duration_s: z.number(),
  treatment: StillTreatment,
  treatment_amount: z.number().describe("0-1, how much motion a still treatment applies"),
  fit: z.enum(["cover", "contain"]),
});
export type TimelineItem = z.infer<typeof TimelineItem>;

export const TextOverlay = z.object({
  text: z.string(),
  role: z.enum(["hook", "emphasis", "cta"]),
  start_s: z.number(),
  end_s: z.number(),
  position: z.enum(["top_safe", "center", "lower_third"]),
  style: z.enum(["brand_heading", "brand_body"]),
});
export type TextOverlay = z.infer<typeof TextOverlay>;

export const Transition = z.object({
  after_shot: z.string(),
  type: z.enum(["cut", "dissolve"]),
  duration_s: z.number(),
  reason: z.string(),
});

export const EdlAudio = z.object({
  voice_path: z.string().nullable(),
  music_path: z.string().nullable(),
  music_gain_db: z.number(),
  ducking: z
    .object({ attenuation_db: z.number(), attack_ms: z.number(), release_ms: z.number() })
    .nullable(),
  envelope_path: z.string().nullable(),
  fade_out_s: z.number(),
});

export const EndCard = z.object({
  duration_s: z.number(),
  text: z.string().nullable(),
  show_logo: z.boolean(),
  background: z.string().describe("hex colour"),
});

export const EdlSchema = z.object({
  mode: EditMode,
  output: z.object({ width: z.number(), height: z.number(), fps: z.number() }),
  target_duration_s: z.number(),
  total_duration_s: z.number(),
  timeline: z.array(TimelineItem),
  text_overlays: z.array(TextOverlay),
  transitions: z.array(Transition),
  audio: EdlAudio,
  end_card: EndCard.nullable(),
  logo: z.object({ path: z.string(), placement: z.enum(["corner", "end_card"]) }).nullable(),
  captions: z
    .object({
      words: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })),
      style: z.string(),
    })
    .nullable(),
  decision_reason: z.string(),
});
export type Edl = z.infer<typeof EdlSchema>;
