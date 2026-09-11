import { z } from "zod";

export const WordTimestamp = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});
export type WordTimestamp = z.infer<typeof WordTimestamp>;

export const VoiceLine = z.object({
  line_id: z.string(),
  text: z.string(),
  path: z.string().describe("Per-line audio file, relative to the run dir"),
  start_s: z.number().describe("Start on the concatenated voice track"),
  end_s: z.number(),
  duration_s: z.number(),
});
export type VoiceLine = z.infer<typeof VoiceLine>;

export const VoiceResultSchema = z.object({
  music_only: z.boolean(),
  provider: z.string(),
  model: z.string(),
  voice_id: z.string(),
  audio_path: z.string().nullable().describe("Concatenated narration, relative to the run dir"),
  duration_s: z.number(),
  line_gap_s: z.number(),
  lines: z.array(VoiceLine),
  words: z.array(WordTimestamp).nullable(),
  characters: z.number(),
  cost_usd: z.number(),
});
export type VoiceResult = z.infer<typeof VoiceResultSchema>;
