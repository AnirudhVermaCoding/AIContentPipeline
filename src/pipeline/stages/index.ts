import type { StageDef } from "../stage.js";
import { briefStage } from "./00-brief.js";
import { researchStage } from "./01-research.js";
import { scriptStage } from "./02-script.js";
import { voiceStage } from "./03-voice.js";
import { storyboardStage } from "./04-storyboard.js";
import { continuityStage } from "./05-continuity.js";
import { routeStage } from "./06-route.js";
import { keyframesStage } from "./07-keyframes.js";
import { animateStage } from "./08-animate.js";
import { audioStage } from "./09-audio.js";
import { editStage } from "./10-edit.js";
import { renderStage } from "./11-render.js";
import { finalQcStage } from "./12-final-qc.js";
import { reportStage } from "./13-report.js";

export const PLANNING_STAGES: StageDef[] = [
  briefStage,
  researchStage,
  scriptStage,
  voiceStage,
  storyboardStage,
  continuityStage,
  routeStage,
];

export const PRODUCTION_STAGES: StageDef[] = [keyframesStage, animateStage];

export const POST_STAGES: StageDef[] = [
  audioStage,
  editStage,
  renderStage,
  finalQcStage,
  reportStage,
];

/** The complete ordered pipeline. */
export const ALL_STAGES: StageDef[] = [...PLANNING_STAGES, ...PRODUCTION_STAGES, ...POST_STAGES];

export function stageById(id: string): StageDef | undefined {
  return ALL_STAGES.find((s) => s.id === id);
}
