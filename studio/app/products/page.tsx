"use client";

import type { ProductView } from "@pipeline/studio/api-types";
import { ImageOff, Package, Plus, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ProductForm } from "@/components/product-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorBanner, PageHeader, Skeleton } from "@/components/ui/misc";
import { useApi } from "@/hooks/use-api";
import { fileUrl } from "@/lib/api";
import { useStudio } from "@/lib/studio-context";

export default function ProductsPage() {
  const { brandId, brand } = useStudio();
  const { data, error, loading, refresh } = useApi<ProductView[]>(
    brandId ? `/api/brands/${brandId}/products` : null,
    { deps: [brandId] },
  );
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Products / Assets"
        description={`Reference photos, packaging, constraints and approved generations for ${brand?.name ?? "this brand"}. Files live under brands/${brandId}/products/.`}
        right={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New product
          </Button>
        }
      />
      <ErrorBanner message={error} />
      {loading && !data ? <Skeleton className="h-40" /> : null}
      {data && !data.length ? (
        <EmptyState
          title="No products yet"
          description="Add the products you sell so runs can use their reference photos and rules."
          action={<Button onClick={() => setCreating(true)}>New product</Button>}
        />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {(data ?? []).map((p) => {
          const hero =
            p.references.find((r) => r.identity_critical && r.url) ??
            p.references.find((r) => r.url);
          const src = fileUrl(hero?.url ?? null);
          return (
            <Link
              key={p.id}
              href={`/products/${p.id}`}
              className="card overflow-hidden transition-shadow hover:shadow-md"
            >
              <div className="flex aspect-[4/3] items-center justify-center bg-surface-2">
                {src ? (
                  <img src={src} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-fg-subtle">
                    <ImageOff className="h-6 w-6" />
                    <span className="text-xs">No reference photos</span>
                  </div>
                )}
              </div>
              <CardContent className="space-y-1.5 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">{p.name}</h3>
                  <Badge
                    variant={
                      p.reference_count >= p.profile.reference_policy.min
                        ? "ok"
                        : p.reference_count
                          ? "warn"
                          : "danger"
                    }
                  >
                    {p.reference_count} ref{p.reference_count === 1 ? "" : "s"}
                  </Badge>
                </div>
                <p className="line-clamp-2 text-xs text-fg-muted">{p.description}</p>
                <div className="flex flex-wrap gap-1 pt-1 text-[11px] text-fg-subtle">
                  <span>{p.category}</span>
                  {p.references.some((r) => r.identity_critical) ? (
                    <span className="flex items-center gap-0.5">
                      <Star className="h-3 w-3 text-amber-500" /> identity refs
                    </span>
                  ) : null}
                  <span>
                    · {p.runs_count} video{p.runs_count === 1 ? "" : "s"}
                  </span>
                  <span>
                    · {p.approved_assets.length} approved asset
                    {p.approved_assets.length === 1 ? "" : "s"}
                  </span>
                </div>
              </CardContent>
            </Link>
          );
        })}
      </div>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" /> New product
            </DialogTitle>
          </DialogHeader>
          {brandId ? (
            <ProductForm
              brandId={brandId}
              onSaved={() => {
                setCreating(false);
                void refresh();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
