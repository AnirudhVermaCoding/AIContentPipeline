"use client";

import type { BudgetStatus, LedgerRow, RunSummary } from "@pipeline/studio/api-types";
import { useEffect, useState } from "react";
import { Money, useMoney } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import {
  ErrorBanner,
  PageHeader,
  Progress,
  SectionTitle,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/hooks/use-api";
import { apiPut } from "@/lib/api";
import { useStudio } from "@/lib/studio-context";
import { cn, formatDate } from "@/lib/utils";

function Window({ w, title }: { w: BudgetStatus["daily"]; title: string }) {
  const pct = w.limit_usd ? Math.min(100, ((w.spent_usd + w.held_usd) / w.limit_usd) * 100) : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-fg-muted">Limit</span>
          {w.limit_usd == null ? (
            <span className="text-fg-subtle">none</span>
          ) : (
            <Money usd={w.limit_usd} secondary={false} size="sm" />
          )}
        </div>
        <div className="flex justify-between">
          <span className="text-fg-muted">Spent</span>
          <Money usd={w.spent_usd} secondary={false} size="sm" />
        </div>
        <div className="flex justify-between">
          <span className="text-fg-muted">Reserved</span>
          <Money usd={w.held_usd} secondary={false} size="sm" />
        </div>
        <div className="flex justify-between font-medium">
          <span>Available</span>
          {w.available_usd == null ? (
            <span className="text-fg-subtle">unlimited</span>
          ) : (
            <span className={cn(w.available_usd <= 0 && "text-danger")}>
              <Money usd={Math.max(0, w.available_usd)} secondary={false} size="sm" />
            </span>
          )}
        </div>
        {w.limit_usd ? <Progress value={pct} tone={pct >= 80 ? "warn" : "accent"} /> : null}
        {w.window_start ? (
          <p className="text-[11px] text-fg-subtle">since {formatDate(w.window_start)}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function BudgetPage() {
  const { brandId } = useStudio();
  const m = useMoney();
  const status = useApi<BudgetStatus>(brandId ? `/api/budget/${brandId}` : null, {
    refreshMs: 5000,
    deps: [brandId],
  });
  const ledger = useApi<LedgerRow[]>(brandId ? `/api/budget/${brandId}/ledger?limit=150` : null, {
    refreshMs: 10000,
    deps: [brandId],
  });
  const runs = useApi<RunSummary[]>(brandId ? `/api/runs?brand=${brandId}&limit=50` : null, {
    deps: [brandId],
  });
  const [form, setForm] = useState<{
    wallet: string;
    daily: string;
    two: string;
    tz: string;
    mock: boolean;
    currency: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const s = status.data?.settings;
    if (s && !form)
      setForm({
        wallet: s.wallet_amount?.toString() ?? "",
        daily: s.daily_amount?.toString() ?? "",
        two: s.two_day_amount?.toString() ?? "",
        tz: s.timezone,
        mock: s.count_mock_runs,
        currency: s.currency,
      });
  }, [status.data, form]);
  async function save() {
    if (!form || !brandId) return;
    setSaving(true);
    setErr(null);
    try {
      await apiPut(`/api/budget/${brandId}/settings`, {
        currency: form.currency,
        wallet_amount: form.wallet ? Number(form.wallet) : null,
        daily_amount: form.daily ? Number(form.daily) : null,
        two_day_amount: form.two ? Number(form.two) : null,
        timezone: form.tz,
        count_mock_runs: form.mock,
      });
      await status.refresh();
      await ledger.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  const d = status.data;
  if (status.loading && !d) return <Skeleton className="h-64" />;
  if (!d) return <ErrorBanner message={status.error} />;
  const finished = (runs.data ?? []).filter((r) => r.ui_status === "complete");
  const estVsActual = finished.map((r) => ({
    id: r.run_id,
    title: r.title,
    est: r.estimated_usd,
    actual: r.spent_usd,
  }));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget & Usage"
        description="An internal accounting wallet plus daily and 48-hour hard limits. Hard rules always win; the router's soft targets work inside them."
      />
      {d.notices.length ? (
        <div className="space-y-2">
          {d.notices.map((n) => (
            <div
              key={n.code}
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                n.level === "critical"
                  ? "border-danger/30 bg-danger-bg text-danger"
                  : n.level === "warning"
                    ? "border-warn/30 bg-warn-bg text-warn"
                    : "border-info/20 bg-info-bg text-info",
              )}
            >
              {n.message}
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Window w={d.wallet} title="Production wallet" />
        <Window w={d.daily} title="Today's hard budget" />
        <Window w={d.two_day} title="48-hour hard budget" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {form ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Accounting currency">
                  <Select
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                  </Select>
                </Field>
                <Field label="Timezone for 'today'">
                  <Input
                    value={form.tz}
                    onChange={(e) => setForm({ ...form, tz: e.target.value })}
                    placeholder="Asia/Kolkata"
                  />
                </Field>
                <Field
                  label={`Production wallet (${form.currency})`}
                  hint="Total the studio may spend from now on. Leave empty for no limit."
                >
                  <Input
                    type="number"
                    value={form.wallet}
                    onChange={(e) => setForm({ ...form, wallet: e.target.value })}
                    placeholder="4000"
                  />
                </Field>
                <Field label={`Daily hard budget (${form.currency})`}>
                  <Input
                    type="number"
                    value={form.daily}
                    onChange={(e) => setForm({ ...form, daily: e.target.value })}
                    placeholder="500"
                  />
                </Field>
                <Field label={`48-hour hard budget (${form.currency})`}>
                  <Input
                    type="number"
                    value={form.two}
                    onChange={(e) => setForm({ ...form, two: e.target.value })}
                    placeholder="900"
                  />
                </Field>
                <Field
                  label="Count simulated (mock) runs"
                  hint="Mock runs use the same accounting with placeholder media."
                >
                  <div className="flex h-9 items-center">
                    <Switch
                      checked={form.mock}
                      onCheckedChange={(v) => setForm({ ...form, mock: v })}
                    />
                  </div>
                </Field>
              </div>
            ) : null}
            <ErrorBanner message={err} />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-fg-subtle">
                Per-video cap and soft AI-video seconds live in Brand Direction → Budget defaults.
                Rate: 1 USD = {m.rate} INR (Settings).
              </p>
              <Button onClick={save} disabled={saving || !form}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Today by provider</CardTitle>
          </CardHeader>
          <CardContent>
            {d.spent_today_by_provider.length ? (
              <ul className="space-y-2">
                {d.spent_today_by_provider.map((p) => (
                  <li key={`${p.provider}:${p.model}`}>
                    <div className="flex justify-between text-sm">
                      <span>
                        {p.provider} <span className="text-fg-muted">{p.model}</span>
                      </span>
                      <span>
                        <Money usd={p.usd} secondary={false} size="sm" />{" "}
                        <span className="text-xs text-fg-subtle">{Math.round(p.share * 100)}%</span>
                      </span>
                    </div>
                    <Progress value={p.share * 100} className="mt-1 h-1" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-subtle">No spend today.</p>
            )}
            <p className="mt-3 text-xs text-fg-muted">
              Failed generations this week: {d.failed_week_count} ·{" "}
              <Money usd={d.failed_week_usd} secondary={false} size="sm" />
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div>
          <SectionTitle title="Estimate vs actual" description="Finished videos" />
          <Card>
            <CardContent className="p-0">
              <Table>
                <thead>
                  <tr className="border-b border-border">
                    <Th>Video</Th>
                    <Th className="text-right">Estimate</Th>
                    <Th className="text-right">Actual</Th>
                    <Th className="text-right">Δ</Th>
                  </tr>
                </thead>
                <tbody>
                  {estVsActual.map((r) => (
                    <Tr key={r.id}>
                      <Td className="truncate">{r.title}</Td>
                      <Td className="text-right">
                        <Money usd={r.est} secondary={false} size="sm" />
                      </Td>
                      <Td className="text-right">
                        <Money usd={r.actual} secondary={false} size="sm" />
                      </Td>
                      <Td className={cn("text-right", r.actual > r.est ? "text-warn" : "text-ok")}>
                        <Money usd={r.actual - r.est} secondary={false} size="sm" />
                      </Td>
                    </Tr>
                  ))}
                  {!estVsActual.length ? (
                    <Tr>
                      <Td colSpan={4} className="text-fg-subtle">
                        No finished videos yet.
                      </Td>
                    </Tr>
                  ) : null}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        </div>
        <div>
          <SectionTitle title="Active reservations" description="Holds taken by running jobs" />
          <Card>
            <CardContent className="p-0">
              <Table>
                <thead>
                  <tr className="border-b border-border">
                    <Th>Run</Th>
                    <Th>Job</Th>
                    <Th className="text-right">Held</Th>
                    <Th>Since</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.active_holds.map((h) => (
                    <Tr key={h.id}>
                      <Td className="mono text-xs">{h.run_id}</Td>
                      <Td className="text-xs">{h.job_id}</Td>
                      <Td className="text-right">
                        <Money usd={h.hold_usd} secondary={false} size="sm" />
                      </Td>
                      <Td className="text-xs text-fg-muted">{formatDate(h.created_at)}</Td>
                    </Tr>
                  ))}
                  {!d.active_holds.length ? (
                    <Tr>
                      <Td colSpan={4} className="text-fg-subtle">
                        No active holds.
                      </Td>
                    </Tr>
                  ) : null}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
      <div>
        <SectionTitle
          title="Ledger"
          description="Append-only budget entries: spend per paid call, holds, releases, settings changes."
        />
        <Card>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr className="border-b border-border">
                  <Th>When</Th>
                  <Th>Kind</Th>
                  <Th>Run</Th>
                  <Th className="text-right">USD</Th>
                  <Th className="text-right">{m.primary === "USD" ? "INR" : m.primary}</Th>
                  <Th>Mode</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {(ledger.data ?? []).map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap text-xs text-fg-muted">
                      {formatDate(r.created_at)}
                    </Td>
                    <Td>
                      <Badge
                        variant={
                          r.kind === "spend"
                            ? "default"
                            : r.kind === "hold"
                              ? "info"
                              : r.kind === "release"
                                ? "ok"
                                : "muted"
                        }
                      >
                        {r.kind}
                      </Badge>
                    </Td>
                    <Td className="mono text-xs">{r.run_id ?? "—"}</Td>
                    <Td className="text-right text-xs num">${r.amount_usd.toFixed(4)}</Td>
                    <Td className="text-right text-xs num">
                      {r.amount_display != null
                        ? `₹${r.amount_display.toFixed(2)}`
                        : r.fx_rate
                          ? `₹${(r.amount_usd * r.fx_rate).toFixed(2)}`
                          : "—"}
                    </Td>
                    <Td className="text-xs">{r.provider_mode}</Td>
                    <Td
                      className="max-w-[260px] truncate text-xs text-fg-muted"
                      title={r.note ?? ""}
                    >
                      {r.note}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
