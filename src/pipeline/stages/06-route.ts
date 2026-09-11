import { routeShots } from "../../router/route.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import { OUTPUT } from "../../schema/common.js";
import { StoryboardArtifactSchema } from "../../schema/storyboard.js";
import type { StageDef } from "../stage.js";

export const routeStage: StageDef = {
  id: "route",
  version: "1",
  dir: "06_route",
  dependsOn: ["brief", "storyboard"],
  extraInputs: (run) => ({
    cap: run.manifest.cost.hard_cap_usd,
    target: run.manifest.cost.ai_video_seconds_target,
    clip: run.brand.profile.budget.clip_seconds,
  }),
  async run(ctx) {
    const { run } = ctx;
    const brief = ctx.input("brief", CreativeBriefSchema);
    const storyboard = ctx.input("storyboard", StoryboardArtifactSchema);
    const decision = routeShots({
      brief,
      shots: storyboard.shots,
      providers: run.providers,
      aiVideoSecondsTarget: run.manifest.cost.ai_video_seconds_target,
      hardCapUsd: run.manifest.cost.hard_cap_usd,
      spentUsd: run.budget.spentUsd,
      clipSeconds: run.brand.profile.budget.clip_seconds,
      outputSize: { width: OUTPUT.width, height: OUTPUT.height },
    });
    ctx.writeOutput(decision.plan);
    run.manifest.cost.estimated_usd = decision.plan.totals.est_total_usd;
    run.save();
    for (const d of decision.decisions) {
      run.events.decision({
        stage: this.id,
        category: "routing",
        subject: d.subject,
        options_considered: d.options,
        reason: d.reason,
      });
    }
    for (const r of decision.plan.shots) {
      run.events.decision({
        stage: this.id,
        category: "routing",
        subject: r.shot_id,
        options_considered: ["GEN_VIDEO", "STILL_MOTION", "STILL"],
        reason: `${r.source}${r.video_seconds ? ` ${r.video_seconds}s` : ""}: ${r.reason}`,
        shot: r.shot_id,
      });
    }
    const t = decision.plan.totals;
    run.events.info(
      this.id,
      `${t.ai_video_seconds}s of generated video, est. total $${t.est_total_usd.toFixed(2)} (cap $${run.manifest.cost.hard_cap_usd.toFixed(2)}); promise ${decision.plan.promise_check.satisfied ? "met" : "NOT met"}`,
    );
    if (decision.conflict) {
      return {
        status: "budget_conflict",
        message: decision.conflict.message,
        alternatives: decision.conflict.alternatives,
      };
    }
    return { status: "done" };
  },
};
