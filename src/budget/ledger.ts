import type { Db } from "../db/sqlite.js";
import { type BudgetRule, BudgetWindowError } from "../util/errors.js";
import { nowIso } from "../util/fs.js";

/**
 * Brand-level budget ledger: an internal accounting wallet plus a daily and a rolling 48-hour
 * hard limit. It decides whether the orchestration may spend; no money is stored or moved.
 *
 * Amounts the operator configures are in the brand's accounting currency (INR by default) and
 * are compared against USD spend through the current FX rate. Spend itself is always recorded in
 * USD by `Repos.completeGeneration` (one `spend` row per paid call), so the rules read one table.
 *
 * A job holds its maximum possible exposure (hard cap minus what the run already spent) for as
 * long as it is alive; admission is one BEGIN IMMEDIATE transaction so two processes can never
 * both believe the same money is available.
 */

export interface BudgetSettings {
  brand_id: string;
  currency: string;
  wallet_amount: number | null;
  daily_amount: number | null;
  two_day_amount: number | null;
  wallet_since: string | null;
  count_mock_runs: boolean;
  timezone: string;
  updated_at: string;
}

export interface BudgetWindow {
  rule: BudgetRule;
  label: string;
  /** Configured limit (null = unlimited). */
  limit_usd: number | null;
  limit_display: number | null;
  spent_usd: number;
  held_usd: number;
  /** limit − spent − held, or null when unlimited. */
  available_usd: number | null;
  window_start: string | null;
}

export interface ReservationRow {
  id: number;
  brand_id: string;
  run_id: string;
  job_id: string | null;
  hold_usd: number;
  initial_hold_usd: number;
  provider_mode: string;
  status: "active" | "released";
  reason: string | null;
  created_at: string;
  released_at: string | null;
  release_reason: string | null;
  actual_usd: number | null;
}

export interface LedgerRow {
  id: number;
  brand_id: string;
  run_id: string | null;
  generation_id: number | null;
  reservation_id: number | null;
  kind: string;
  amount_usd: number;
  amount_display: number | null;
  currency: string | null;
  fx_rate: number | null;
  fx_rate_id: number | null;
  provider_mode: string;
  actor: string;
  note: string | null;
  created_at: string;
}

export interface BudgetNotice {
  level: "info" | "warning" | "critical";
  code: string;
  message: string;
}

export interface FxSnapshot {
  id: number | null;
  rate: number;
  currency: string;
}

export interface BudgetStatus {
  brand_id: string;
  configured: boolean;
  settings: BudgetSettings;
  fx: FxSnapshot;
  wallet: BudgetWindow;
  daily: BudgetWindow;
  two_day: BudgetWindow;
  active_holds: ReservationRow[];
  spent_today_by_provider: Array<{ provider: string; model: string; usd: number; share: number }>;
  failed_week_usd: number;
  failed_week_count: number;
  notices: BudgetNotice[];
  now: string;
}

export interface AdmitParams {
  brandId: string;
  runId: string;
  jobId: string | null;
  holdUsd: number;
  providerMode: "live" | "mock";
  label: string;
  now?: Date;
}

export interface AffordabilityCheck {
  ok: boolean;
  blocking_rule: BudgetRule | null;
  reason: string | null;
  windows: BudgetWindow[];
  hold_usd: number;
}

const EPS = 1e-9;

export const DEFAULT_TIMEZONE = "UTC";

/** ISO timestamp of local midnight in `tz` for the day containing `now`. */
export function startOfDayIso(now: Date, tz: string): string {
  let parts: Record<string, string>;
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  } catch {
    return startOfDayIso(now, "UTC");
  }
  const h = Number(parts.hour ?? 0) % 24;
  const m = Number(parts.minute ?? 0);
  const s = Number(parts.second ?? 0);
  const sinceMidnight = (h * 3600 + m * 60 + s) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnight).toISOString();
}

function toSettings(row: Record<string, unknown>): BudgetSettings {
  return {
    brand_id: String(row.brand_id),
    currency: String(row.currency ?? "INR"),
    wallet_amount: row.wallet_amount == null ? null : Number(row.wallet_amount),
    daily_amount: row.daily_amount == null ? null : Number(row.daily_amount),
    two_day_amount: row.two_day_amount == null ? null : Number(row.two_day_amount),
    wallet_since: (row.wallet_since as string | null) ?? null,
    count_mock_runs: Number(row.count_mock_runs ?? 1) === 1,
    timezone: String(row.timezone ?? DEFAULT_TIMEZONE),
    updated_at: String(row.updated_at ?? ""),
  };
}

export class BudgetLedger {
  constructor(readonly db: Db) {}

  // ---- settings & FX ------------------------------------------------------------------------

  getSettings(brandId: string): BudgetSettings | null {
    const row = this.db.prepare(`SELECT * FROM budget_settings WHERE brand_id = ?`).get(brandId) as
      | Record<string, unknown>
      | undefined;
    return row ? toSettings(row) : null;
  }

  /** Settings with unlimited defaults when a brand has none configured yet. */
  settingsOrDefault(brandId: string): BudgetSettings {
    return (
      this.getSettings(brandId) ?? {
        brand_id: brandId,
        currency: "INR",
        wallet_amount: null,
        daily_amount: null,
        two_day_amount: null,
        wallet_since: null,
        count_mock_runs: true,
        timezone: DEFAULT_TIMEZONE,
        updated_at: "",
      }
    );
  }

  saveSettings(
    brandId: string,
    patch: Partial<Omit<BudgetSettings, "brand_id" | "updated_at">>,
    actor = "local-user",
  ): BudgetSettings {
    const current = this.settingsOrDefault(brandId);
    const next: BudgetSettings = {
      ...current,
      ...patch,
      brand_id: brandId,
      updated_at: nowIso(),
      wallet_since:
        patch.wallet_since !== undefined
          ? patch.wallet_since
          : (current.wallet_since ?? (patch.wallet_amount != null ? nowIso() : null)),
    };
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO budget_settings (brand_id, currency, wallet_amount, daily_amount, two_day_amount, wallet_since,
             count_mock_runs, timezone, updated_at)
           VALUES (@brand_id, @currency, @wallet_amount, @daily_amount, @two_day_amount, @wallet_since,
             @count_mock_runs, @timezone, @updated_at)
           ON CONFLICT(brand_id) DO UPDATE SET currency=excluded.currency, wallet_amount=excluded.wallet_amount,
             daily_amount=excluded.daily_amount, two_day_amount=excluded.two_day_amount,
             wallet_since=excluded.wallet_since, count_mock_runs=excluded.count_mock_runs,
             timezone=excluded.timezone, updated_at=excluded.updated_at`,
        )
        .run({ ...next, count_mock_runs: next.count_mock_runs ? 1 : 0 });
      this.db
        .prepare(
          `INSERT INTO budget_ledger (brand_id, kind, amount_usd, currency, actor, note, created_at)
           VALUES (?, 'settings_change', 0, ?, ?, ?, ?)`,
        )
        .run(brandId, next.currency, actor, JSON.stringify(patch), next.updated_at);
    });
    tx.immediate();
    return next;
  }

  fxFor(currency: string): FxSnapshot {
    if (currency === "USD") return { id: null, rate: 1, currency };
    const row = this.db
      .prepare(
        `SELECT id, rate FROM fx_rates WHERE base = 'USD' AND quote = ? ORDER BY effective_at DESC, id DESC LIMIT 1`,
      )
      .get(currency) as { id: number; rate: number } | undefined;
    if (!row) return { id: null, rate: 1, currency: "USD" };
    return { id: row.id, rate: row.rate, currency };
  }

  // ---- sums -----------------------------------------------------------------------------------

  private modeClause(includeMock: boolean): string {
    return includeMock ? "" : " AND provider_mode = 'live'";
  }

  spentUsd(brandId: string, since: string | null, includeMock: boolean): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount_usd), 0) AS s FROM budget_ledger
         WHERE brand_id = ? AND kind = 'spend' AND (? IS NULL OR created_at >= ?)${this.modeClause(includeMock)}`,
      )
      .get(brandId, since, since) as { s: number };
    return row.s;
  }

  heldUsd(brandId: string, excludeRunId: string | null, includeMock: boolean): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(hold_usd), 0) AS h FROM budget_reservations
         WHERE brand_id = ? AND status = 'active' AND (? IS NULL OR run_id <> ?)${this.modeClause(includeMock)}`,
      )
      .get(brandId, excludeRunId, excludeRunId) as { h: number };
    return row.h;
  }

  activeReservations(brandId: string): ReservationRow[] {
    return this.db
      .prepare(
        `SELECT * FROM budget_reservations WHERE brand_id = ? AND status = 'active' ORDER BY created_at`,
      )
      .all(brandId) as ReservationRow[];
  }

  activeReservationForRun(runId: string): ReservationRow | null {
    const row = this.db
      .prepare(`SELECT * FROM budget_reservations WHERE run_id = ? AND status = 'active'`)
      .get(runId) as ReservationRow | undefined;
    return row ?? null;
  }

  reservationsForRun(runId: string): ReservationRow[] {
    return this.db
      .prepare(`SELECT * FROM budget_reservations WHERE run_id = ? ORDER BY id`)
      .all(runId) as ReservationRow[];
  }

  windows(
    s: BudgetSettings,
    now: Date,
    excludeRunId: string | null,
  ): { wallet: BudgetWindow; daily: BudgetWindow; two_day: BudgetWindow } {
    const fx = this.fxFor(s.currency);
    const includeMock = s.count_mock_runs;
    const held = this.heldUsd(s.brand_id, excludeRunId, includeMock);
    const mk = (
      rule: BudgetRule,
      label: string,
      amount: number | null,
      since: string | null,
    ): BudgetWindow => {
      const spent = this.spentUsd(s.brand_id, since, includeMock);
      const limit = amount == null ? null : amount / fx.rate;
      return {
        rule,
        label,
        limit_usd: limit,
        limit_display: amount,
        spent_usd: spent,
        held_usd: held,
        available_usd: limit == null ? null : limit - spent - held,
        window_start: since,
      };
    };
    return {
      wallet: mk("wallet", "Production wallet", s.wallet_amount, s.wallet_since),
      daily: mk("daily", "Today's budget", s.daily_amount, startOfDayIso(now, s.timezone)),
      two_day: mk(
        "two_day",
        "48-hour budget",
        s.two_day_amount,
        new Date(now.getTime() - 48 * 3600 * 1000).toISOString(),
      ),
    };
  }

  // ---- admission --------------------------------------------------------------------------------

  /**
   * Pure check (no hold taken): can `holdUsd` more be committed for this brand right now? Used by
   * the preflight screen and before regenerations so the UI can name the blocking rule.
   */
  check(
    brandId: string,
    holdUsd: number,
    opts: {
      excludeRunId?: string | null;
      runCapUsd?: number | null;
      estimateUsd?: number | null;
      now?: Date;
    } = {},
  ): AffordabilityCheck {
    const s = this.settingsOrDefault(brandId);
    const w = this.windows(s, opts.now ?? new Date(), opts.excludeRunId ?? null);
    const windows = [w.wallet, w.daily, w.two_day];
    if (
      opts.runCapUsd != null &&
      opts.estimateUsd != null &&
      opts.estimateUsd > opts.runCapUsd + EPS
    ) {
      return {
        ok: false,
        blocking_rule: "run_cap",
        reason: `The estimate ($${opts.estimateUsd.toFixed(2)}) exceeds the per-video hard cap ($${opts.runCapUsd.toFixed(2)}).`,
        windows,
        hold_usd: holdUsd,
      };
    }
    for (const win of windows) {
      if (win.limit_usd == null) continue;
      if (win.spent_usd + win.held_usd + holdUsd > win.limit_usd + EPS) {
        const remaining = Math.max(0, win.limit_usd - win.spent_usd - win.held_usd);
        return {
          ok: false,
          blocking_rule: win.rule,
          reason: `${win.label}: only $${remaining.toFixed(2)} remains (spent $${win.spent_usd.toFixed(2)}, reserved $${win.held_usd.toFixed(2)} of $${win.limit_usd.toFixed(2)}) but this needs up to $${holdUsd.toFixed(2)}.`,
          windows,
          hold_usd: holdUsd,
        };
      }
    }
    return { ok: true, blocking_rule: null, reason: null, windows, hold_usd: holdUsd };
  }

  /**
   * Take the hold for a job. Runs as one immediate transaction: reads and the insert see a
   * consistent ledger, and a concurrent admission waits for the write lock instead of racing.
   */
  admit(p: AdmitParams): { reservationId: number; holdUsd: number } {
    const now = p.now ?? new Date();
    const tx = this.db.transaction((): { reservationId: number; holdUsd: number } => {
      const s = this.settingsOrDefault(p.brandId);
      const w = this.windows(s, now, p.runId);
      const countsAgainstBudget = p.providerMode === "live" || s.count_mock_runs;
      if (countsAgainstBudget) {
        for (const win of [w.wallet, w.daily, w.two_day]) {
          if (win.limit_usd == null) continue;
          if (win.spent_usd + win.held_usd + p.holdUsd > win.limit_usd + EPS) {
            throw new BudgetWindowError(
              win.rule,
              win.limit_usd,
              win.spent_usd,
              win.held_usd,
              p.holdUsd,
              p.label,
            );
          }
        }
      }
      const ts = now.toISOString();
      this.db
        .prepare(
          `UPDATE budget_reservations SET status = 'released', released_at = ?, release_reason = 'superseded'
           WHERE run_id = ? AND status = 'active'`,
        )
        .run(ts, p.runId);
      const res = this.db
        .prepare(
          `INSERT INTO budget_reservations (brand_id, run_id, job_id, hold_usd, initial_hold_usd, provider_mode, status, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        )
        .run(p.brandId, p.runId, p.jobId, p.holdUsd, p.holdUsd, p.providerMode, p.label, ts);
      const id = Number(res.lastInsertRowid);
      this.db
        .prepare(
          `INSERT INTO budget_ledger (brand_id, run_id, reservation_id, kind, amount_usd, provider_mode, actor, note, created_at)
           VALUES (?, ?, ?, 'hold', ?, ?, 'system', ?, ?)`,
        )
        .run(p.brandId, p.runId, id, p.holdUsd, p.providerMode, p.label, ts);
      return { reservationId: id, holdUsd: p.holdUsd };
    });
    return tx.immediate();
  }

  release(reservationId: number, reason: string, actualUsd: number | null = null): void {
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare(`SELECT * FROM budget_reservations WHERE id = ? AND status = 'active'`)
        .get(reservationId) as ReservationRow | undefined;
      if (!row) return;
      const ts = nowIso();
      this.db
        .prepare(
          `UPDATE budget_reservations SET status = 'released', released_at = ?, release_reason = ?, actual_usd = ?, hold_usd = 0
           WHERE id = ?`,
        )
        .run(ts, reason, actualUsd, reservationId);
      this.db
        .prepare(
          `INSERT INTO budget_ledger (brand_id, run_id, reservation_id, kind, amount_usd, provider_mode, actor, note, created_at)
           VALUES (?, ?, ?, 'release', ?, ?, 'system', ?, ?)`,
        )
        .run(row.brand_id, row.run_id, reservationId, row.hold_usd, row.provider_mode, reason, ts);
    });
    tx.immediate();
  }

  releaseForRun(runId: string, reason: string, actualUsd: number | null = null): void {
    const active = this.activeReservationForRun(runId);
    if (active) this.release(active.id, reason, actualUsd);
  }

  // ---- reporting --------------------------------------------------------------------------------

  ledgerRows(brandId: string, limit = 200): LedgerRow[] {
    return this.db
      .prepare(`SELECT * FROM budget_ledger WHERE brand_id = ? ORDER BY id DESC LIMIT ?`)
      .all(brandId, limit) as LedgerRow[];
  }

  spentTodayByProvider(
    brandId: string,
    since: string,
    includeMock: boolean,
  ): Array<{ provider: string; model: string; usd: number; share: number }> {
    const rows = this.db
      .prepare(
        `SELECT g.provider AS provider, g.model AS model, COALESCE(SUM(l.amount_usd), 0) AS usd
         FROM budget_ledger l JOIN generations g ON g.id = l.generation_id
         WHERE l.brand_id = ? AND l.kind = 'spend' AND l.created_at >= ?${this.modeClause(includeMock).replace("provider_mode", "l.provider_mode")}
         GROUP BY g.provider, g.model ORDER BY usd DESC`,
      )
      .all(brandId, since) as Array<{ provider: string; model: string; usd: number }>;
    const total = rows.reduce((n, r) => n + r.usd, 0);
    return rows.map((r) => ({ ...r, share: total > 0 ? r.usd / total : 0 }));
  }

  failedSpend(
    brandId: string,
    since: string,
    includeMock: boolean,
  ): { usd: number; count: number } {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(COALESCE(g.actual_cost_usd, 0)), 0) AS usd, COUNT(*) AS count
         FROM generations g JOIN runs r ON r.run_id = g.run_id
         WHERE r.brand_id = ? AND g.status = 'failed' AND g.created_at >= ?${includeMock ? "" : " AND g.provider_mode = 'live'"}`,
      )
      .get(brandId, since) as { usd: number; count: number };
    return row;
  }

  status(brandId: string, now = new Date()): BudgetStatus {
    const configured = this.getSettings(brandId) !== null;
    const s = this.settingsOrDefault(brandId);
    const fx = this.fxFor(s.currency);
    const w = this.windows(s, now, null);
    const weekAgo = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();
    const failed = this.failedSpend(brandId, weekAgo, s.count_mock_runs);
    const byProvider = this.spentTodayByProvider(
      brandId,
      startOfDayIso(now, s.timezone),
      s.count_mock_runs,
    );
    const status: BudgetStatus = {
      brand_id: brandId,
      configured,
      settings: s,
      fx,
      wallet: w.wallet,
      daily: w.daily,
      two_day: w.two_day,
      active_holds: this.activeReservations(brandId),
      spent_today_by_provider: byProvider,
      failed_week_usd: failed.usd,
      failed_week_count: failed.count,
      notices: [],
      now: now.toISOString(),
    };
    status.notices = this.notices(status);
    return status;
  }

  notices(st: BudgetStatus): BudgetNotice[] {
    const out: BudgetNotice[] = [];
    const disp = (usd: number) =>
      st.fx.currency === "USD"
        ? `$${usd.toFixed(2)}`
        : `${st.fx.currency === "INR" ? "₹" : `${st.fx.currency} `}${Math.round(usd * st.fx.rate).toLocaleString("en-IN")}`;
    const d = st.daily;
    if (d.limit_usd != null && d.limit_usd > 0) {
      const used = d.spent_usd / d.limit_usd;
      const remaining = Math.max(0, d.limit_usd - d.spent_usd - d.held_usd);
      if (used >= 1)
        out.push({
          level: "critical",
          code: "daily_exhausted",
          message: "Today's hard budget is used up. No new generation can start until tomorrow.",
        });
      else if (used >= 0.8)
        out.push({
          level: "warning",
          code: "daily_80",
          message: `You have used ${Math.round(used * 100)}% of today's budget.`,
        });
      if (remaining > 0 && remaining < d.limit_usd * 0.25)
        out.push({
          level: "warning",
          code: "daily_low",
          message: `Only ${disp(remaining)} remains today (after active reservations).`,
        });
    }
    const w = st.wallet;
    if (w.limit_usd != null && w.available_usd != null && w.available_usd < w.limit_usd * 0.1) {
      out.push({
        level: w.available_usd <= 0 ? "critical" : "warning",
        code: "wallet_low",
        message: `Production wallet nearly empty: ${disp(Math.max(0, w.available_usd))} available.`,
      });
    }
    const t = st.two_day;
    if (t.limit_usd != null && t.spent_usd + t.held_usd > t.limit_usd * 0.8) {
      out.push({
        level: "warning",
        code: "two_day_80",
        message: `The 48-hour budget is ${Math.round(((t.spent_usd + t.held_usd) / t.limit_usd) * 100)}% committed.`,
      });
    }
    const top = st.spent_today_by_provider[0];
    if (top && top.share >= 0.7 && top.usd > 0) {
      out.push({
        level: "info",
        code: "provider_share",
        message: `${top.provider} ${top.model} currently represents ${Math.round(top.share * 100)}% of today's spend.`,
      });
    }
    if (st.failed_week_count > 0 && st.failed_week_usd > 0) {
      out.push({
        level: "info",
        code: "failed_spend",
        message: `${st.failed_week_count} failed generation${st.failed_week_count === 1 ? "" : "s"} cost ${disp(st.failed_week_usd)} this week.`,
      });
    }
    if (!st.configured) {
      out.push({
        level: "info",
        code: "unconfigured",
        message: "No budget limits configured for this brand; every run is admitted.",
      });
    }
    return out;
  }
}
