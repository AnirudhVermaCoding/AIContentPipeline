import { runCreativeDirector } from "../../agents/creative-director.js";
import { promptVersions } from "../../agents/prompts.js";
import type { StageDef } from "../stage.js";

export const briefStage: StageDef = {
  id: "brief",
  version: "1",
  dir: "00_brief",
  dependsOn: [],
  extraInputs: (run) => ({
    topic: run.manifest.topic,
    goal: run.manifest.goal,
    prompts: promptVersions(["creative-director"]),
  }),
  async run(ctx) {
    const { run } = ctx;
    const result = await runCreativeDirector(run, this.id, run.manifest.topic, run.manifest.goal);
    const brief = result.data;
    ctx.writeOutput(brief);
    run.events.decision({
      stage: this.id,
      category: "creative",
      subject: "research_depth",
      options_considered: ["none", "light", "deep"],
      reason: `${brief.research_depth}: ${brief.research_questions.length} question(s)`,
    });
    run.events.decision({
      stage: this.id,
      category: "creative",
      subject: "motion_promise",
      options_considered: ["motion_led", "mixed", "still_led"],
      reason: `${brief.motion_promise.kind}, min ${brief.motion_promise.min_ai_video_s} s: ${brief.motion_promise.reason}`,
    });
    run.events.decision({
      stage: this.id,
      category: "creative",
      subject: "text_and_edit",
      options_considered: ["none", "hook_only", "captions"],
      reason: `text ${brief.text_overlay_intent}, edit ${brief.edit_mode_intent}, cta ${brief.cta_decision.use ? "yes" : "no"}`,
    });
    run.events.info(this.id, `"${brief.hook.line}" — ${brief.concept.slice(0, 120)}`);
    return { status: "done" };
  },
};
