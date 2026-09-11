import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";
import { brandVersionOf, loadBrand, loadBrandForRun, parseBrandProfile } from "./loader.js";
import { listProducts, loadProduct, referenceWarnings, saveProduct } from "./products.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicp-products-"));
const root = path.join(tmp, "brands");

beforeAll(async () => {
  fs.mkdirSync(path.join(root, "bachalogy"), { recursive: true });
  fs.copyFileSync(
    path.resolve("brands/bachalogy/brand.yaml"),
    path.join(root, "bachalogy", "brand.yaml"),
  );
  const file = saveProduct(path.join(root, "bachalogy"), {
    id: "domino-train",
    name: "Domino Laying Train",
    category: "children's toy",
    description: "A battery-powered toy train that lays dominoes in a line as it drives.",
    key_benefits: ["Sets up dominoes so the child can knock them down"],
    allowed_claims: [],
    forbidden_claims: ["teaches physics"],
    static_features: "a small blue toy train with a yellow cab and a domino hopper",
    dynamic_defaults: "",
    must_preserve: ["shape", "colour", "wheel layout"],
    references: [
      { path: "refs/front.png", view: "front", identity_critical: true, note: "" },
      { path: "refs/side.png", view: "side", identity_critical: false, note: "" },
    ],
    reference_policy: { min: 2, hard: false },
    tags: [],
  });
  const refs = path.join(path.dirname(file), "refs");
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#4fa3e0" },
  })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(refs, "front.png"), png);
  // side.png deliberately missing
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("brand version hash", () => {
  it("changes when a nested field changes", () => {
    const raw = YAML.parse(fs.readFileSync(path.resolve("brands/bachalogy/brand.yaml"), "utf8"));
    const a = brandVersionOf(parseBrandProfile(raw, "a"));
    raw.visual.colors.primary = "#000000";
    const b = brandVersionOf(parseBrandProfile(raw, "b"));
    raw.visual.colors.primary = "#4FA3E0";
    raw.budget.hard_cap_usd = 9;
    const c = brandVersionOf(parseBrandProfile(raw, "c"));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable across loads and independent of the absolute path", () => {
    const v1 = loadBrand("bachalogy").version;
    const v2 = loadBrand("bachalogy", root).version;
    expect(v1).toBe(v2);
  });
});

describe("product catalog", () => {
  it("lists and loads products with ordered, existence-checked references", () => {
    const products = listProducts(path.join(root, "bachalogy"));
    expect(products.map((p) => p.profile.id)).toEqual(["domino-train"]);
    const p = loadProduct(path.join(root, "bachalogy"), "domino-train");
    expect(p.references[0]?.view).toBe("front");
    expect(p.references[0]?.identity_critical).toBe(true);
    expect(p.references[0]?.exists).toBe(true);
    expect(p.references[1]?.exists).toBe(false);
    expect(p.warnings.some((w) => /Only 1 product reference/.test(w))).toBe(true);
    expect(p.warnings.some((w) => /missing on disk/.test(w))).toBe(true);
  });

  it("warns about missing references without blocking", () => {
    const p = loadProduct(path.join(root, "bachalogy"), "domino-train");
    expect(referenceWarnings(p.profile, 0)[0]).toMatch(/no reference images/);
    expect(referenceWarnings(p.profile, 2)).toEqual([]);
  });

  it("merges the product into the brand profile and the version", () => {
    const plain = loadBrand("bachalogy", root);
    const merged = loadBrandForRun("bachalogy", "domino-train", root);
    expect(merged.profile.product.name).toBe("Domino Laying Train");
    expect(merged.profile.product.forbidden_claims).toContain("teaches physics");
    expect(merged.profile.product.forbidden_claims).toContain("Makes your child smarter");
    const entity = merged.profile.entities[0];
    expect(entity?.id).toBe("domino_train");
    expect(entity?.kind).toBe("product");
    expect(entity?.always_present).toBe(true);
    expect(entity?.reference_images).toHaveLength(1);
    expect(entity?.identity_refs).toHaveLength(1);
    expect(entity?.static_features).toMatch(/Must preserve: shape, colour, wheel layout/);
    // The original wobble_bot entity is kept, the product leads.
    expect(merged.profile.entities.some((e) => e.id === "wobble_bot")).toBe(true);
    expect(merged.version).not.toBe(plain.version);
    expect(loadBrandForRun("bachalogy", null, root).version).toBe(plain.version);
  });
});
