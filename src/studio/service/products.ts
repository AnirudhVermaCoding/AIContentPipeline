import * as fs from "node:fs";
import * as path from "node:path";
import sharp from "sharp";
import { brandsRoot } from "../../brand/loader.js";
import {
  type LoadedProduct,
  listProducts,
  loadProduct,
  type ProductProfile,
  ProductProfileSchema,
  productEntityId,
  ReferenceView,
  saveProduct,
} from "../../brand/products.js";
import type { Db } from "../../db/sqlite.js";
import { nowIso } from "../../util/fs.js";
import type { AssetView, ProductView } from "../api-types.js";
import { brandFileUrl, runFileUrl } from "./common.js";

function brandDir(brandId: string): string {
  const dir = path.join(brandsRoot(), brandId);
  if (!fs.existsSync(path.join(dir, "brand.yaml"))) throw new Error(`Brand "${brandId}" not found`);
  return dir;
}

export function approvedAssets(db: Db, brandId: string, productId: string | null): AssetView[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.kind, a.run_id, a.shot_id, a.path, a.description, a.created_at, r.brand_id AS run_brand
       FROM assets a LEFT JOIN runs r ON r.run_id = a.run_id
       WHERE a.brand_id = ? AND (? IS NULL OR r.product_id = ? OR a.entities LIKE ?)
       ORDER BY a.created_at DESC LIMIT 200`,
    )
    .all(brandId, productId, productId, productId ? `%"${productId}"%` : null) as Array<{
    id: string;
    kind: string;
    run_id: string | null;
    shot_id: string | null;
    path: string;
    description: string;
    created_at: string;
  }>;
  return rows
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      run_id: r.run_id,
      shot_id: r.shot_id,
      path: r.path,
      url: r.run_id ? runFileUrl(brandId, r.run_id, r.path) : (brandFileUrl(brandId, r.path) ?? ""),
      description: r.description,
      created_at: r.created_at,
    }))
    .filter((a) => a.url);
}

export function productView(brandId: string, p: LoadedProduct, db: Db): ProductView {
  const runs = db
    .prepare(`SELECT COUNT(*) AS n FROM runs WHERE brand_id = ? AND product_id = ?`)
    .get(brandId, p.profile.id) as { n: number };
  return {
    id: p.profile.id,
    brand_id: brandId,
    name: p.profile.name,
    category: p.profile.category,
    description: p.profile.description,
    entity_id: productEntityId(p.profile),
    profile: p.profile,
    version: p.version,
    references: p.references.map((r) => ({
      ...r,
      url: r.exists ? brandFileUrl(brandId, r.abs) : null,
    })),
    warnings: p.warnings,
    reference_count: p.references.filter((r) => r.exists).length,
    approved_assets: approvedAssets(db, brandId, p.profile.id),
    runs_count: runs.n,
  };
}

export function listProductViews(db: Db, brandId: string): ProductView[] {
  return listProducts(brandDir(brandId)).map((p) => productView(brandId, p, db));
}

export function getProductView(db: Db, brandId: string, productId: string): ProductView {
  return productView(brandId, loadProduct(brandDir(brandId), productId), db);
}

export function upsertProduct(
  db: Db,
  brandId: string,
  input: unknown,
  actor = "local-user",
): ProductView {
  const parsed = ProductProfileSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid product: ${issues.join("; ")}`);
  }
  const dir = brandDir(brandId);
  const existing = fs.existsSync(path.join(dir, "products", parsed.data.id, "product.yaml"))
    ? loadProduct(dir, parsed.data.id).profile
    : null;
  // References are managed through the upload endpoints; keep the ones on disk.
  const profile: ProductProfile = {
    ...parsed.data,
    references: existing?.references ?? parsed.data.references,
  };
  saveProduct(dir, profile);
  db.prepare(
    `INSERT INTO audit_log (ts, actor, action, target_type, target_id, details) VALUES (?, ?, ?, 'product', ?, ?)`,
  ).run(
    nowIso(),
    actor,
    existing ? "product.update" : "product.create",
    `${brandId}/${profile.id}`,
    JSON.stringify({ name: profile.name }),
  );
  return getProductView(db, brandId, profile.id);
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ref"
  );
}

export async function addProductReference(
  db: Db,
  brandId: string,
  productId: string,
  file: { name: string; data: Buffer },
  meta: { view?: string; identity_critical?: boolean; note?: string },
  actor = "local-user",
): Promise<ProductView> {
  const dir = brandDir(brandId);
  const loaded = loadProduct(dir, productId);
  const view = ReferenceView.safeParse(meta.view ?? "other");
  if (!view.success) throw new Error(`Unknown reference view "${meta.view}"`);
  try {
    const info = await sharp(file.data).metadata();
    if (!info.width || !info.height) throw new Error("not an image");
  } catch {
    throw new Error(`"${file.name}" is not a readable image`);
  }
  const refsDir = path.join(loaded.dir, "refs");
  fs.mkdirSync(refsDir, { recursive: true });
  const base = slug(`${view.data}-${path.parse(file.name).name}`);
  let rel = `refs/${base}.png`;
  let n = 2;
  while (fs.existsSync(path.join(loaded.dir, rel))) rel = `refs/${base}-${n++}.png`;
  const png = await sharp(file.data).rotate().png().toBuffer();
  const tmp = `${path.join(loaded.dir, rel)}.part`;
  fs.writeFileSync(tmp, png);
  fs.renameSync(tmp, path.join(loaded.dir, rel));
  const profile: ProductProfile = {
    ...loaded.profile,
    references: [
      ...loaded.profile.references,
      {
        path: rel,
        view: view.data,
        identity_critical: meta.identity_critical ?? false,
        note: meta.note ?? "",
      },
    ],
  };
  saveProduct(dir, profile);
  db.prepare(
    `INSERT INTO audit_log (ts, actor, action, target_type, target_id, details) VALUES (?, ?, 'product.reference.add', 'product', ?, ?)`,
  ).run(
    nowIso(),
    actor,
    `${brandId}/${productId}`,
    JSON.stringify({
      path: rel,
      view: view.data,
      identity_critical: meta.identity_critical ?? false,
    }),
  );
  return getProductView(db, brandId, productId);
}

export function updateProductReference(
  db: Db,
  brandId: string,
  productId: string,
  refPath: string,
  patch: { view?: string; identity_critical?: boolean; note?: string; remove?: boolean },
  actor = "local-user",
): ProductView {
  const dir = brandDir(brandId);
  const loaded = loadProduct(dir, productId);
  const idx = loaded.profile.references.findIndex((r) => r.path === refPath);
  if (idx < 0) throw new Error(`Reference ${refPath} not found`);
  const refs = [...loaded.profile.references];
  if (patch.remove) {
    refs.splice(idx, 1);
    // The file stays on disk (never destroy an upload); it is simply no longer referenced.
  } else {
    const current = refs[idx] as ProductProfile["references"][number];
    const view = patch.view ? ReferenceView.parse(patch.view) : current.view;
    refs[idx] = {
      ...current,
      view,
      identity_critical: patch.identity_critical ?? current.identity_critical,
      note: patch.note ?? current.note,
    };
  }
  saveProduct(dir, { ...loaded.profile, references: refs });
  db.prepare(
    `INSERT INTO audit_log (ts, actor, action, target_type, target_id, details) VALUES (?, ?, 'product.reference.update', 'product', ?, ?)`,
  ).run(nowIso(), actor, `${brandId}/${productId}`, JSON.stringify({ path: refPath, ...patch }));
  return getProductView(db, brandId, productId);
}
