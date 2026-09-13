import { promptVersions } from "../../agents/prompts.js";
import { runScreenwriter } from "../../agents/screenwriter.js";
import { creativeHashInputs } from "../../creative/controls.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { ResearchNotesSchema } from "../../schema/research.js";
import type { StageDef } from "../stage.js";

export const scriptStage: StageDef = {
  id: "script",
  version: "1",
  dir: "02_script",
  dependsOn: ["brief", "research"],
  extraInputs: (run) => ({
    prompts: promptVersions(["screenwriter"]),
    ...creativeHashInputs(run.manifest),
  }),
  async run(ctx) {
    const brief = ctx.input("brief", CreativeBriefSchema);
    const research = ctx.input("research", ResearchNotesSchema);
    const result = await runScreenwriter(ctx.run, this.id, brief, research);
    ctx.writeOutput(result.data);
    ctx.run.events.info(
      this.id,
      result.data.music_only
        ? "music-only script"
        : `${result.data.narration.length} lines, ${result.data.total_words} words, ~${result.data.est_duration_s}s`,
    );
    return { status: "done" };
  },
};
