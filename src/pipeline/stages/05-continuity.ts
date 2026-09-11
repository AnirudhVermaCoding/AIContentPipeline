import * as fs from "node:fs";
import * as path from "node:path";
import { runContinuityController } from "../../agents/continuity-controller.js";
import { promptVersions } from "../../agents/prompts.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import type { ContinuityBible } from "../../schema/continuity.js";
import { StoryboardArtifactSchema } from "../../schema/storyboard.js";
import type { StageDef } from "../stage.js";

export const continuityStage: StageDef = {
  id: "continuity",
  version: "1",
  dir: "05_continuity",
  dependsOn: ["brief", "storyboard"],
  extraInputs: (run) => ({
    prompts: promptVersions(["continuity-controller"]),
    entities: run.brand.profile.entities.map((e) => e.id),
  }),
  async run(ctx) {
    const { run } = ctx;
    const brief = ctx.input("brief", CreativeBriefSchema);
    const storyboard = ctx.input("storyboard", StoryboardArtifactSchema);

    // Reference images available per entity (brand assets), copied into the run so artifacts stay portable.
    const refsDir = path.join(ctx.stageDir, "refs");
    fs.mkdirSync(refsDir, { recursive: true });
    const available: Record<string, string[]> = {};
    const absToRel = new Map<string, string>();
    for (const ent of run.brand.profile.entities) {
      available[ent.id] = [];
      ent.reference_images.forEach((abs, i) => {
        const target = path.join(refsDir, `${ent.id}_${i + 1}${path.extname(abs) || ".png"}`);
        if (!fs.existsSync(target)) fs.copyFileSync(abs, target);
        const rel = run.rel(target);
        available[ent.id]?.push(rel);
        absToRel.set(abs, rel);
      });
    }

    const result = await runContinuityController(run, this.id, brief, storyboard, available);
    const bible: ContinuityBible = result.data;
    ctx.writeOutput(bible);
    run.events.info(
      this.id,
      `${bible.entities.length} entities locked, ${bible.per_shot.filter((p) => p.reference_images.length).length} shots with references`,
    );
    return { status: "done" };
  },
};
