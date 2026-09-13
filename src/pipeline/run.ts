import * as path from "node:path";
import type { z } from "zod";
import { type BrandBrain, compileBrandBrain } from "../brand/brain.js";
import {
  hasBrandSnapshot,
  type LoadedBrand,
  loadBrandForRun,
  loadBrandSnapshot,
  writeBrandSnapshot,
} from "../brand/loader.js";
import type { BrandProfile } from "../brand/schema.js";
import {
  type ProviderOverrides,
  type ProviderSettings,
  resolveProviders,
  snapshotProviders,
} from "../config/settings.js";
import { resolveCreativeControls } from "../creative/controls.js";
import { Repos } from "../db/repos.js";
import { openDb } from "../db/sqlite.js";
import type { Providers } from "../providers/types.js";
import type { RunManifest, RunOptions } from "../schema/manifest.js";
import { ensureDir, exists, nowIso, readJson, sha256File, shortHash } from "../util/fs.js";
import { BudgetGuard } from "./budget.js";
import { Events } from "./events.js";
import { findRunDir, loadManifest, newRunId, runDirFor, saveManifest } from "./manifest.js";

export const OUTPUT_FILE = "output.json";

/**
 * Cooperative control surface a supervisor (the studio job runner) plugs into a run. The
 * pipeline calls `checkpoint()` between stages, between shots and before every paid call; it
 * throws RunInterruptedError to stop. Nothing in flight is aborted.
 */
export interface RunControl {
  checkpoint(at: string): void;
  progress?(info: { stage: string | null; shot?: string | null }): void;
}

export interface FxContext {
  id: number | null;
  rate: number;
  currency: string;
}

/** Everything a stage can reach: the manifest, brand, providers, budget, ledger, logs. */
export class RunContext {
  readonly repos: Repos;
  readonly events: Events;
  readonly budget: BudgetGuard;
  readonly brain: BrandBrain;
  /** Filled by the CLI/runner once providers are built from the resolved settings. */
  providers!: Providers;
  /** Set by a supervisor to pause/cancel cooperatively; null for plain CLI runs. */
  control: RunControl | null = null;
  /** Studio job that owns this process, for ledger attribution. */
  jobId: string | null = null;
  /** Brand-level budget hold admitted for this job (see src/budget/ledger.ts). */
  budgetHold: { reservationId: number } | null = null;
  /** Display-currency conversion recorded on every ledger row (null = USD only). */
  readonly fx: FxContext | null;

  constructor(
    readonly manifest: RunManifest,
    readonly runDir: string,
    readonly brand: LoadedBrand,
    readonly providerSettings: ProviderSettings,
    opts: { quiet?: boolean } = {},
  ) {
    this.repos = new Repos(openDb());
    this.events = new Events(runDir, opts.quiet);
    this.brain = compileBrandBrain(brand.profile);
    this.fx = resolveFx(this.repos);
    const spent = Math.max(manifest.cost.spent_usd, this.repos.spentForRun(manifest.run_id));
    manifest.cost.spent_usd = spent;
    this.budget = new BudgetGuard(manifest.cost.hard_cap_usd, spent, (s, r) => {
      this.manifest.cost.spent_usd = s;
      this.manifest.cost.reserved_usd = r;
    });
  }

  get runId(): string {
    return this.manifest.run_id;
  }

  get options(): RunOptions {
    return this.manifest.options;
  }

  save(): void {
    saveManifest(this.runDir, this.manifest);
    this.repos.upsertRun(this.manifest, this.runDir);
  }

  stageDir(stageDirName: string): string {
    return ensureDir(path.join(this.runDir, stageDirName));
  }

  /** Absolute path of a run-relative path. */
  abs(rel: string): string {
    return path.isAbsolute(rel) ? rel : path.join(this.runDir, rel);
  }

  /** Run-relative path of an absolute path inside the run dir. */
  rel(absPath: string): string {
    return path.relative(this.runDir, absPath).split(path.sep).join("/");
  }

  outputPath(stageDirName: string): string {
    return path.join(this.runDir, stageDirName, OUTPUT_FILE);
  }

  hasOutput(stageDirName: string): boolean {
    return exists(this.outputPath(stageDirName));
  }

  outputHash(stageDirName: string): string | null {
    const p = this.outputPath(stageDirName);
    return exists(p) ? sha256File(p) : null;
  }

  readOutput<T>(stageDirName: string, schema: z.ZodType<T>): T {
    return readJson(this.outputPath(stageDirName), schema);
  }
}

function resolveFx(repos: Repos): FxContext | null {
  const currency = repos.getSetting("display_currency") ?? "INR";
  if (currency === "USD") return null;
  const row = repos.currentFxRate("USD", currency);
  if (!row) return null;
  return { id: row.id, rate: row.rate, currency };
}

export interface CreateRunParams {
  brandId: string;
  topic: string;
  goal?: string | null;
  options: RunOptions;
  providerOverrides?: ProviderOverrides;
  runId?: string;
  quiet?: boolean;
  /** Product from the brand catalog (brands/<id>/products/<pid>); merged into the profile. */
  productId?: string | null;
  title?: string | null;
  createdBy?: "cli" | "studio" | "test";
  /**
   * Per-run adjustments to the brand profile (e.g. no narration for this video). Applied before
   * the snapshot is frozen; the version then covers the patch, so provenance stays exact.
   */
  profilePatch?: ((profile: BrandProfile) => BrandProfile) | null;
}

export function createRun(p: CreateRunParams): RunContext {
  let brand = loadBrandForRun(p.brandId, p.productId ?? null);
  if (p.profilePatch) {
    const patched = p.profilePatch(brand.profile);
    brand = { ...brand, profile: patched, version: shortHash({ base: brand.version, patched }) };
  }
  const settings = resolveProviders(brand.profile, p.providerOverrides);
  const runId = p.runId ?? newRunId();
  const runDir = ensureDir(runDirFor(brand.profile.id, runId));
  const hardCap = p.options.budget_override_usd ?? brand.profile.budget.hard_cap_usd;
  // Creative controls are resolved once (request → brand default → fallback) and stored, so a
  // later brand edit never changes what this run generates with.
  const creative = resolveCreativeControls(p.options, brand.profile);
  const options: RunOptions = {
    ...p.options,
    creative_freedom: creative.creative_freedom,
    goal_focus: creative.goal_focus,
    creative_sources: creative.sources,
  };
  const manifest: RunManifest = {
    run_id: runId,
    brand_id: brand.profile.id,
    brand_config_version: brand.version,
    topic: p.topic,
    goal: p.goal ?? null,
    product_id: p.productId ?? null,
    title: p.title ?? null,
    created_by: p.createdBy ?? "cli",
    created_at: nowIso(),
    updated_at: nowIso(),
    status: "running",
    options,
    providers: snapshotProviders(settings),
    stages: {},
    cost: {
      hard_cap_usd: hardCap,
      target_usd: brand.profile.budget.target_usd,
      ai_video_seconds_target:
        p.options.ai_video_seconds_override ?? brand.profile.budget.ai_video_seconds_target,
      estimated_usd: 0,
      spent_usd: 0,
      reserved_usd: 0,
    },
    last_error: null,
    stop_reason: null,
  };
  writeBrandSnapshot(runDir, brand);
  const ctx = new RunContext(manifest, runDir, brand, settings, { quiet: p.quiet });
  ctx.save();
  return ctx;
}

export function openRun(
  runId: string,
  patch: {
    options?: Partial<RunOptions>;
    providerOverrides?: ProviderOverrides;
    quiet?: boolean;
    /** Override the run's recorded brand_source for this open only. */
    brandSource?: "live" | "snapshot";
  } = {},
): RunContext {
  const runDir = findRunDir(runId);
  if (!runDir) throw new Error(`Run ${runId} not found under the runs directory`);
  const manifest = loadManifest(runDir);
  if (patch.options) Object.assign(manifest.options, patch.options);
  const source = patch.brandSource ?? manifest.options.brand_source ?? "live";
  let brand: LoadedBrand;
  if (source === "snapshot" && hasBrandSnapshot(runDir)) {
    brand = loadBrandSnapshot(runDir);
  } else {
    brand = loadBrandForRun(manifest.brand_id, manifest.product_id ?? null);
    if (brand.version !== manifest.brand_config_version) {
      // The brand (or product) file changed since the run was created: record the new version so
      // the runner's input hashes invalidate exactly the stages that depend on it, and refresh
      // the snapshot so a later snapshot-pinned resume sees the same profile.
      manifest.brand_config_version = brand.version;
      writeBrandSnapshot(runDir, brand);
    }
  }
  const settings = resolveProviders(brand.profile, patch.providerOverrides);
  manifest.providers = snapshotProviders(settings);
  if (patch.options?.budget_override_usd != null) {
    manifest.cost.hard_cap_usd = patch.options.budget_override_usd;
  }
  const ctx = new RunContext(manifest, runDir, brand, settings, { quiet: patch.quiet });
  return ctx;
}
