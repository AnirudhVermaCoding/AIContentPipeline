import { describe, expect, it } from "vitest";
import { loadBrand } from "../brand/loader.js";
import type { RunManifest } from "../schema/manifest.js";
import {
  buildCreativeControlContext,
  CREATIVE_PRESETS,
  conceptCandidateCount,
  creativeHashInputs,
  creativeLabel,
  DEFAULT_CREATIVE_CONTROLS,
  goalLabel,
  hardConstraintsFor,
  presetFor,
  resolveCreativeControls,
  variationGuidance,
} from "./controls.js";

describe("creative controls: labels, presets, defaults", () => {
  it("maps values to the semantic ranges from the spec", () => {
    expect(creativeLabel(0)).toBe("Safe");
    expect(creativeLabel(0.2)).toBe("Safe");
    expect(creativeLabel(0.21)).toBe("Focused");
    expect(creativeLabel(0.4)).toBe("Focused");
    expect(creativeLabel(0.5)).toBe("Balanced");
    expect(creativeLabel(0.65)).toBe("Bold");
    expect(creativeLabel(0.8)).toBe("Bold");
    expect(creativeLabel(0.81)).toBe("Wild");
    expect(creativeLabel(1)).toBe("Wild");
    expect(goalLabel(0.1)).toBe("Explore");
    expect(goalLabel(0.3)).toBe("Loose");
    expect(goalLabel(0.5)).toBe("Balanced");
    expect(goalLabel(0.7)).toBe("Focused");
    expect(goalLabel(0.85)).toBe("Goal-first");
  });

  it("uses the spec defaults when neither the run nor the brand say anything", () => {
    const r = resolveCreativeControls({}, { creative_defaults: undefined });
    expect(r.creative_freedom).toBe(DEFAULT_CREATIVE_CONTROLS.creative_freedom);
    expect(r.goal_focus).toBe(DEFAULT_CREATIVE_CONTROLS.goal_focus);
    expect(r.sources).toEqual({ creative_freedom: "default", goal_focus: "default" });
    expect(r.creative_label).toBe("Bold");
    expect(r.goal_label).toBe("Goal-first");
  });

  it("brand defaults fill in, run values override, out-of-range values are ignored", () => {
    const brand = { creative_defaults: { creative_freedom: 0.7, goal_focus: 0.9 } };
    const fromBrand = resolveCreativeControls(null, brand);
    expect(fromBrand.creative_freedom).toBe(0.7);
    expect(fromBrand.sources.creative_freedom).toBe("brand");
    const fromRun = resolveCreativeControls({ creative_freedom: 0.2 }, brand);
    expect(fromRun.creative_freedom).toBe(0.2);
    expect(fromRun.goal_focus).toBe(0.9);
    expect(fromRun.sources).toEqual({ creative_freedom: "run", goal_focus: "brand" });
    const bad = resolveCreativeControls({ creative_freedom: 1.5, goal_focus: -1 }, brand);
    expect(bad.creative_freedom).toBe(0.7);
    expect(bad.goal_focus).toBe(0.9);
  });

  it("presets carry the requested values and are recognised", () => {
    const byId = Object.fromEntries(CREATIVE_PRESETS.map((p) => [p.id, p]));
    expect(byId.direct_ad).toMatchObject({ creative_freedom: 0.25, goal_focus: 0.95 });
    expect(byId.creative_ad).toMatchObject({ creative_freedom: 0.7, goal_focus: 0.9 });
    expect(byId.brand_film).toMatchObject({ creative_freedom: 0.8, goal_focus: 0.5 });
    expect(byId.experimental).toMatchObject({ creative_freedom: 0.95, goal_focus: 0.25 });
    expect(presetFor({ creative_freedom: 0.7, goal_focus: 0.9 })?.id).toBe("creative_ad");
    expect(presetFor({ creative_freedom: 0.9, goal_focus: 0.9 })).toBeNull();
  });

  it("does not force the two values to trade off: CF 0.9 / GF 0.9 is a valid, distinct setting", () => {
    const ctx = buildCreativeControlContext({
      creativeFreedom: 0.9,
      goalFocus: 0.9,
      stage: "director",
      hardConstraints: ["x"],
    });
    expect(ctx.creativeLabel).toBe("Wild");
    expect(ctx.goalLabel).toBe("Goal-first");
    expect(ctx.text).toContain("highly original way to accomplish the goal");
  });

  it("scales concept candidates with creative freedom", () => {
    expect(conceptCandidateCount(0.2)).toBe(1);
    expect(conceptCandidateCount(0.49)).toBe(1);
    expect(conceptCandidateCount(0.5)).toBe(2);
    expect(conceptCandidateCount(0.8)).toBe(2);
    expect(conceptCandidateCount(0.81)).toBe(3);
  });

  it("only contributes to hashes when the manifest carries the controls", () => {
    const base = { provider_mode: "mock", approve_keyframes: false } as RunManifest["options"];
    expect(creativeHashInputs({ options: base } as RunManifest)).toEqual({});
    expect(
      creativeHashInputs({
        options: { ...base, creative_freedom: 0.3, goal_focus: 0.4 },
      } as RunManifest),
    ).toEqual({ creative: { creative_freedom: 0.3, goal_focus: 0.4 } });
  });
});

describe("creative controls: prompt context", () => {
  const brand = loadBrand("bachalogy");
  const rules = hardConstraintsFor(brand, { hardCapUsd: 2.5 });

  it("changes the Creative Director guidance between low and high creative freedom", () => {
    const low = buildCreativeControlContext({
      creativeFreedom: 0.15,
      goalFocus: 0.85,
      stage: "director",
      hardConstraints: rules,
    });
    const high = buildCreativeControlContext({
      creativeFreedom: 0.9,
      goalFocus: 0.85,
      stage: "director",
      hardConstraints: rules,
    });
    expect(low.text).toContain("Creative Freedom: 0.15 — Safe");
    expect(low.creativeGuidance).toMatch(/proven content structure/i);
    expect(high.text).toContain("Creative Freedom: 0.90 — Wild");
    expect(high.creativeGuidance).toMatch(/surprising ideas/i);
    expect(high.creativeGuidance).not.toEqual(low.creativeGuidance);
  });

  it("adds stronger goal-alignment instructions at high goal focus", () => {
    const loose = buildCreativeControlContext({
      creativeFreedom: 0.6,
      goalFocus: 0.2,
      stage: "storyboard",
      hardConstraints: rules,
    });
    const first = buildCreativeControlContext({
      creativeFreedom: 0.6,
      goalFocus: 0.95,
      stage: "storyboard",
      hardConstraints: rules,
      goal: "drive purchase intent",
    });
    expect(first.goalLabel).toBe("Goal-first");
    expect(first.goalGuidance).toMatch(/every shot must have clear narrative utility/i);
    expect(first.goalGuidance).toMatch(/beautiful but does not help the objective is cut/i);
    expect(first.text).toContain("Primary goal: drive purchase intent");
    expect(loose.goalGuidance).toMatch(/atmosphere alone/i);
  });

  it("keeps product identity, claims and budget rules locked at creative freedom 1.0", () => {
    const wild = buildCreativeControlContext({
      creativeFreedom: 1,
      goalFocus: 0.5,
      stage: "director",
      hardConstraints: rules,
    });
    expect(wild.immutableRules.some((r) => /Product identity: Wobble Bot/.test(r))).toBe(true);
    expect(wild.immutableRules.some((r) => /Forbidden claims/.test(r))).toBe(true);
    expect(wild.immutableRules.some((r) => /absolute cap for this video is \$2\.50/.test(r))).toBe(
      true,
    );
    expect(wild.text).toContain("## Locked (never loosened by creative freedom)");
    expect(wild.text).toContain("Product identity: Wobble Bot");
    expect(wild.creativeGuidance).toContain("every locked rule below still holds exactly");
  });

  it("separates creative variables from locked identity variables for image prompts", () => {
    const img = buildCreativeControlContext({
      creativeFreedom: 0.7,
      goalFocus: 0.9,
      stage: "image",
      hardConstraints: [
        ...rules,
        "Identity block: a palm-sized rounded robot toy in matte sky-blue",
      ],
    });
    const creativeAt = img.text.indexOf("## CREATIVE VARIABLES");
    const lockedAt = img.text.indexOf("## LOCKED IDENTITY VARIABLES");
    expect(creativeAt).toBeGreaterThan(0);
    expect(lockedAt).toBeGreaterThan(creativeAt);
    expect(img.text.slice(creativeAt, lockedAt)).toMatch(/composition.*lighting.*lens/s);
    expect(img.text.slice(lockedAt)).toContain("Identity block: a palm-sized rounded robot toy");
    expect(img.text.slice(lockedAt)).toContain("Product identity: Wobble Bot");
  });

  it("research guidance never loosens factual standards", () => {
    const r = buildCreativeControlContext({
      creativeFreedom: 1,
      goalFocus: 0.9,
      stage: "research",
      hardConstraints: rules,
    });
    expect(r.text).toContain("factual standards, sourcing and confidence are unchanged");
    expect(r.creativeGuidance).toBe("");
  });

  it("renders variation guidance per strength", () => {
    expect(variationGuidance("small", "keyframe")).toMatch(/^Variation: SMALL/);
    expect(variationGuidance("fresh", "shot")).toMatch(/new composition, new wording/);
    expect(variationGuidance("different", "concept")).toMatch(/substantially different/);
    const ctx = buildCreativeControlContext({
      creativeFreedom: 0.5,
      goalFocus: 0.5,
      stage: "storyboard",
      hardConstraints: [],
      variation: {
        strength: "small",
        target: "shot",
        instruction: "lower the camera",
        previous: "a close-up of the tile",
      },
    });
    expect(ctx.text).toContain("## Regeneration");
    expect(ctx.text).toContain("Instruction: lower the camera");
    expect(ctx.text).toContain("Previous version: a close-up of the tile");
  });
});
