import * as path from "node:path";
import type { z } from "zod";
import { type BrandBrain, compileBrandBrain } from "../brand/brain.js";
import { type LoadedBrand, loadBrand } from "../brand/loader.js";
import {
  type ProviderOverrides,
  type ProviderSettings,
  resolveProviders,
  snapshotProviders,
} from "../config/settings.js";
import { Repos } from "../db/repos.js";
import { openDb } from "../db/sqlite.js";
import type { Providers } from "../providers/types.js";
import type { RunManifest, RunOptions } from "../schema/manifest.js";
import { ensureDir, exists, nowIso, readJson, sha256File } from "../util/fs.js";
import { BudgetGuard } from "./budget.js";
import { Events } from "./events.js";
import { findRunDir, loadManifest, newRunId, runDirFor, saveManifest } from "./manifest.js";

export const OUTPUT_FILE = "output.json";

/** Everything a stage can reach: the manifest, brand, providers, budget, ledger, logs. */
export class RunContext {
  readonly repos: Repos;
  readonly events: Events;
  readonly budget: BudgetGuard;
  readonly brain: BrandBrain;
  /** Filled by the CLI/runner once providers are built from the resolved settings. */
  providers!: Providers;

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

export interface CreateRunParams {
  brandId: string;
  topic: string;
  goal?: string | null;
  options: RunOptions;
  providerOverrides?: ProviderOverrides;
  runId?: string;
  quiet?: boolean;
}

export function createRun(p: CreateRunParams): RunContext {
  const brand = loadBrand(p.brandId);
  const settings = resolveProviders(brand.profile, p.providerOverrides);
  const runId = p.runId ?? newRunId();
  const runDir = ensureDir(runDirFor(brand.profile.id, runId));
  const hardCap = p.options.budget_override_usd ?? brand.profile.budget.hard_cap_usd;
  const manifest: RunManifest = {
    run_id: runId,
    brand_id: brand.profile.id,
    brand_config_version: brand.version,
    topic: p.topic,
    goal: p.goal ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
    status: "running",
    options: p.options,
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
  };
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
  } = {},
): RunContext {
  const runDir = findRunDir(runId);
  if (!runDir) throw new Error(`Run ${runId} not found under the runs directory`);
  const manifest = loadManifest(runDir);
  if (patch.options) Object.assign(manifest.options, patch.options);
  const brand = loadBrand(manifest.brand_id);
  if (brand.version !== manifest.brand_config_version) {
    // The brand file changed since the run was created: record the new version so the runner's
    // input hashes invalidate exactly the stages that depend on it.
    manifest.brand_config_version = brand.version;
  }
  const settings = resolveProviders(brand.profile, patch.providerOverrides);
  manifest.providers = snapshotProviders(settings);
  if (patch.options?.budget_override_usd != null) {
    manifest.cost.hard_cap_usd = patch.options.budget_override_usd;
  }
  const ctx = new RunContext(manifest, runDir, brand, settings, { quiet: patch.quiet });
  return ctx;
}
