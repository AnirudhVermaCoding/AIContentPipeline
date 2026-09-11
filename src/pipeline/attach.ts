import * as path from "node:path";
import { repoRoot } from "../config/env.js";
import { pricingIsStale } from "../config/pricing.js";
import { buildProviders, checkProviders } from "../providers/registry.js";
import type { RunContext } from "./run.js";

export interface AttachOptions {
  /** Where non-fatal warnings go (defaults to console.warn). */
  warn?: (message: string) => void;
}

/**
 * Build the run's providers from its resolved settings. Live mode refuses to start when a key
 * is missing so a run never fails halfway through on an auth error. Shared by the CLI and the
 * studio job runner.
 */
export function attachProviders(
  run: RunContext,
  mode: "live" | "mock",
  opts: AttachOptions = {},
): void {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  if (mode === "live") {
    const check = checkProviders(run.providerSettings);
    if (!check.ok) {
      const lines = check.missing.map(
        (m) => `  - ${m.envKey} (for ${m.capability}: ${m.provider})`,
      );
      throw new Error(
        `Missing API keys for the configured providers:\n${lines.join("\n")}\nAdd them to .env or run with --mock.`,
      );
    }
    for (const u of check.unpriced) {
      warn(
        `warning: no price for ${u.capability} ${u.provider}:${u.model}; costs will report as $0`,
      );
    }
  }
  if (pricingIsStale())
    warn("warning: the price table is over 60 days old; refresh src/config/pricing.ts");
  const fixtures = path.join(repoRoot(), "test/fixtures/llm");
  run.providers = buildProviders(run.providerSettings, {
    mode,
    fixtureDirs: [path.join(fixtures, run.manifest.brand_id), fixtures],
    mockImageColor: run.brand.profile.visual.colors.primary,
  });
}
