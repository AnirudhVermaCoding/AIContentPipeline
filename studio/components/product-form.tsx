"use client";

import type { ProductProfile, ProductView } from "@pipeline/studio/api-types";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { apiPost, apiPut } from "@/lib/api";

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export function ProductForm({
  brandId,
  product,
  onSaved,
}: {
  brandId: string;
  product?: ProductView;
  onSaved: (p: ProductView) => void;
}) {
  const p = product?.profile;
  const [id, setId] = useState(p?.id ?? "");
  const [name, setName] = useState(p?.name ?? "");
  const [category, setCategory] = useState(p?.category ?? "children's toy");
  const [description, setDescription] = useState(p?.description ?? "");
  const [staticFeatures, setStaticFeatures] = useState(p?.static_features ?? "");
  const [dynamicDefaults, setDynamicDefaults] = useState(p?.dynamic_defaults ?? "");
  const [benefits, setBenefits] = useState((p?.key_benefits ?? []).join("\n"));
  const [allowed, setAllowed] = useState((p?.allowed_claims ?? []).join("\n"));
  const [forbidden, setForbidden] = useState((p?.forbidden_claims ?? []).join("\n"));
  const [preserve, setPreserve] = useState(
    (p?.must_preserve ?? ["shape", "color", "materials", "logo", "functionality"]).join("\n"),
  );
  const [min, setMin] = useState(String(p?.reference_policy.min ?? 2));
  const [hard, setHard] = useState(p?.reference_policy.hard ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const profile: ProductProfile = {
        id: (id || name)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
        name,
        category,
        description,
        key_benefits: lines(benefits),
        allowed_claims: lines(allowed),
        forbidden_claims: lines(forbidden),
        static_features: staticFeatures,
        dynamic_defaults: dynamicDefaults,
        must_preserve: lines(preserve),
        references: p?.references ?? [],
        reference_policy: { min: Number(min) || 0, hard },
        tags: p?.tags ?? [],
      };
      const saved = product
        ? await apiPut<ProductView>(`/api/brands/${brandId}/products/${product.id}`, { profile })
        : await apiPost<ProductView>(`/api/brands/${brandId}/products`, { profile });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Domino Laying Train"
        />
      </Field>
      <Field
        label="Id (folder name)"
        hint="Lowercase letters, digits and dashes. Cannot change later."
      >
        <Input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="domino-train"
          disabled={!!product}
        />
      </Field>
      <Field label="Category">
        <Input value={category} onChange={(e) => setCategory(e.target.value)} />
      </Field>
      <Field
        label="Identity sentence"
        hint="Restated in every prompt: shape, colours, materials, proportions."
        className="sm:col-span-2"
      >
        <Textarea
          rows={2}
          value={staticFeatures}
          onChange={(e) => setStaticFeatures(e.target.value)}
          placeholder="a small blue toy train with a yellow cab, four black wheels and a domino hopper on top"
        />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field
        label="Typical state"
        hint="Unless the brief changes it (e.g. clean, on a wooden floor)."
      >
        <Input value={dynamicDefaults} onChange={(e) => setDynamicDefaults(e.target.value)} />
      </Field>
      <Field
        label="Must preserve (one per line)"
        hint="Shape, color, wheel layout, accessories, materials, logo, functionality…"
      >
        <Textarea rows={4} value={preserve} onChange={(e) => setPreserve(e.target.value)} />
      </Field>
      <Field label="Key benefits (one per line)">
        <Textarea rows={3} value={benefits} onChange={(e) => setBenefits(e.target.value)} />
      </Field>
      <Field label="Allowed claims (one per line)">
        <Textarea rows={3} value={allowed} onChange={(e) => setAllowed(e.target.value)} />
      </Field>
      <Field label="Forbidden claims (one per line)">
        <Textarea rows={3} value={forbidden} onChange={(e) => setForbidden(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Recommended references">
          <Input type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} />
        </Field>
        <Field
          label="Hard requirement"
          hint="Refuse to generate below the minimum (otherwise only warn)."
        >
          <div className="flex h-9 items-center">
            <Switch checked={hard} onCheckedChange={setHard} />
          </div>
        </Field>
      </div>
      <ErrorBanner message={error} className="sm:col-span-2" />
      <div className="flex justify-end sm:col-span-2">
        <Button onClick={save} disabled={busy || !name.trim() || !description.trim()}>
          {busy ? "Saving…" : product ? "Save product" : "Create product"}
        </Button>
      </div>
    </div>
  );
}
