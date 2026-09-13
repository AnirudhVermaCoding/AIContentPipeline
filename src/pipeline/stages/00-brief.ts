import * as fs from "node:fs";
import * as path from "node:path";
import { runCreativeDirector } from "../../agents/creative-director.js";
import { promptVersions } from "../../agents/prompts.js";
import { controlsForRun, creativeHashInputs } from "../../creative/controls.js";
import { CreativeBriefSchema } from "../../schema/brief.js";
import type { RegenerationRecord } from "../../schema/creative.js";
import { ensureDir, exists, nowIso, readJson, writeJsonAtomic } from "../../util/fs.js";
import type { StageDef } from "../stage.js";

export const DIRECTOR_RECORD_FILE = "director.json";

/** Provenance of the Creative Director's decision: controls, candidates, ranking, regeneration. */
export interface DirectorRecord {
  attempt: number;
  at: string;
  controls: {
    creative_freedom: number;
    goal_focus: number;
    creative_label: string;
    goal_label: string;
  };
  candidate_count: number;
  candidates: Array<{
    title: string;
    concept: string;
    hook: string;
    why: string;
    scores: Record<string, number>;
  }>;
  selected_index: number;
  ranking: Array<{ index: number; title: string; score: number }>;
  regeneration: RegenerationRecord | null;
  previous_concept: string | null;
}

export const briefStage: StageDef = {
  id: "brief",
  version: "1",
  dir: "00_brief",
  dependsOn: [],
  extraInputs: (run) => ({
    topic: run.manifest.topic,
    goal: run.manifest.goal,
    prompts: promptVersions(["creative-director"]),
    ...creativeHashInputs(run.manifest),
  }),
  async run(ctx) {
    const { run } = ctx;
    const pending = run.manifest.pending_regeneration;
    const regen = pending?.target === "concept" ? pending : null;
    const previousConcept =
      regen && run.hasOutput(this.dir)
        ? run.readOutput(this.dir, CreativeBriefSchema).concept
        : null;
    const result = await runCreativeDirector(run, this.id, run.manifest.topic, run.manifest.goal, {
      variation: regen
        ? { strength: regen.variation, instruction: regen.instruction, previous: previousConcept }
        : null,
    });
    if (regen) {
      // Consumed: a later resume must not replay the same request.
      run.manifest.pending_regeneration = null;
      run.save();
    }
    const brief = result.data;
    ctx.writeOutput(brief);

    // Provenance sidecar; earlier versions are kept so a concept regeneration never erases them.
    const controls = controlsForRun(run);
    const attempt = run.manifest.stages[this.id]?.attempt ?? 1;
    const file = ctx.file(DIRECTOR_RECORD_FILE);
    if (exists(file)) {
      const old = readJson<DirectorRecord>(file);
      const histDir = ensureDir(path.join(ctx.stageDir, "history"));
      fs.copyFileSync(file, path.join(histDir, `director_${old.attempt ?? 0}.json`));
    }
    const record: DirectorRecord = {
      attempt,
      at: nowIso(),
      controls: {
        creative_freedom: controls.creative_freedom,
        goal_focus: controls.goal_focus,
        creative_label: controls.creative_label,
        goal_label: controls.goal_label,
      },
      candidate_count: result.candidateCount,
      candidates: result.candidates,
      selected_index: result.selectedIndex,
      ranking: result.ranking,
      regeneration: regen
        ? {
            target: "concept",
            shot_id: null,
            variation: regen.variation,
            instruction: regen.instruction,
            at: nowIso(),
          }
        : null,
      previous_concept: previousConcept,
    };
    writeJsonAtomic(file, record);

    if (result.candidates.length > 1) {
      const chosen = result.candidates[result.selectedIndex];
      run.events.decision({
        stage: this.id,
        category: "creative",
        subject: "concept_candidates",
        options_considered: result.candidates.map((c) => c.title),
        reason: `${result.candidateCount} candidate(s) at creative freedom ${controls.creative_freedom.toFixed(2)} (${controls.creative_label}); the director chose "${chosen?.title ?? "?"}"; goal-weighted ranking: ${result.ranking.map((r) => `${r.title} ${r.score}`).join(", ")}`,
      });
    }
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
