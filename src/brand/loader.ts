import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import { type BrandProfile, BrandProfileSchema } from "./schema.js";

export interface LoadedBrand {
  profile: BrandProfile;
  /** sha256 of the canonical (parsed, re-serialised) brand file — the brand config version. */
  version: string;
  dir: string;
  file: string;
}

export function brandsRoot(): string {
  return path.resolve(process.env.AICP_BRANDS_DIR ?? "brands");
}

export function listBrandIds(root: string = brandsRoot()): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, "brand.yaml")))
    .map((d) => d.name)
    .sort();
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
  const parsed = BrandProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid brand profile ${file}:\n${issues}`);
  }
  const profile = parsed.data;
  if (profile.id !== brandId) {
    throw new Error(`Brand id "${profile.id}" in ${file} does not match folder name "${brandId}"`);
  }
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
  for (const ent of profile.entities) ent.reference_images = ent.reference_images.map(resolveAsset);

  const canonical = JSON.stringify(parsed.data, Object.keys(parsed.data).sort());
  const version = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return { profile, version, dir, file };
}
