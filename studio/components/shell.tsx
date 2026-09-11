"use client";

import type { BudgetStatus, HealthReport } from "@pipeline/studio/api-types";
import {
  Activity,
  BadgeIndianRupee,
  Clapperboard,
  Film,
  LayoutDashboard,
  Menu,
  Package,
  Palette,
  PlusCircle,
  Settings,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Money } from "@/components/money";
import { Select } from "@/components/ui/input";
import { StatusDot, Tooltip } from "@/components/ui/misc";
import { useApi } from "@/hooks/use-api";
import { useStudio } from "@/lib/studio-context";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/create", label: "Create Video", icon: PlusCircle },
  { href: "/runs", label: "Active Runs", icon: Activity },
  { href: "/videos", label: "Videos", icon: Film },
  { href: "/products", label: "Products / Assets", icon: Package },
  { href: "/brand", label: "Brand Direction", icon: Palette },
  { href: "/budget", label: "Budget & Usage", icon: BadgeIndianRupee },
  { href: "/settings", label: "Settings", icon: Settings },
];

function providerTone(p: HealthReport["providers"][number]): "ok" | "warn" | "danger" | "muted" {
  if (!p.configured) return "danger";
  if (p.connectivity === "unreachable") return "danger";
  if (!p.priced) return "warn";
  return "ok";
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { brands, brandId, setBrandId, ready, error } = useStudio();
  const budget = useApi<BudgetStatus>(brandId ? `/api/budget/${brandId}` : null, {
    refreshMs: 10_000,
    deps: [brandId],
  });
  const health = useApi<HealthReport>(brandId ? `/api/health?brand=${brandId}` : null, {
    refreshMs: 60_000,
    deps: [brandId],
  });
  const daily = budget.data?.daily;
  const providers = (health.data?.providers ?? []).filter(
    (p, i, arr) => arr.findIndex((x) => x.provider === p.provider) === i,
  );
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur md:px-6">
      <button
        type="button"
        className="rounded-md p-1.5 hover:bg-surface-2 md:hidden"
        onClick={onMenu}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="flex-1" />
      {error ? <span className="text-xs text-danger">API unreachable: {error}</span> : null}
      <div className="hidden items-center gap-4 sm:flex">
        <div className="text-right leading-tight">
          <div className="text-[10px] uppercase tracking-wide text-fg-subtle">Today</div>
          <div className="text-sm font-medium num">
            {daily ? (
              <>
                <Money usd={daily.spent_usd} secondary={false} size="sm" />
                <span className="text-fg-subtle"> / </span>
                {daily.limit_usd != null ? (
                  <Money usd={daily.limit_usd} secondary={false} size="sm" />
                ) : (
                  <span className="text-fg-subtle">no limit</span>
                )}
              </>
            ) : (
              <span className="text-fg-subtle">—</span>
            )}
          </div>
        </div>
        {daily?.available_usd != null ? (
          <div className="text-right leading-tight">
            <div className="text-[10px] uppercase tracking-wide text-fg-subtle">Remaining</div>
            <div
              className={cn(
                "text-sm font-medium num",
                daily.available_usd <= 0
                  ? "text-danger"
                  : daily.available_usd < (daily.limit_usd ?? 0) * 0.2
                    ? "text-warn"
                    : "text-ok",
              )}
            >
              <Money usd={Math.max(0, daily.available_usd)} secondary={false} size="sm" />
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-2 border-l border-border pl-4">
          {providers.map((p) => (
            <Tooltip
              key={p.provider}
              content={`${p.provider}: ${p.configured ? "key configured" : `${p.env_keys.join(", ")} missing`}${p.connectivity === "connected" ? " · connected" : p.connectivity === "unreachable" ? ` · ${p.detail ?? "unreachable"}` : ""}`}
            >
              <span className="flex items-center gap-1 text-xs text-fg-muted">
                {p.provider}
                <StatusDot tone={providerTone(p)} />
              </span>
            </Tooltip>
          ))}
          {health.data?.provider_mode === "mock" ? (
            <span className="rounded bg-warn-bg px-1.5 py-0.5 text-[10px] font-medium uppercase text-warn">
              mock mode
            </span>
          ) : null}
        </div>
      </div>
      <Select
        value={brandId}
        onChange={(e) => setBrandId(e.target.value)}
        className="h-8 w-auto min-w-[140px] font-medium"
        aria-label="Brand"
        disabled={!ready || brands.length === 0}
      >
        {brands.length === 0 ? <option value="">{ready ? "No brands" : "Loading…"}</option> : null}
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
    </header>
  );
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg">
          <Clapperboard className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold tracking-tight">AI Video Studio</span>
      </div>
      <div className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
                active && "bg-surface-2 font-medium text-fg",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="px-5 py-4 text-[11px] text-fg-subtle">
        Local studio · runs and spend stay on this machine
      </div>
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface md:block">
        <div className="sticky top-0 h-screen">
          <SideNav />
        </div>
      </aside>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          />
          <aside className="absolute left-0 top-0 h-full w-64 bg-surface shadow-xl">
            <button
              type="button"
              className="absolute right-3 top-4 rounded-md p-1 hover:bg-surface-2"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <SideNav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setOpen(true)} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
