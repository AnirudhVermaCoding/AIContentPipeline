import * as path from "node:path";
import { brandsRoot } from "../../brand/loader.js";
import type { RunManifest, StageStatus } from "../../schema/manifest.js";
import type { UiRunStatus, UiStageStatus } from "../api-types.js";
import type { JobRow } from "../jobs.js";

export const STAGE_ORDER = [
  "brief",
  "research",
  "script",
  "voice",
  "storyboard",
  "continuity",
  "route",
  "keyframes",
  "animate",
  "audio",
  "edit",
  "render",
  "final_qc",
  "report",
] as const;

export const STAGE_LABELS: Record<string, string> = {
  brief: "Creative Direction",
  research: "Research",
  script: "Script",
  voice: "Voice",
  storyboard: "Storyboard",
  continuity: "Continuity",
  route: "Asset Routing",
  keyframes: "Keyframes",
  animate: "Animation",
  audio: "Audio / Music",
  edit: "Edit Decision",
  render: "Render",
  final_qc: "Final QC",
  report: "Report",
};

export const STAGE_DIRS: Record<string, string> = {
  brief: "00_brief",
  research: "01_research",
  script: "02_script",
  voice: "03_voice",
  storyboard: "04_storyboard",
  continuity: "05_continuity",
  route: "06_route",
  keyframes: "07_keyframes",
  animate: "08_animate",
  audio: "09_audio",
  edit: "10_edit",
  render: "11_render",
  final_qc: "12_final_qc",
  report: "13_report",
};

const PLANNING = new Set([
  "brief",
  "research",
  "script",
  "voice",
  "storyboard",
  "continuity",
  "route",
]);
const PRODUCTION = new Set(["keyframes", "animate"]);

export function runFileUrl(brandId: string, runId: string, rel: string): string {
  const clean = rel.split(path.sep).join("/").replace(/^\/+/, "");
  return `/files/runs/${encodeURIComponent(brandId)}/${encodeURIComponent(runId)}/${clean
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/** URL for a file inside brands/<brand>/ (logos, product references); null when outside. */
export function brandFileUrl(brandId: string, absPath: string): string | null {
  const dir = path.join(brandsRoot(), brandId);
  const rel = path.relative(dir, absPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return `/files/brands/${encodeURIComponent(brandId)}/${rel
    .split(path.sep)
    .map(encodeURIComponent)
    .join("/")}`;
}

export function uiStageStatus(status: StageStatus | null | undefined): UiStageStatus {
  switch (status) {
    case "running":
      return "running";
    case "done":
      return "complete";
    case "failed":
    case "budget_conflict":
      return "failed";
    case "waiting_approval":
      return "awaiting_approval";
    case "skipped":
      return "skipped";
    default:
      return "waiting";
  }
}

export function stagePhase(stageId: string | null): "planning" | "producing" | "rendering" {
  if (!stageId || PLANNING.has(stageId)) return "planning";
  if (PRODUCTION.has(stageId)) return "producing";
  return "rendering";
}

export function lastActiveStage(m: RunManifest): string | null {
  let last: string | null = null;
  for (const id of STAGE_ORDER) {
    const st = m.stages[id];
    if (!st) continue;
    if (st.status === "running") return id;
    if (st.status !== "pending") last = id;
  }
  return last;
}

export const UI_RUN_STATUS_LABELS: Record<UiRunStatus, string> = {
  planning: "Planning",
  awaiting_storyboard_approval: "Awaiting storyboard approval",
  awaiting_keyframe_approval: "Awaiting keyframe approval",
  producing: "Generating",
  rendering: "Rendering",
  complete: "Complete",
  failed: "Failed",
  budget_conflict: "Budget conflict",
  paused: "Paused",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  stopped: "Stopped",
};

export function uiRunStatus(
  m: RunManifest,
  job: JobRow | null,
): { status: UiRunStatus; label: string; current_stage: string | null } {
  const jobLive = !!job && ["queued", "running", "pausing", "cancelling"].includes(job.status);
  const current = job?.current_stage ?? lastActiveStage(m);
  let status: UiRunStatus;
  switch (m.status) {
    case "done":
      status = "complete";
      break;
    case "failed":
      status = "failed";
      break;
    case "budget_conflict":
      status = "budget_conflict";
      break;
    case "waiting_approval":
      status = "awaiting_keyframe_approval";
      break;
    case "stopped":
      status =
        m.stop_reason === "paused"
          ? "paused"
          : m.stop_reason === "cancelled"
            ? "cancelled"
            : m.stop_reason === "dry_run"
              ? "awaiting_storyboard_approval"
              : m.stop_reason === "until"
                ? "stopped"
                : m.last_error
                  ? "interrupted"
                  : "stopped";
      break;
    default:
      status = jobLive ? stagePhase(current) : "interrupted";
  }
  if (jobLive && (status === "paused" || status === "cancelled" || status === "interrupted")) {
    status = stagePhase(current);
  }
  let label = UI_RUN_STATUS_LABELS[status];
  if (jobLive && job?.status === "pausing") label = "Pausing after current operation";
  if (jobLive && job?.status === "cancelling") label = "Cancelling after current operation";
  return { status, label, current_stage: current };
}

export function stageProgress(m: RunManifest): { done: number; total: number } {
  let done = 0;
  for (const id of STAGE_ORDER) if (m.stages[id]?.status === "done") done += 1;
  return { done, total: STAGE_ORDER.length };
}

export function parseVersionLabel(label: string | null): { shot: string; version: number } | null {
  if (!label) return null;
  const m = /^(?:keyframe|video):(shot_\d+):v(\d+)$/.exec(label);
  return m?.[1] && m[2] ? { shot: m[1], version: Number(m[2]) } : null;
}
