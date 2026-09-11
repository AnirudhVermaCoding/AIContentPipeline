import { promptVersions } from "../../agents/prompts.js";
import { runResearcher } from "../../agents/researcher.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { EMPTY_RESEARCH } from "../../schema/research.js";
import type { StageDef } from "../stage.js";

export const researchStage: StageDef = {
  id: "research",
  version: "1",
  dir: "01_research",
  dependsOn: ["brief"],
  extraInputs: () => ({ prompts: promptVersions(["researcher"]) }),
  async run(ctx) {
    const brief = ctx.input("brief", CreativeBriefSchema);
    if (brief.research_depth === "none") {
      ctx.writeOutput(EMPTY_RESEARCH);
      ctx.run.events.info(this.id, "skipped by the brief (depth none)");
      return { status: "done" };
    }
    const result = await runResearcher(ctx.run, this.id, brief);
    ctx.writeOutput({ ...result.data, depth: brief.research_depth });
    ctx.run.events.info(
      this.id,
      `${result.data.facts.length} facts, ${result.data.sensory_details.length} sensory details`,
    );
    return { status: "done" };
  },
};
