"use client";

import type { CostSource, FxSnapshot } from "@pipeline/studio/api-types";
import { useStudio } from "@/lib/studio-context";
import { cn } from "@/lib/utils";

export function formatUsd(usd: number, digits = 2): string {
  return `$${usd.toFixed(digits)}`;
}

export function formatInr(inr: number, digits = 0): string {
  return `₹${inr.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function useMoney() {
  const { settings } = useStudio();
  const rate = settings?.fx.rate ?? 84;
  const primary = settings?.display_currency ?? "INR";
  const fmt = (
    usd: number | null | undefined,
    opts: { digits?: number; approx?: boolean } = {},
  ) => {
    if (usd == null || Number.isNaN(usd)) return "—";
    const prefix = opts.approx ? "~" : "";
    if (primary === "USD") return `${prefix}${formatUsd(usd, opts.digits ?? 2)}`;
    const inr = usd * rate;
    const digits = opts.digits ?? (Math.abs(inr) < 10 ? 2 : Math.abs(inr) < 100 ? 1 : 0);
    return `${prefix}${formatInr(inr, digits)}`;
  };
  const secondary = (usd: number | null | undefined) => {
    if (usd == null) return "";
    return primary === "USD"
      ? `≈ ${formatInr(usd * rate, 0)}`
      : `${formatUsd(usd, usd < 1 ? 3 : 2)}`;
  };
  return { rate, primary, fmt, secondary, fx: settings?.fx ?? null };
}

const SOURCE_LABEL: Record<CostSource, string> = {
  PROVIDER_REPORTED: "Provider-reported",
  CALCULATED_FROM_USAGE: "Calculated from usage",
  ESTIMATED: "Estimated",
};

export function CostSourceBadge({
  source,
  className,
}: {
  source: CostSource | null | undefined;
  className?: string;
}) {
  if (!source) return null;
  const tone =
    source === "PROVIDER_REPORTED"
      ? "bg-ok-bg text-ok"
      : source === "CALCULATED_FROM_USAGE"
        ? "bg-info-bg text-info"
        : "bg-warn-bg text-warn";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        tone,
        className,
      )}
      title={SOURCE_LABEL[source]}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

export function Money({
  usd,
  approx,
  digits,
  source,
  secondary = true,
  className,
  size = "md",
  fx,
}: {
  usd: number | null | undefined;
  approx?: boolean;
  digits?: number;
  source?: CostSource | null;
  secondary?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  fx?: FxSnapshot | null;
}) {
  const m = useMoney();
  const rate = fx?.rate ?? m.rate;
  const primary = m.primary;
  const text = (() => {
    if (usd == null) return "—";
    const prefix = approx ? "~" : "";
    if (primary === "USD") return `${prefix}${formatUsd(usd, digits ?? 2)}`;
    const inr = usd * rate;
    const d = digits ?? (Math.abs(inr) < 10 ? 2 : Math.abs(inr) < 100 ? 1 : 0);
    return `${prefix}${formatInr(inr, d)}`;
  })();
  const sec =
    usd == null
      ? ""
      : primary === "USD"
        ? `≈ ${formatInr(usd * rate, 0)}`
        : formatUsd(usd, usd < 1 ? 3 : 2);
  const sizes = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-xl font-semibold",
    xl: "text-3xl font-semibold tracking-tight",
  };
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 num", className)}>
      <span className={sizes[size]}>{text}</span>
      {secondary && usd != null ? <span className="text-xs text-fg-subtle">{sec}</span> : null}
      {source ? <CostSourceBadge source={source} /> : null}
    </span>
  );
}
