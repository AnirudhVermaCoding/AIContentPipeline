"use client";

import type { ProductView } from "@pipeline/studio/api-types";
import { ImageOff, Star } from "lucide-react";
import { fileUrl } from "@/lib/api";
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

export function ProductReferenceStrip({
  product,
  onSelect,
  selected,
}: {
  product: ProductView;
  onSelect?: (path: string) => void;
  selected?: Set<string>;
}) {
  const byView = new Map(product.references.map((r) => [r.path, r]));
  const ordered = [...byView.values()].sort(
    (a, b) => VIEWS.indexOf(a.view) - VIEWS.indexOf(b.view),
  );
  const missing = VIEWS.slice(0, 6).filter((v) => !ordered.some((r) => r.view === v));
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {ordered.map((r) => {
          const src = fileUrl(r.url);
          const sel = selected?.has(r.path);
          return (
            <button
              key={r.path}
              type="button"
              onClick={() => onSelect?.(r.path)}
              className={cn(
                "group relative aspect-square overflow-hidden rounded-md border bg-surface-2 text-left",
                sel ? "border-accent ring-2 ring-accent/30" : "border-border",
                !onSelect && "cursor-default",
              )}
            >
              {src ? (
                <img src={src} alt={r.view} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-fg-subtle">
                  <ImageOff className="h-4 w-4" />
                </div>
              )}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {titleCase(r.view)}
              </span>
              {r.identity_critical ? (
                <span
                  className="absolute right-1 top-1 rounded bg-amber-400 p-0.5 text-black"
                  title="Identity-critical reference"
                >
                  <Star className="h-3 w-3" />
                </span>
              ) : null}
            </button>
          );
        })}
        {missing.map((v) => (
          <div
            key={v}
            className="flex aspect-square flex-col items-center justify-center rounded-md border border-dashed border-border text-[10px] text-fg-subtle"
          >
            <span>{titleCase(v)}</span>
            <span>missing</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-fg-subtle">
        {product.reference_count} reference image{product.reference_count === 1 ? "" : "s"}
        {product.references.some((r) => r.identity_critical)
          ? " · ★ identity-critical references are always sent to the image model"
          : ""}
      </p>
    </div>
  );
}
