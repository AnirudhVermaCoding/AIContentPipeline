import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_PROVIDERS } from "../config/settings.js";
import { probeImage, probeMedia } from "../media/probe.js";
import { buildProviders, checkProviders } from "./registry.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicp-providers-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("provider registry (mock mode)", () => {
  const providers = buildProviders(DEFAULT_PROVIDERS, {
    mode: "mock",
    fixtureResolvers: [(label) => (label === "hello" ? { greeting: "hi", n: 2 } : undefined)],
  });

  it("answers LLM calls from fixtures with priced usage", async () => {
    const r = await providers.llmCreative.generate({
      instructions: "x",
      prompt: "y",
      schema: z.object({ greeting: z.string(), n: z.number() }),
      label: "hello",
    });
    expect(r.data.greeting).toBe("hi");
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.model).toBe("gpt-5.6-terra");
  });

  it("rejects a fixture that fails the schema", async () => {
    await expect(
      providers.llmFast.generate({
        instructions: "x",
        prompt: "y",
        schema: z.object({ greeting: z.number() }),
        label: "hello",
      }),
    ).rejects.toThrow(/fails the schema/);
  });

  it("generates a 720x1280 keyframe and a 5 s clip from it", async () => {
    const img = await providers.image.generate({
      prompt: "a quiet kitchen at night",
      width: 720,
      height: 1280,
      seed: 7,
    });
    const png = path.join(tmp, "kf.png");
    fs.writeFileSync(png, img.image);
    expect(await probeImage(png)).toEqual({ width: 720, height: 1280 });
    expect(img.costUsd).toBeCloseTo(0.03, 5);

    const vid = await providers.video.generate({
      imagePath: png,
      prompt: "slow push in",
      durationSeconds: 5,
    });
    const meta = await probeMedia(vid.filePath);
    expect(meta.duration_s).toBeGreaterThan(4.5);
    expect(meta.width).toBe(432);
    expect(meta.height).toBe(768);
    expect(meta.has_audio).toBe(false);
    expect(vid.costUsd).toBeCloseTo(0.4, 5);
    fs.unlinkSync(vid.filePath);
  }, 120_000);

  it("synthesizes a tone whose length follows the text", async () => {
    const r = await providers.tts.synthesize({ text: "a".repeat(45), voiceId: "v" });
    const wav = path.join(tmp, "line.wav");
    fs.writeFileSync(wav, r.audio);
    const meta = await probeMedia(wav);
    expect(meta.duration_s).toBeGreaterThan(2.8);
    expect(meta.duration_s).toBeLessThan(3.3);
    expect(r.costUsd).toBeCloseTo(45 * 50e-6, 8);
  });

  it("reports missing keys for live providers", () => {
    const saved = { ...process.env };
    process.env.OPENAI_API_KEY = "";
    process.env.FAL_KEY = "";
    process.env.CARTESIA_API_KEY = "";
    const check = checkProviders(DEFAULT_PROVIDERS);
    expect(check.ok).toBe(false);
    expect(check.missing.map((m) => m.envKey)).toContain("FAL_KEY");
    expect(check.unpriced).toEqual([]);
    process.env = saved;
  });
});
