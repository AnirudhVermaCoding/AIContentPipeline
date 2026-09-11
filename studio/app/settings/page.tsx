"use client";

import type { HealthReport, StudioSettings } from "@pipeline/studio/api-types";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import {
  ErrorBanner,
  PageHeader,
  Skeleton,
  StatusDot,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui/misc";
import { useApi } from "@/hooks/use-api";
import { apiGet, apiPut } from "@/lib/api";
import { useStudio } from "@/lib/studio-context";
import { formatDate } from "@/lib/utils";

export default function SettingsPage() {
  const { brandId, settings, refreshSettings } = useStudio();
  const health = useApi<HealthReport>(brandId ? `/api/health?brand=${brandId}` : "/api/health", {
    deps: [brandId],
  });
  const [probing, setProbing] = useState(false);
  const [currency, setCurrency] = useState<"INR" | "USD" | "">("");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function probe() {
    setProbing(true);
    try {
      const r = await apiGet<HealthReport>(`/api/health?brand=${brandId}&probe=1`);
      health.setData(() => r);
    } finally {
      setProbing(false);
    }
  }
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await apiPut<StudioSettings>("/api/settings", {
        ...(currency ? { display_currency: currency } : {}),
        ...(rate ? { fx_rate: { rate: Number(rate), note: note || null } } : {}),
      });
      setRate("");
      setNote("");
      await refreshSettings();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const h = health.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Provider health, models, pricing table and currency. API keys are read from .env and never shown here."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Provider health</CardTitle>
            <Button variant="secondary" size="sm" onClick={probe} disabled={probing}>
              <RefreshCw className={probing ? "animate-spin" : ""} /> Test connections
            </Button>
          </CardHeader>
          <CardContent>
            {!h ? <Skeleton className="h-32" /> : null}
            {h ? (
              <ul className="divide-y divide-border">
                {h.providers.map((p) => (
                  <li
                    key={p.capability}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">
                        {p.provider}{" "}
                        <span className="text-fg-muted">· {p.capability.replace("_", " ")}</span>
                      </div>
                      <div className="text-xs text-fg-muted">
                        {p.model}
                        {!p.priced ? " · no price in the table" : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <StatusDot
                        tone={
                          !p.configured
                            ? "danger"
                            : p.connectivity === "unreachable"
                              ? "danger"
                              : p.connectivity === "connected"
                                ? "ok"
                                : "info"
                        }
                      />
                      {!p.configured
                        ? `Missing (${p.env_keys.join(", ")})`
                        : p.connectivity === "connected"
                          ? "Connected"
                          : p.connectivity === "unreachable"
                            ? `Unreachable: ${p.detail}`
                            : "Configured"}
                    </div>
                  </li>
                ))}
                {h.tools.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{t.label}</div>
                      <div className="truncate text-xs text-fg-muted">{t.detail}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <StatusDot
                        tone={
                          t.status === "ready" ? "ok" : t.status === "missing" ? "warn" : "danger"
                        }
                      />
                      {t.status === "ready"
                        ? "Ready"
                        : t.status === "missing"
                          ? "Missing"
                          : "Error"}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {h ? (
              <p className="mt-3 text-[11px] text-fg-subtle">
                Mode {h.provider_mode} · root {h.paths.root} · runs {h.paths.runs} · data{" "}
                {h.paths.data} · checked {formatDate(h.checked_at)}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Currency</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-fg-muted">
              Provider costs are recorded in USD. Display and budgets use the rate below; every
              ledger row stores the rate it was converted with.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Primary currency">
                <Select
                  value={currency || settings?.display_currency || "INR"}
                  onChange={(e) => setCurrency(e.target.value as "INR" | "USD")}
                >
                  <option value="INR">INR primary, USD secondary</option>
                  <option value="USD">USD primary, INR secondary</option>
                </Select>
              </Field>
              <Field
                label="USD → INR rate"
                hint={
                  settings
                    ? `Current: ${settings.fx.rate} (${settings.fx.source ?? "manual"}, ${settings.fx.effective_at ? formatDate(settings.fx.effective_at) : "seed"})`
                    : undefined
                }
              >
                <Input
                  type="number"
                  step="0.01"
                  placeholder={String(settings?.fx.rate ?? "")}
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </Field>
              <Field label="Rate note" className="sm:col-span-2">
                <Input
                  placeholder="e.g. bank rate on 11 Sep"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </div>
            <ErrorBanner message={err} />
            <Button onClick={save} disabled={busy || (!currency && !rate)}>
              Save
            </Button>
            {settings?.fx_history.length ? (
              <ul className="text-xs text-fg-muted">
                {settings.fx_history.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    {formatDate(r.effective_at)}: {r.rate} {r.note ? `· ${r.note}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Pricing table</CardTitle>
          {settings ? (
            <Badge variant={settings.pricing.stale ? "warn" : "ok"}>
              as of {settings.pricing.as_of}
              {settings.pricing.stale ? " · stale" : ""}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-fg-muted">
            Every estimate and every calculated cost reads this versioned table
            (src/config/pricing.ts). Edit it there and restart; the version is stamped on each
            ledger row.
          </p>
          {settings ? (
            <Table>
              <thead>
                <tr className="border-b border-border">
                  <Th>Kind</Th>
                  <Th>Provider:model</Th>
                  <Th>Price (USD)</Th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(
                  settings.pricing.table as Record<string, Record<string, Record<string, unknown>>>,
                ).flatMap(([kind, models]) =>
                  Object.entries(models).map(([key, price]) => (
                    <Tr key={`${kind}:${key}`}>
                      <Td className="text-xs">{kind}</Td>
                      <Td className="text-xs font-medium">{key}</Td>
                      <Td className="mono text-xs text-fg-muted">
                        {Object.entries(price)
                          .filter(([k]) => k !== "note")
                          .map(
                            ([k, v]) =>
                              `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
                          )
                          .join("  ")}
                      </Td>
                    </Tr>
                  )),
                )}
              </tbody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
