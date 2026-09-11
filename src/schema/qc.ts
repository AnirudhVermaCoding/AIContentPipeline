import { z } from "zod";

export const QcCheck = z.object({
  id: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  detail: z.string(),
});
export type QcCheck = z.infer<typeof QcCheck>;

export const StoryboardRiskReport = z.object({
  score: z.number().describe("0 = clean, higher = more generic/slideshow-like"),
  verdict: z.enum(["strong", "acceptable", "revise", "fail"]),
  checks: z.array(QcCheck),
});
export type StoryboardRiskReport = z.infer<typeof StoryboardRiskReport>;

export const FinalQcReportSchema = z.object({
  status: z.enum(["pass", "pass_with_warnings", "fail"]),
  checks: z.array(QcCheck),
  probe: z
    .object({
      width: z.number(),
      height: z.number(),
      fps: z.number().nullable(),
      duration_s: z.number(),
      has_audio: z.boolean(),
      integrated_lufs: z.number().nullable(),
    })
    .nullable(),
});
export type FinalQcReport = z.infer<typeof FinalQcReportSchema>;
