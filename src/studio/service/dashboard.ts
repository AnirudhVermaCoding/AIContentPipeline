import { loadBrand } from "../../brand/loader.js";
import { startOfDayIso } from "../../budget/ledger.js";
import type { DashboardView } from "../api-types.js";
import { brandSummary } from "./brand.js";
import { healthReport } from "./health.js";
import { listRuns, type StudioContext, usageCounters } from "./runs.js";

const ACTIVE = new Set([
  "planning",
  "producing",
  "rendering",
  "awaiting_storyboard_approval",
  "awaiting_keyframe_approval",
  "paused",
]);

export async function dashboardView(ctx: StudioContext, brandId: string): Promise<DashboardView> {
  const brand = loadBrand(brandId);
  const budget = ctx.ledger.status(brandId);
  const runs = listRuns(ctx, { brand: brandId, limit: 60 });
  const since = startOfDayIso(new Date(), budget.settings.timezone);
  const includeMock = budget.settings.count_mock_runs;
  return {
    brand: brandSummary(brand),
    budget,
    recent_runs: runs.slice(0, 8),
    active_runs: runs.filter((r) => ACTIVE.has(r.ui_status)),
    usage_today: {
      by_provider: budget.spent_today_by_provider,
      ...usageCounters(ctx, brandId, since, includeMock),
    },
    totals: {
      ...usageCounters(ctx, brandId, null, includeMock),
    },
    fx: budget.fx,
    health: await healthReport(ctx.db, brandId),
  };
}
