"use client";

import type { ProductView } from "@pipeline/studio/api-types";
import { ArrowLeft, Star, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { ProductForm } from "@/components/product-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { ErrorBanner, SectionTitle, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/hooks/use-api";
import { apiPatch, apiUpload, fileUrl } from "@/lib/api";
import { useStudio } from "@/lib/studio-context";
import { cn, titleCase } from "@/lib/utils";

const VIEWS = [
  "front",
  "side",
  "three_quarter",
  "back",
  "detail",
  "in_use",
  "packaging",
  "logo",
  "other",
];

export default function ProductPage() {
  const { productId } = useParams<{ productId: string }>();
  const { brandId } = useStudio();
  const { data, error, loading, refresh, setData } = useApi<ProductView>(
    brandId ? `/api/brands/${brandId}/products/${productId}` : null,
    { deps: [brandId, productId] },
  );
  const [view, setView] = useState("front");
  const [identity, setIdentity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  async function upload(files: FileList | null) {
    if (!files?.length || !brandId) return;
    setBusy(true);
    setErr(null);
    try {
      for (const f of Array.from(files)) {
        const form = new FormData();
        form.set("file", f);
        form.set("view", view);
        form.set("identity_critical", identity ? "true" : "false");
        const next = await apiUpload<ProductView>(
          `/api/brands/${brandId}/products/${productId}/references`,
          form,
        );
        setData(() => next);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function patch(path: string, body: Record<string, unknown>) {
    if (!brandId) return;
    setBusy(true);
    setErr(null);
    try {
      const next = await apiPatch<ProductView>(
        `/api/brands/${brandId}/products/${productId}/references`,
        { path, ...body },
      );
      setData(() => next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (loading && !data) return <Skeleton className="h-64" />;
  if (error && !data) return <ErrorBanner message={error} />;
  if (!data) return null;
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/products"
          className="mb-1 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="h-3 w-3" /> Products
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          <Badge variant="outline">{data.category}</Badge>
          <Badge
            variant={data.reference_count >= data.profile.reference_policy.min ? "ok" : "warn"}
          >
            {data.reference_count} reference{data.reference_count === 1 ? "" : "s"}
          </Badge>
        </div>
        <p className="text-sm text-fg-muted">{data.description}</p>
      </div>
      {data.warnings.length ? (
        <div className="rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-xs text-warn">
          {data.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}
      <ErrorBanner message={err} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <div>
            <SectionTitle
              title="Reference photos"
              description="Mark the photos that define the product's identity; they are always sent to the image model first."
            />
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.references.map((r) => {
                const src = fileUrl(r.url);
                return (
                  <Card key={r.path} className={cn("overflow-hidden", !r.exists && "opacity-60")}>
                    <div className="flex aspect-square items-center justify-center bg-surface-2">
                      {src ? (
                        <img src={src} alt={r.view} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xs text-fg-subtle">missing file</span>
                      )}
                    </div>
                    <CardContent className="space-y-2 pt-2">
                      <Select
                        value={r.view}
                        onChange={(e) => patch(r.path, { view: e.target.value })}
                        className="h-8 text-xs"
                        disabled={busy}
                      >
                        {VIEWS.map((v) => (
                          <option key={v} value={v}>
                            {titleCase(v)}
                          </option>
                        ))}
                      </Select>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1">
                          <Star
                            className={cn(
                              "h-3 w-3",
                              r.identity_critical ? "text-amber-500" : "text-fg-subtle",
                            )}
                          />{" "}
                          Identity-critical
                        </span>
                        <Switch
                          aria-label="Identity-critical"
                          checked={r.identity_critical}
                          onCheckedChange={(v) => patch(r.path, { identity_critical: v })}
                          disabled={busy}
                        />
                      </div>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs text-fg-subtle hover:text-danger"
                        onClick={() => patch(r.path, { remove: true })}
                        disabled={busy}
                      >
                        <Trash2 className="h-3 w-3" /> Remove from product (file kept)
                      </button>
                    </CardContent>
                  </Card>
                );
              })}
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-center text-xs text-fg-muted hover:bg-surface-2">
                <Upload className="h-5 w-5" />
                <span>{busy ? "Uploading…" : "Upload photos"}</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => upload(e.target.files)}
                  disabled={busy}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="View for the next upload">
                <Select value={view} onChange={(e) => setView(e.target.value)} className="w-44">
                  {VIEWS.map((v) => (
                    <option key={v} value={v}>
                      {titleCase(v)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex h-9 items-center gap-2 text-sm">
                <Switch
                  aria-label="Identity-critical for the next upload"
                  checked={identity}
                  onCheckedChange={setIdentity}
                />{" "}
                Identity-critical
              </div>
            </div>
          </div>
          <div>
            <SectionTitle
              title="Approved generations"
              description="Keyframes and clips approved in runs of this product, reusable as references later."
            />
            {data.approved_assets.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                {data.approved_assets.map((a) => (
                  <Link
                    key={a.id}
                    href={a.run_id ? `/runs/${a.run_id}` : "#"}
                    className="overflow-hidden rounded-md border border-border"
                  >
                    {a.kind === "keyframe" ? (
                      <img
                        src={fileUrl(a.url) ?? ""}
                        alt=""
                        className="aspect-[9/16] w-full object-cover"
                      />
                    ) : (
                      <video
                        src={fileUrl(a.url) ?? ""}
                        className="aspect-[9/16] w-full object-cover"
                        muted
                        preload="metadata"
                      />
                    )}
                    <div className="truncate px-1 py-0.5 text-[10px] text-fg-subtle">
                      {a.shot_id ?? a.kind}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-fg-subtle">No approved generations yet.</p>
            )}
          </div>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Product rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium text-fg-muted">Identity</p>
                <p>
                  {data.profile.static_features || <span className="text-fg-subtle">not set</span>}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-fg-muted">Must preserve</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {data.profile.must_preserve.map((m) => (
                    <Badge key={m} variant="outline">
                      {m}
                    </Badge>
                  ))}
                </div>
              </div>
              {data.profile.forbidden_claims.length ? (
                <div>
                  <p className="text-xs font-medium text-fg-muted">Forbidden claims</p>
                  <ul className="list-disc pl-4 text-xs">
                    {data.profile.forbidden_claims.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-[11px] text-fg-subtle">
                Reference policy: {data.profile.reference_policy.min} recommended,{" "}
                {data.profile.reference_policy.hard ? "required" : "warn only"} · entity id{" "}
                {data.entity_id} · version {data.version}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Edit product</CardTitle>
            </CardHeader>
            <CardContent>
              <ProductForm
                key={data.version}
                brandId={brandId}
                product={data}
                onSaved={() => void refresh()}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
