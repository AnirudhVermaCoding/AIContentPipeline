import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { shortHash } from "../util/fs.js";

/**
 * ProductProfile — one sellable product of a brand, with the reference photos and the rules that
 * keep generated imagery faithful to it. Lives at brands/<brand>/products/<id>/product.yaml with
 * its reference images under refs/. A run selects one product; the loader merges it into the
 * brand profile as `product` plus a `product` entity, so the pipeline needs no product concept.
 */

export const ReferenceView = z.enum([
  "front",
  "side",
  "three_quarter",
  "back",
  "detail",
  "in_use",
  "packaging",
  "logo",
  "other",
]);
export type ReferenceView = z.infer<typeof ReferenceView>;

export const ProductReference = z.object({
  path: z.string().describe("Relative to the product folder"),
  view: ReferenceView.default("other"),
  identity_critical: z.boolean().default(false),
  note: z.string().default(""),
});
export type ProductReference = z.infer<typeof ProductReference>;

export const ProductProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string(),
  category: z.string(),
  description: z.string(),
  /** Entity id used in storyboards/continuity; defaults to the product id with `-` → `_`. */
  entity_id: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .optional(),
  key_benefits: z.array(z.string()).default([]),
  allowed_claims: z.array(z.string()).default([]),
  forbidden_claims: z.array(z.string()).default([]),
  /** The identity sentence restated in every prompt (shape, colour, materials, proportions). */
  static_features: z.string().default(""),
  dynamic_defaults: z.string().default(""),
  /** Attributes generation must never change: shape, colour, wheel layout, logo, materials… */
  must_preserve: z.array(z.string()).default([]),
  references: z.array(ProductReference).default([]),
  reference_policy: z
    .object({
      /** How many references the product should have before generating it. */
      min: z.number().int().min(0).default(2),
      /** Refuse to generate below `min` (true) or only warn (false). */
      hard: z.boolean().default(false),
    })
    .default({ min: 2, hard: false }),
  tags: z.array(z.string()).default([]),
});
export type ProductProfile = z.infer<typeof ProductProfileSchema>;

export interface LoadedProduct {
  profile: ProductProfile;
  /** Hash of the canonical product file — part of the run's brand config version. */
  version: string;
  dir: string;
  file: string;
  /** Absolute reference paths that exist on disk, identity-critical first. */
  references: Array<ProductReference & { abs: string; exists: boolean }>;
  warnings: string[];
}

export function productsDir(brandDir: string): string {
  return path.join(brandDir, "products");
}

export function productEntityId(p: ProductProfile): string {
  return p.entity_id ?? p.id.replace(/-/g, "_");
}

export function listProductIds(brandDir: string): string[] {
  const root = productsDir(brandDir);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, "product.yaml")))
    .map((d) => d.name)
    .sort();
}

export function parseProduct(raw: unknown, file: string): ProductProfile {
  const parsed = ProductProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid product profile ${file}:\n${issues}`);
  }
  return parsed.data;
}

/** Ordered as the pipeline should use them: identity-critical references first, then the rest. */
export function orderReferences<T extends { identity_critical: boolean }>(refs: T[]): T[] {
  return [...refs].sort((a, b) => Number(b.identity_critical) - Number(a.identity_critical));
}

export function referenceWarnings(p: ProductProfile, existing: number): string[] {
  const warnings: string[] = [];
  const min = p.reference_policy.min;
  if (existing === 0) {
    warnings.push(
      `${p.name} has no reference images. The product will be generated from its description only; product consistency may be low.`,
    );
  } else if (existing < min) {
    warnings.push(
      `Only ${existing} product reference${existing === 1 ? "" : "s"} available (recommended ${min}). Product consistency may be lower.`,
    );
  }
  if (existing > 0 && !p.references.some((r) => r.identity_critical)) {
    warnings.push("No reference is marked identity-critical; all references are treated equally.");
  }
  return warnings;
}

export function loadProduct(brandDir: string, productId: string): LoadedProduct {
  const dir = path.join(productsDir(brandDir), productId);
  const file = path.join(dir, "product.yaml");
  if (!fs.existsSync(file)) {
    const known = listProductIds(brandDir);
    throw new Error(
      `Product "${productId}" not found (expected ${file}). Known products: ${known.join(", ") || "none"}`,
    );
  }
  const raw = YAML.parse(fs.readFileSync(file, "utf8"));
  const profile = parseProduct(raw, file);
  if (profile.id !== productId) {
    throw new Error(
      `Product id "${profile.id}" in ${file} does not match folder name "${productId}"`,
    );
  }
  const version = shortHash(profile);
  const references = orderReferences(
    profile.references.map((r) => {
      const abs = path.isAbsolute(r.path) ? r.path : path.join(dir, r.path);
      return { ...r, abs, exists: fs.existsSync(abs) };
    }),
  );
  const warnings = referenceWarnings(profile, references.filter((r) => r.exists).length);
  for (const r of references)
    if (!r.exists) warnings.push(`Reference image is missing on disk: ${r.path}`);
  return { profile, version, dir, file, references, warnings };
}

export function listProducts(brandDir: string): LoadedProduct[] {
  return listProductIds(brandDir).map((id) => loadProduct(brandDir, id));
}

export function saveProduct(brandDir: string, profile: ProductProfile): string {
  const parsed = ProductProfileSchema.parse(profile);
  const dir = path.join(productsDir(brandDir), parsed.id);
  fs.mkdirSync(path.join(dir, "refs"), { recursive: true });
  const file = path.join(dir, "product.yaml");
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, YAML.stringify(parsed, { lineWidth: 100 }));
  fs.renameSync(tmp, file);
  return file;
}
