import { z } from "zod";

export const AudioPlanSchema = z.object({
  voice: z
    .object({
      path: z.string(),
      duration_s: z.number(),
      envelope_path: z.string().nullable().describe("JSON array of RMS per 100 ms window"),
    })
    .nullable(),
  music: z
    .object({
      track_id: z.string(),
      path: z.string(),
      gain_db: z.number(),
      ducking: z.object({
        attenuation_db: z.number(),
        attack_ms: z.number(),
        release_ms: z.number(),
      }),
      fade_in_s: z.number(),
      fade_out_s: z.number(),
    })
    .nullable(),
  reason: z.string(),
});
export type AudioPlan = z.infer<typeof AudioPlanSchema>;
