import { loadBrandForRun } from "../../brand/loader.js";
import type { BrandProfile } from "../../brand/schema.js";
import { type ProviderOverrides, resolveProviders } from "../../config/settings.js";
import { createRun } from "../../pipeline/run.js";
import type { RunOptions } from "../../schema/manifest.js";
import type { CreateVideoRequest, CreateVideoResponse } from "../api-types.js";
import { budgetCheckView, preflightView, prePlanEstimate } from "./estimates.js";
import { jobView, type StudioContext, summaryFromManifest } from "./runs.js";

/**
 * Turn the Create Video form into a run: compose the brief the Creative Director reads, pin the
 * brand + product snapshot, estimate before anything is spent, check the budget rules, and only
 * then start the planning job (which stops at the storyboard gate when approval is on).
 */

export function composeGoal(req: CreateVideoRequest): string {
  const lines: string[] = [];
  if (req.goal) lines.push(`Goal: ${req.goal.trim()}`);
  if (req.audience) lines.push(`Target audience: ${req.audience.trim()}`);
  if (req.platform) lines.push(`Platform: ${req.platform.trim()} (vertical 9:16)`);
  if (req.duration_s) lines.push(`Desired duration: about ${Math.round(req.duration_s)} seconds`);
  if (req.creative_direction) lines.push(`Creative direction: ${req.creative_direction.trim()}`);
  if (req.cta) lines.push(`Call to action: ${req.cta.trim()}`);
  if (req.notes) lines.push(`Notes: ${req.notes.trim()}`);
  return lines.join("\n");
}

function providerOverrides(req: CreateVideoRequest): ProviderOverrides {
  const out: ProviderOverrides = {};
  for (const [k, v] of Object.entries(req.advanced.provider_overrides ?? {})) {
    if (!v || (!v.provider && !v.model)) continue;
    out[k as keyof ProviderOverrides] = {
      ...(v.provider ? { provider: v.provider } : {}),
      ...(v.model ? { model: v.model } : {}),
    };
  }
  return out;
}

export function profilePatchFor(
  req: CreateVideoRequest,
): ((p: BrandProfile) => BrandProfile) | null {
  const voice = req.advanced.voice;
  const music = req.advanced.music;
  const dur = req.duration_s;
  if (voice === "brand_default" && music === "brand_default" && !dur) return null;
  return (p) => ({
    ...p,
    voice: {
      ...p.voice,
      narration_policy:
        voice === "voice" ? "always" : voice === "no_voice" ? "never" : p.voice.narration_policy,
    },
    music: { ...p.music, policy: music === "brand_default" ? p.music.policy : music },
    pacing: dur
      ? {
          ...p.pacing,
          duration_s: { min: Math.max(8, Math.round(dur * 0.85)), max: Math.round(dur * 1.15) },
        }
      : p.pacing,
  });
}

export async function createVideo(
  ctx: StudioContext,
  req: CreateVideoRequest,
  actor = "local-user",
): Promise<CreateVideoResponse> {
  if (!req.brand_id) throw new Error("brand_id is required");
  if (!req.topic?.trim()) throw new Error("topic is required");
  const brand = loadBrandForRun(req.brand_id, req.product_id ?? null);
  const warnings = [...(brand.product?.warnings ?? [])];
  if (brand.product?.profile.reference_policy.hard) {
    const have = brand.product.references.filter((r) => r.exists).length;
    if (have < brand.product.profile.reference_policy.min) {
      throw new Error(
        `${brand.product.profile.name} requires at least ${brand.product.profile.reference_policy.min} reference image(s) before it can be generated (${have} available).`,
      );
    }
  }
  if (
    !brand.profile.voice.voice_id?.length ||
    brand.profile.voice.voice_id.startsWith("REPLACE_WITH")
  ) {
    if (
      req.advanced.provider_mode === "live" &&
      req.advanced.voice !== "no_voice" &&
      brand.profile.voice.narration_policy !== "never"
    )
      warnings.push(
        "No narration voice id is configured for this brand (brand.yaml → voice.voice_id); narration will fail in live mode.",
      );
  }
  const approval = req.advanced.approval_mode;
  const options: RunOptions = {
    provider_mode: req.advanced.provider_mode,
    approve_keyframes: approval === "storyboard_and_keyframes" || approval === "keyframes_only",
    budget_override_usd: req.advanced.budget_override_usd ?? null,
    ai_video_seconds_override: req.advanced.ai_video_seconds ?? null,
    until: null,
    dry_run: approval === "storyboard_and_keyframes" || approval === "storyboard_only",
    brand_source: "snapshot",
    continuity_merge: "preserve_unchanged",
  };
  const title =
    req.title?.trim() ||
    (brand.product ? `${brand.product.profile.name} — ${req.topic.trim()}` : req.topic.trim());
  const run = createRun({
    brandId: req.brand_id,
    productId: req.product_id ?? null,
    topic: req.topic.trim(),
    goal: composeGoal(req) || null,
    title,
    createdBy: "studio",
    options,
    providerOverrides: providerOverrides(req),
    profilePatch: profilePatchFor(req),
    quiet: true,
  });
  run.repos.audit({
    actor,
    action: "run.create",
    target_type: "run",
    target_id: run.runId,
    run_id: run.runId,
    details: {
      title,
      product_id: req.product_id ?? null,
      approval_mode: approval,
      provider_mode: req.advanced.provider_mode,
    },
  });
  const settings = resolveProviders(run.brand.profile, providerOverrides(req));
  const estimate = prePlanEstimate(run.brand.profile, settings, {
    durationS: req.duration_s ?? null,
    aiVideoSeconds: options.ai_video_seconds_override,
    narration: req.advanced.voice,
    referenceCount: brand.product?.references.filter((r) => r.exists).length ?? 0,
    hardCapUsd: run.manifest.cost.hard_cap_usd,
  });
  const hold = run.manifest.cost.hard_cap_usd;
  const budget = budgetCheckView(ctx.ledger, req.brand_id, hold, {
    runId: run.runId,
    runCapUsd: hold,
    estimateUsd: estimate.min_usd,
    expectedUsd: estimate.max_usd,
  });
  if (
    run.options.provider_mode === "live" ||
    ctx.ledger.settingsOrDefault(req.brand_id).count_mock_runs
  ) {
    if (!budget.ok) {
      run.manifest.status = "stopped";
      run.manifest.last_error = budget.reason;
      run.save();
      return {
        run: summaryFromManifest(ctx, run.manifest, run.runDir, {
          brand_name: brand.profile.name,
          product_name: brand.product?.profile.name ?? null,
        }),
        job: null,
        preflight: { ...preflightView(run, ctx.ledger), estimate, budget },
        warnings,
        blocked: { rule: budget.blocking_rule ?? "budget", reason: budget.reason ?? "budget rule" },
      };
    }
  }
  const job = await ctx.jobs.enqueue("start", run.runId, req.brand_id, { reason: "create video" });
  return {
    run: summaryFromManifest(ctx, run.manifest, run.runDir, {
      brand_name: brand.profile.name,
      product_name: brand.product?.profile.name ?? null,
    }),
    job: jobView(ctx.jobs, job),
    preflight: { ...preflightView(run, ctx.ledger), estimate, budget },
    warnings,
    blocked: null,
  };
}
