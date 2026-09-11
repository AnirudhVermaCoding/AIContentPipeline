import { z } from "zod";
import { AssetSource } from "./common.js";
import { QcCheck } from "./qc.js";

export const AssetMeta = z.object({
  duration_s: z.number(),
  width: z.number(),
  height: z.number(),
  fps: z.number().nullable(),
  has_audio: z.boolean(),
});
export type AssetMeta = z.infer<typeof AssetMeta>;

export const ShotAttempt = z.object({
  kind: z.enum(["keyframe", "video", "stock"]),
  attempt: z.number(),
  provider: z.string(),
  model: z.string(),
  prompt: z.string(),
  prompt_version: z.string(),
  refs: z.array(z.string()),
  params: z.record(z.string(), z.unknown()),
  latency_ms: z.number(),
  cost_usd: z.number(),
  status: z.enum(["ok", "failed", "rejected"]),
  error: z.string().nullable(),
  path: z.string().nullable(),
  checks: z.array(QcCheck),
});
export type ShotAttempt = z.infer<typeof ShotAttempt>;

export const ShotStatus = z.enum([
  "pending",
  "keyframe_ready",
  "awaiting_approval",
  "approved",
  "rejected",
  "animated",
  "done",
  "failed",
  "downgraded",
]);
export type ShotStatus = z.infer<typeof ShotStatus>;

export const ShotRecordSchema = z.object({
  shot_id: z.string(),
  status: ShotStatus,
  shot_hash: z.string(),
  source: AssetSource,
  approval: z.object({
    status: z.enum(["none", "pending", "approved", "rejected"]),
    note: z.string().nullable(),
  }),
  attempts: z.array(ShotAttempt),
  keyframe: z
    .object({
      path: z.string(),
      width: z.number(),
      height: z.number(),
      seed: z.number().nullable(),
      prompt: z.string(),
      prompt_version: z.string(),
    })
    .nullable(),
  video: z
    .object({
      path: z.string(),
      prompt: z.string(),
      meta: AssetMeta,
    })
    .nullable(),
  final: z
    .object({
      path: z.string(),
      kind: z.enum(["video", "image"]),
      meta: AssetMeta,
    })
    .nullable(),
  cost_usd: z.number(),
  updated_at: z.string(),
});
export type ShotRecord = z.infer<typeof ShotRecordSchema>;
