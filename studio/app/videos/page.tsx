"use client";

import type { ProductView, RunSummary, UiRunStatus } from "@pipeline/studio/api-types";
import { useMemo, useState } from "react";
import { useMoney } from "@/components/money";
import { RunTable } from "@/components/run-list";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { ErrorBanner, PageHeader, Skeleton } from "@/components/ui/misc";
import { useApi } from "@/hooks/use-api";
import { useStudio } from "@/lib/studio-context";

const STATUSES: Array<{ value: UiRunStatus | ""; label: string }> = [
  { value: "", label: "Any status" },
  { value: "complete", label: "Complete" },
  { value: "planning", label: "Planning" },
  { value: "awaiting_storyboard_approval", label: "Awaiting storyboard approval" },
  { value: "awaiting_keyframe_approval", label: "Awaiting keyframe approval" },
  { value: "producing", label: "Generating" },
  { value: "rendering", label: "Rendering" },
  { value: "paused", label: "Paused" },
  { value: "failed", label: "Failed" },
  { value: "budget_conflict", label: "Budget conflict" },
  { value: "cancelled", label: "Cancelled" },
  { value: "interrupted", label: "Interrupted" },
];

export default function VideosPage() {
  const { brandId, brands } = useStudio();
  const m = useMoney();
  const [brand, setBrand] = useState<string>("");
  const [product, setProduct] = useState("");
  const [status, setStatus] = useState<string>("");
  const [qc, setQc] = useState("");
  const [model, setModel] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minCost, setMinCost] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const effectiveBrand = brand || brandId;
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (effectiveBrand) q.set("brand", effectiveBrand);
    if (product) q.set("product", product);
    if (status) q.set("status", status);
    if (qc) q.set("qc", qc);
    if (model) q.set("model", model);
    if (search) q.set("search", search);
    if (from) q.set("from", new Date(from).toISOString());
    if (to) q.set("to", new Date(`${to}T23:59:59`).toISOString());
    if (minCost) q.set("min_usd", String(Number(minCost) / (m.primary === "USD" ? 1 : m.rate)));
    if (maxCost) q.set("max_usd", String(Number(maxCost) / (m.primary === "USD" ? 1 : m.rate)));
    q.set("limit", "300");
    return q.toString();
  }, [
    effectiveBrand,
    product,
    status,
    qc,
    model,
    search,
    from,
    to,
    minCost,
    maxCost,
    m.rate,
    m.primary,
  ]);
  const { data, error, loading } = useApi<RunSummary[]>(`/api/runs?${query}`, {
    refreshMs: 8000,
    deps: [query],
  });
  const products = useApi<ProductView[]>(
    effectiveBrand ? `/api/brands/${effectiveBrand}/products` : null,
    { deps: [effectiveBrand] },
  );
  const models = useMemo(() => [...new Set((data ?? []).flatMap((r) => r.models))].sort(), [data]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Videos"
        description="Every run, searchable and filterable. Click one to open its full record."
      />
      <Card>
        <CardContent className="grid gap-3 pt-4 md:grid-cols-4 lg:grid-cols-6">
          <Select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand">
            <option value="">Current brand</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Product">
            <option value="">Any product</option>
            {(products.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select value={qc} onChange={(e) => setQc(e.target.value)} aria-label="QC">
            <option value="">Any QC</option>
            <option value="pass">Passed</option>
            <option value="pass_with_warnings">Passed with warnings</option>
            <option value="fail">Failed</option>
          </Select>
          <Select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
            <option value="">Any model</option>
            {models.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
          <Input
            placeholder="Search title / topic / id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
          />
          <Input
            type="number"
            placeholder={`Min cost (${m.primary})`}
            value={minCost}
            onChange={(e) => setMinCost(e.target.value)}
          />
          <Input
            type="number"
            placeholder={`Max cost (${m.primary})`}
            value={maxCost}
            onChange={(e) => setMaxCost(e.target.value)}
          />
        </CardContent>
      </Card>
      <ErrorBanner message={error} />
      <Card>
        <CardContent className="p-0">
          {loading && !data ? <Skeleton className="m-4 h-40" /> : <RunTable runs={data ?? []} />}
        </CardContent>
      </Card>
    </div>
  );
}
