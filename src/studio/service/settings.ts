import { PRICING, PRICING_AS_OF, pricingIsStale } from "../../config/pricing.js";
import { DEFAULT_PROVIDERS, snapshotProviders } from "../../config/settings.js";
import type { Db } from "../../db/sqlite.js";
import { nowIso } from "../../util/fs.js";
import type { StudioSettings } from "../api-types.js";
import { creativeSettingsView } from "./creative.js";

export const DEFAULT_USD_INR = 84;

/** Make sure a USD→INR rate exists so INR display never silently falls back to USD. */
export function ensureDefaultFx(db: Db): void {
  const row = db
    .prepare(`SELECT id FROM fx_rates WHERE base = 'USD' AND quote = 'INR' LIMIT 1`)
    .get();
  if (row) return;
  db.prepare(
    `INSERT INTO fx_rates (base, quote, rate, effective_at, source, note, created_at) VALUES ('USD', 'INR', ?, ?, 'manual', ?, ?)`,
  ).run(
    DEFAULT_USD_INR,
    nowIso(),
    "Seed rate; update it in Settings to your accounting rate.",
    nowIso(),
  );
}

export function getStudioSettings(db: Db): StudioSettings {
  ensureDefaultFx(db);
  const cur = (
    db.prepare(`SELECT value FROM studio_settings WHERE key = 'display_currency'`).get() as
      | { value: string }
      | undefined
  )?.value;
  const display = cur === "USD" ? "USD" : "INR";
  const latest = db
    .prepare(
      `SELECT * FROM fx_rates WHERE base = 'USD' AND quote = 'INR' ORDER BY effective_at DESC, id DESC LIMIT 1`,
    )
    .get() as
    | { id: number; rate: number; effective_at: string; source: string; note: string | null }
    | undefined;
  const history = db
    .prepare(
      `SELECT id, rate, effective_at, source, note, created_at FROM fx_rates WHERE base = 'USD' AND quote = 'INR' ORDER BY effective_at DESC, id DESC LIMIT 20`,
    )
    .all() as StudioSettings["fx_history"];
  return {
    display_currency: display,
    secondary_currency: display === "USD" ? "INR" : "USD",
    fx: {
      id: latest?.id ?? null,
      rate: latest?.rate ?? DEFAULT_USD_INR,
      base: "USD",
      quote: "INR",
      effective_at: latest?.effective_at ?? null,
      source: latest?.source ?? null,
      note: latest?.note ?? null,
    },
    fx_history: history,
    pricing: {
      as_of: PRICING_AS_OF,
      stale: pricingIsStale(),
      table: PRICING as unknown as Record<string, unknown>,
    },
    provider_defaults: snapshotProviders(DEFAULT_PROVIDERS),
    creative: creativeSettingsView(),
  };
}

export function updateStudioSettings(
  db: Db,
  patch: { display_currency?: "INR" | "USD"; fx_rate?: { rate: number; note?: string | null } },
  actor = "local-user",
): StudioSettings {
  if (patch.display_currency) {
    db.prepare(
      `INSERT INTO studio_settings (key, value, updated_at) VALUES ('display_currency', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(patch.display_currency, nowIso());
  }
  if (patch.fx_rate) {
    if (!(patch.fx_rate.rate > 0)) throw new Error("FX rate must be a positive number");
    db.prepare(
      `INSERT INTO fx_rates (base, quote, rate, effective_at, source, note, created_at) VALUES ('USD', 'INR', ?, ?, 'manual', ?, ?)`,
    ).run(patch.fx_rate.rate, nowIso(), patch.fx_rate.note ?? null, nowIso());
  }
  db.prepare(
    `INSERT INTO audit_log (ts, actor, action, target_type, target_id, details) VALUES (?, ?, 'settings.update', 'studio', 'settings', ?)`,
  ).run(nowIso(), actor, JSON.stringify(patch));
  return getStudioSettings(db);
}
