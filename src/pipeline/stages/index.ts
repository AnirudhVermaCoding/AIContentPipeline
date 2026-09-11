import type { StageDef } from "../stage.js";
import { briefStage } from "./00-brief.js";
import { researchStage } from "./01-research.js";
import { scriptStage } from "./02-script.js";
import { voiceStage } from "./03-voice.js";
import { storyboardStage } from "./04-storyboard.js";
import { continuityStage } from "./05-continuity.js";
import { routeStage } from "./06-route.js";

/** Ordered pipeline. Later commits append keyframes, animate, audio, edit, render, final_qc, report. */
export const PLANNING_STAGES: StageDef[] = [
  briefStage,
  researchStage,
  scriptStage,
  voiceStage,
  storyboardStage,
  continuityStage,
  routeStage,
];

export const ALL_STAGES: StageDef[] = [...PLANNING_STAGES];

export function stageById(id: string): StageDef | undefined {
  return ALL_STAGES.find((s) => s.id === id);
}
