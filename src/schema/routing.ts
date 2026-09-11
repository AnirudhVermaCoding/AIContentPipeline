import { z } from "zod";
import { AssetSource } from "./common.js";

export const ShotRoute = z.object({
  shot_id: z.string(),
  source: AssetSource,
  fallback: AssetSource.nullable(),
  video_seconds: z.number().nullable().describe("Clip length to generate for GEN_VIDEO"),
  est_cost_usd: z.number(),
  reason: z.string(),
});
export type ShotRoute = z.infer<typeof ShotRoute>;

export const RoutingPlanSchema = z.object({
  shots: z.array(ShotRoute),
  totals: z.object({
    ai_video_seconds: z.number(),
    est_image_usd: z.number(),
    est_video_usd: z.number(),
    est_llm_usd: z.number(),
    est_tts_usd: z.number(),
    est_total_usd: z.number().describe("Estimated cost of the whole run including what is spent"),
  }),
  promise_check: z.object({
    satisfied: z.boolean(),
    notes: z.string(),
  }),
  budget_check: z.object({
    hard_cap_usd: z.number(),
    spent_usd: z.number(),
    status: z.enum(["ok", "conflict"]),
    alternatives: z.array(
      z.object({
        description: z.string(),
        est_total_usd: z.number(),
        cost_of: z.string().describe("What the alternative gives up"),
      }),
    ),
  }),
});
export type RoutingPlan = z.infer<typeof RoutingPlanSchema>;
