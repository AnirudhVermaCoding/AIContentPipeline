import * as path from "node:path";
import {
  CREATIVE_FREEDOM_RANGES,
  CREATIVE_PRESETS,
  DEFAULT_CREATIVE_CONTROLS,
  GOAL_FOCUS_RANGES,
  presetFor,
  type ResolvedCreativeControls,
  VARIATION_OPTIONS,
} from "../../creative/controls.js";
import type { RunContext } from "../../pipeline/run.js";
import {
  type CreativeControlsInput,
  CreativeControlsInputSchema,
  VariationStrength,
} from "../../schema/creative.js";
import { ValidationError } from "../../util/errors.js";
import { exists, readJson } from "../../util/fs.js";
import type {
  CreateVideoRequest,
  CreativeSettingsView,
  CreativeView,
  RunRequestView,
} from "../api-types.js";

/** The Create Video request as received, kept next to the manifest so a duplicate can prefill. */
export const STUDIO_REQUEST_FILE = "studio.request.json";

export function creativeView(r: ResolvedCreativeControls): CreativeView {
  return {
    creative_freedom: r.creative_freedom,
    goal_focus: r.goal_focus,
    creative_label: r.creative_label,
    goal_label: r.goal_label,
    sources: r.sources,
    preset: presetFor(r)?.id ?? null,
  };
}

/** Labels, presets and ranges the UI renders (nothing about them is hardcoded in the frontend). */
export function creativeSettingsView(): CreativeSettingsView {
  return {
    defaults: { ...DEFAULT_CREATIVE_CONTROLS },
    presets: [...CREATIVE_PRESETS],
    creative_ranges: [...CREATIVE_FREEDOM_RANGES],
    goal_ranges: [...GOAL_FOCUS_RANGES],
    variation_options: [...VARIATION_OPTIONS],
  };
}

/** API boundary: reject anything outside 0–1 (never clamp), unknown keys, or non-numbers. */
export function parseCreativeInput(raw: unknown): CreativeControlsInput | undefined {
  if (raw == null) return undefined;
  const parsed = CreativeControlsInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(
      "invalid creative controls: creative_freedom and goal_focus must be numbers between 0 and 1",
      parsed.error.issues.map((i) => `${i.path.join(".") || "creative"}: ${i.message}`),
    );
  }
  return parsed.data;
}

export function parseVariation(
  raw: unknown,
  fallback: VariationStrength = "fresh",
): VariationStrength {
  if (raw == null || raw === "") return fallback;
  const parsed = VariationStrength.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError("invalid variation strength", [
      `variation must be one of ${VariationStrength.options.join(", ")} (got ${JSON.stringify(raw)})`,
    ]);
  return parsed.data;
}

/**
 * What "Duplicate as new video" prefills: the stored request when the studio created the run,
 * otherwise a best-effort reconstruction from the manifest (CLI runs). Creative controls always
 * come from the manifest, which holds the values the run actually generated with.
 */
export function runRequestView(run: RunContext): RunRequestView {
  const m = run.manifest;
  const creative = {
    creative_freedom: m.options.creative_freedom ?? null,
    goal_focus: m.options.goal_focus ?? null,
  };
  const file = path.join(run.runDir, STUDIO_REQUEST_FILE);
  if (exists(file)) {
    const stored = readJson<CreateVideoRequest>(file);
    return {
      source: "stored",
      source_run_id: m.run_id,
      request: {
        ...stored,
        creative: {
          creative_freedom: creative.creative_freedom ?? stored.creative?.creative_freedom,
          goal_focus: creative.goal_focus ?? stored.creative?.goal_focus,
        },
      },
    };
  }
  const goal = (m.goal ?? "").replace(/^Goal:\s*/i, "");
  return {
    source: "reconstructed",
    source_run_id: m.run_id,
    request: {
      brand_id: m.brand_id,
      product_id: m.product_id ?? null,
      title: m.title ?? null,
      topic: m.topic,
      goal,
      audience: null,
      duration_s: null,
      platform: null,
      creative_direction: null,
      cta: null,
      notes: null,
      advanced: {
        budget_override_usd: m.options.budget_override_usd,
        ai_video_seconds: m.options.ai_video_seconds_override,
        voice: "brand_default",
        music: "brand_default",
        approval_mode: m.options.approve_keyframes ? "storyboard_and_keyframes" : "storyboard_only",
        provider_mode: m.options.provider_mode,
        provider_overrides: {},
      },
      creative: {
        creative_freedom: creative.creative_freedom ?? undefined,
        goal_focus: creative.goal_focus ?? undefined,
      },
    },
  };
}
