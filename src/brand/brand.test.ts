import { describe, expect, it } from "vitest";
import { compileBrandBrain } from "./brain.js";
import { listBrandIds, loadBrand } from "./loader.js";
import { BrandProfileSchema } from "./schema.js";

describe("brand profiles", () => {
  it("ships two example brands that load and validate", () => {
    const ids = listBrandIds();
    expect(ids).toContain("bachalogy");
    expect(ids).toContain("mindcode");
    for (const id of ids) {
      const b = loadBrand(id);
      expect(b.profile.id).toBe(id);
      expect(b.version).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("produces a stable version hash for the same file", () => {
    const a = loadBrand("bachalogy");
    const b = loadBrand("bachalogy");
    expect(a.version).toBe(b.version);
    expect(a.version).not.toBe(loadBrand("mindcode").version);
  });

  it("gives different brands materially different agent context", () => {
    const toy = compileBrandBrain(loadBrand("bachalogy").profile);
    const app = compileBrandBrain(loadBrand("mindcode").profile);
    expect(toy.creative).not.toBe(app.creative);
    expect(toy.visual).not.toBe(app.visual);
    expect(toy.creative).toContain("Wobble Bot");
    expect(app.creative).toContain("psychology");
    expect(toy.visual).toContain("sky-blue");
    expect(toy.edit).toContain("LIGHT");
    expect(app.edit).toContain("ASSEMBLY");
  });

  it("rejects a profile whose id does not match the folder", () => {
    expect(() => loadBrand("does-not-exist")).toThrow(/not found/);
  });

  it("applies defaults so a minimal profile is valid", () => {
    const minimal = BrandProfileSchema.parse({
      id: "tiny",
      name: "Tiny",
      audience: { primary: "people" },
      product: { name: "Thing", category: "thing", description: "a thing" },
      tone: { voice_adjectives: ["plain"], writing_style: "plain" },
      emotions: { primary: ["calm"] },
      content_pillars: [{ id: "p", name: "P", description: "d" }],
      visual: {
        style_summary: "plain",
        colors: {
          primary: "#000",
          secondary: "#111",
          accent: "#222",
          background: "#fff",
          text: "#000",
        },
        fonts: { heading: "Inter", body: "Inter" },
        camera_language: {},
      },
      pacing: {},
      voice: { voice_id: "v" },
      music: {},
      text_policy: {},
      cta: {},
      edit_defaults: {},
      budget: {},
      forbidden: {},
    });
    expect(minimal.budget.hard_cap_usd).toBe(2.5);
    expect(minimal.edit_defaults.transitions_allowed).toEqual(["cut"]);
    expect(minimal.text_policy.captions).toBe("never");
  });
});
