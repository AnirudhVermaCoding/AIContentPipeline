import { imageCost } from "../../config/pricing.js";
import type { ImageGenerateOptions, ImageProvider, ImageResult } from "../types.js";

/** Offline image generator: a flat brand-coloured card with the first words of the prompt. */
export class MockImage implements ImageProvider {
  readonly id: string;
  readonly model: string;
  readonly editModel: string;
  readonly supportsReferences = true;

  constructor(opts: { provider: string; model: string; editModel?: string; color?: string }) {
    this.id = opts.provider;
    this.model = opts.model;
    this.editModel = opts.editModel ?? `${opts.model}/edit`;
    this.color = opts.color ?? "#3a3f4b";
  }
  private readonly color: string;

  estimate(width: number, height: number, referenceCount: number): number {
    const model = referenceCount > 0 ? this.editModel : this.model;
    return imageCost(this.id, model, width, height, referenceCount);
  }

  async generate(opts: ImageGenerateOptions): Promise<ImageResult> {
    const sharp = (await import("sharp")).default;
    const started = Date.now();
    const words = opts.prompt.replace(/\s+/g, " ").split(" ").slice(0, 12);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      if ((line + w).length > 22) {
        lines.push(line.trim());
        line = "";
      }
      line += `${w} `;
    }
    if (line.trim()) lines.push(line.trim());
    const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000);
    const hue = seed % 360;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${this.color}"/><stop offset="1" stop-color="hsl(${hue},35%,25%)"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="${opts.width * 0.5}" cy="${opts.height * 0.42}" r="${opts.width * 0.18}" fill="hsl(${hue},60%,60%)" opacity="0.8"/>
      ${lines.map((l, i) => `<text x="50%" y="${opts.height * 0.68 + i * 40}" font-family="sans-serif" font-size="30" fill="#ffffff" text-anchor="middle">${esc(l)}</text>`).join("")}
      <text x="50%" y="${opts.height - 40}" font-family="sans-serif" font-size="20" fill="#ffffffaa" text-anchor="middle">mock keyframe${opts.referenceImages?.length ? ` · ${opts.referenceImages.length} refs` : ""}</text>
    </svg>`;
    const image = await sharp(Buffer.from(svg)).png().toBuffer();
    return {
      image,
      seed,
      width: opts.width,
      height: opts.height,
      provider: this.id,
      model: opts.referenceImages?.length ? this.editModel : this.model,
      latencyMs: Date.now() - started,
      costUsd: this.estimate(opts.width, opts.height, opts.referenceImages?.length ?? 0),
    };
  }
}
