import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import {
  brandsRoot,
  brandVersionOf,
  type LoadedBrand,
  listBrandIds,
  loadBrand,
  parseBrandProfile,
} from "../../brand/loader.js";
import { listProducts } from "../../brand/products.js";
import { type BrandProfile, BrandProfileSchema } from "../../brand/schema.js";
import { resolveProviders, snapshotProviders } from "../../config/settings.js";
import type { Db } from "../../db/sqlite.js";
import { nowIso } from "../../util/fs.js";
import type { BrandDetail, BrandSummary, BrandVersionView } from "../api-types.js";
import { brandFileUrl } from "./common.js";
import { productView } from "./products.js";

export function brandSummary(b: LoadedBrand): BrandSummary {
  const p = b.profile;
  const logo = p.visual.logos[0]?.path ?? null;
  const productsCount = listProducts(b.dir).length;
  return {
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    audience: p.audience.primary,
    product_name: p.product.name,
    description: p.product.description,
    direction_summary: p.visual.style_summary,
    version: b.version,
    colors: p.visual.colors,
    fonts: p.visual.fonts,
    logo_url: logo ? brandFileUrl(p.id, logo) : null,
    pillars: p.content_pillars.map((c) => c.name),
    tone: p.tone.voice_adjectives,
    emotions: [...p.emotions.primary, ...p.emotions.secondary],
    budget: p.budget,
    voice_configured: !p.voice.voice_id.startsWith("REPLACE_WITH"),
    products_count: productsCount,
  };
}

export function listBrands(): BrandSummary[] {
  return listBrandIds().map((id) => brandSummary(loadBrand(id)));
}

function ensureVersionRow(
  db: Db,
  brandId: string,
  version: string,
  file: string | null,
  note: string | null,
  actor = "system",
): void {
  db.prepare(
    `INSERT OR IGNORE INTO brand_versions (brand_id, version, file, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(brandId, version, file, actor, note, nowIso());
}

export function brandVersions(db: Db, brandId: string, current: string): BrandVersionView[] {
  ensureVersionRow(db, brandId, current, null, "current file");
  const rows = db
    .prepare(`SELECT * FROM brand_versions WHERE brand_id = ? ORDER BY created_at DESC`)
    .all(brandId) as Array<{
    version: string;
    created_at: string;
    actor: string;
    note: string | null;
    file: string | null;
  }>;
  const counts = db
    .prepare(
      `SELECT brand_config_version AS v, COUNT(*) AS n FROM runs WHERE brand_id = ? GROUP BY brand_config_version`,
    )
    .all(brandId) as Array<{ v: string; n: number }>;
  const byVersion = new Map(counts.map((c) => [c.v, c.n]));
  return rows.map((r) => ({
    version: r.version,
    created_at: r.created_at,
    actor: r.actor,
    note: r.note,
    file: r.file,
    current: r.version === current,
    runs_count: byVersion.get(r.version) ?? 0,
  }));
}

/** The profile as written in brand.yaml (relative asset paths), validated with defaults applied. */
export function rawBrandProfile(brandId: string): BrandProfile {
  const file = path.join(brandsRoot(), brandId, "brand.yaml");
  return parseBrandProfile(YAML.parse(fs.readFileSync(file, "utf8")), file);
}

export function brandDetail(db: Db, brandId: string): BrandDetail {
  const loaded = loadBrand(brandId);
  const summary = brandSummary(loaded);
  return {
    ...summary,
    profile: rawBrandProfile(brandId),
    file: loaded.file,
    versions: brandVersions(db, brandId, loaded.version),
    products: listProducts(loaded.dir).map((p) => productView(brandId, p, db)),
    providers: snapshotProviders(resolveProviders(loaded.profile)),
  };
}

/**
 * Save a new brand direction. The previous file is kept under history/ and every version is
 * recorded, so runs keep pointing at the exact direction that produced them.
 */
export function saveBrandProfile(
  db: Db,
  brandId: string,
  input: unknown,
  opts: { note?: string | null; actor?: string } = {},
): BrandDetail {
  const dir = path.join(brandsRoot(), brandId);
  const file = path.join(dir, "brand.yaml");
  if (!fs.existsSync(file)) throw new Error(`Brand "${brandId}" not found`);
  const parsed = BrandProfileSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    const err = new Error(`Invalid brand profile: ${issues.join("; ")}`) as Error & {
      issues?: string[];
    };
    err.issues = issues;
    throw err;
  }
  const profile = parsed.data;
  if (profile.id !== brandId) throw new Error(`Brand id must stay "${brandId}"`);
  // Verify referenced assets exist before writing anything.
  const check = (p: string) => {
    const abs = path.isAbsolute(p) ? p : path.join(dir, p);
    if (!fs.existsSync(abs)) throw new Error(`Referenced asset is missing: ${p}`);
  };
  for (const l of profile.visual.logos) check(l.path);
  for (const r of profile.visual.references) check(r.path);
  for (const e of profile.entities) for (const r of e.reference_images) check(r);
  const previous = loadBrand(brandId);
  const version = brandVersionOf(profile);
  if (version === previous.version) return brandDetail(db, brandId);
  const historyDir = path.join(dir, "history");
  fs.mkdirSync(historyDir, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, "-");
  const archived = path.join(historyDir, `${stamp}-${previous.version}.yaml`);
  fs.copyFileSync(file, archived);
  ensureVersionRow(db, brandId, previous.version, archived, "archived before edit");
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, YAML.stringify(profile, { lineWidth: 100 }));
  fs.renameSync(tmp, file);
  db.prepare(
    `INSERT OR REPLACE INTO brand_versions (brand_id, version, file, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(brandId, version, file, opts.actor ?? "local-user", opts.note ?? null, nowIso());
  db.prepare(
    `INSERT INTO audit_log (ts, actor, action, target_type, target_id, details) VALUES (?, ?, 'brand.save', 'brand', ?, ?)`,
  ).run(
    nowIso(),
    opts.actor ?? "local-user",
    brandId,
    JSON.stringify({ version, previous: previous.version, note: opts.note ?? null }),
  );
  return brandDetail(db, brandId);
}

export function readBrandVersionFile(brandId: string, version: string, db: Db): string | null {
  const row = db
    .prepare(`SELECT file FROM brand_versions WHERE brand_id = ? AND version = ?`)
    .get(brandId, version) as { file: string | null } | undefined;
  const file =
    row?.file ??
    (version === loadBrand(brandId).version
      ? path.join(brandsRoot(), brandId, "brand.yaml")
      : null);
  if (!file || !fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}
