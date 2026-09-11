import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import { repoRoot } from "../config/env.js";
import { readJson, shortHash, stableStringify, writeJsonAtomic } from "../util/fs.js";
import { type LoadedProduct, loadProduct, productEntityId } from "./products.js";
import { type BrandProfile, BrandProfileSchema } from "./schema.js";

export interface LoadedBrand {
  profile: BrandProfile;
  /**
   * The brand config version: sha256 (16 hex) of the canonical parsed profile, computed before
   * asset paths are absolutised so it is stable across machines and changes whenever any field
   * changes. With a product selected it also covers the product file.
   */
  version: string;
  dir: string;
  file: string;
  /** The product merged into this profile, when a run selected one. */
  product: LoadedProduct | null;
}

export function brandsRoot(): string {
  return path.resolve(repoRoot(), process.env.AICP_BRANDS_DIR ?? "brands");
}

export function listBrandIds(root: string = brandsRoot()): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, "brand.yaml")))
    .map((d) => d.name)
    .sort();
}

export function brandVersionOf(profile: BrandProfile): string {
  return shortHash(stableStringify(profile));
}

export function parseBrandProfile(raw: unknown, file: string): BrandProfile {
  const parsed = BrandProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid brand profile ${file}:\n${issues}`);
  }
  return parsed.data;
}

export function loadBrand(brandId: string, root: string = brandsRoot()): LoadedBrand {
  const dir = path.join(root, brandId);
  const file = path.join(dir, "brand.yaml");
  if (!fs.existsSync(file)) {
    const known = listBrandIds(root);
    throw new Error(
      `Brand "${brandId}" not found (expected ${file}). Known brands: ${known.join(", ") || "none"}`,
    );
  }
  const raw = YAML.parse(fs.readFileSync(file, "utf8"));
  const profile = parseBrandProfile(raw, file);
  if (profile.id !== brandId) {
    throw new Error(`Brand id "${profile.id}" in ${file} does not match folder name "${brandId}"`);
  }
  // Version before resolution, so the same file hashes the same on every machine.
  const version = brandVersionOf(profile);
  // Resolve asset paths relative to the brand folder and verify they exist.
  const resolveAsset = (p: string): string => {
    const abs = path.isAbsolute(p) ? p : path.join(dir, p);
    if (!fs.existsSync(abs)) {
      throw new Error(`Brand ${brandId} references a missing asset: ${p}`);
    }
    return abs;
  };
  for (const logo of profile.visual.logos) logo.path = resolveAsset(logo.path);
  for (const ref of profile.visual.references) ref.path = resolveAsset(ref.path);
  for (const ent of profile.entities) {
    ent.reference_images = ent.reference_images.map(resolveAsset);
    ent.identity_refs = ent.identity_refs.map(resolveAsset);
  }
  return { profile, version, dir, file, product: null };
}

/**
 * The brand as a run sees it: the brand profile with the selected product merged in as
 * `product` and as an always-present product entity whose reference images are the product's
 * photos (identity-critical first). The version then covers both files.
 */
export function loadBrandForRun(
  brandId: string,
  productId: string | null | undefined,
  root: string = brandsRoot(),
): LoadedBrand {
  const brand = loadBrand(brandId, root);
  if (!productId) return brand;
  const product = loadProduct(brand.dir, productId);
  const p = product.profile;
  const refs = product.references.filter((r) => r.exists);
  const entityId = productEntityId(p);
  const staticFeatures = [
    p.static_features,
    p.must_preserve.length ? `Must preserve: ${p.must_preserve.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const entity = {
    id: entityId,
    kind: "product" as const,
    name: p.name,
    static_features: staticFeatures || p.description,
    dynamic_defaults: p.dynamic_defaults,
    reference_images: refs.map((r) => r.abs),
    identity_refs: refs.filter((r) => r.identity_critical).map((r) => r.abs),
    always_present: true,
  };
  const profile: BrandProfile = {
    ...brand.profile,
    product: {
      name: p.name,
      category: p.category,
      description: p.description,
      key_benefits: p.key_benefits,
      allowed_claims: p.allowed_claims,
      forbidden_claims: [...brand.profile.product.forbidden_claims, ...p.forbidden_claims],
    },
    entities: [entity, ...brand.profile.entities.filter((e) => e.id !== entityId)],
  };
  const version = shortHash({ brand: brand.version, product: product.version });
  return { ...brand, profile, version, product };
}

export const BRAND_SNAPSHOT_FILE = "brand.snapshot.json";

interface BrandSnapshot {
  version: string;
  brand_id: string;
  product_id: string | null;
  dir: string;
  file: string;
  profile: BrandProfile;
  product: LoadedProduct | null;
}

/** Freeze the effective profile next to the run so resuming never changes its provenance. */
export function writeBrandSnapshot(runDir: string, brand: LoadedBrand): string {
  const file = path.join(runDir, BRAND_SNAPSHOT_FILE);
  const snapshot: BrandSnapshot = {
    version: brand.version,
    brand_id: brand.profile.id,
    product_id: brand.product?.profile.id ?? null,
    dir: brand.dir,
    file: brand.file,
    profile: brand.profile,
    product: brand.product,
  };
  writeJsonAtomic(file, snapshot);
  return file;
}

export function hasBrandSnapshot(runDir: string): boolean {
  return fs.existsSync(path.join(runDir, BRAND_SNAPSHOT_FILE));
}

export function loadBrandSnapshot(runDir: string): LoadedBrand {
  const file = path.join(runDir, BRAND_SNAPSHOT_FILE);
  const snap = readJson<BrandSnapshot>(file);
  const profile = parseBrandProfile(snap.profile, file);
  return {
    profile,
    version: snap.version,
    dir: snap.dir,
    file: snap.file,
    product: snap.product ?? null,
  };
}
