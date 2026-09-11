import { z } from "zod";

export const NarrationLine = z.object({
  id: z.string().describe("line_01, line_02, ..."),
  text: z.string().describe("Exactly what is spoken. No stage directions."),
  beat: z.string().describe("Which emotional beat this line belongs to"),
  emotion: z.string(),
  delivery_note: z.string().describe("Pace, warmth, pause hints for the voice actor"),
});
export type NarrationLine = z.infer<typeof NarrationLine>;

export const ScriptSchema = z.object({
  music_only: z.boolean().describe("True when the video has no narration"),
  narration: z.array(NarrationLine).describe("Empty when music_only is true"),
  on_screen_text_candidates: z.array(
    z.object({
      text: z.string(),
      role: z.enum(["hook", "emphasis", "cta"]),
      why: z.string(),
    }),
  ),
  est_duration_s: z.number(),
  total_words: z.number(),
  tone_notes: z.string(),
});
export type Script = z.infer<typeof ScriptSchema>;
