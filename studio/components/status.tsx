"use client";

import type { JobView, RunSummary, UiRunStatus, UiStageStatus } from "@pipeline/studio/api-types";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/misc";

export function runStatusVariant(
  status: UiRunStatus,
): "ok" | "warn" | "danger" | "info" | "running" | "muted" {
  switch (status) {
    case "complete":
      return "ok";
    case "failed":
    case "budget_conflict":
      return "danger";
    case "awaiting_storyboard_approval":
    case "awaiting_keyframe_approval":
      return "warn";
    case "planning":
    case "producing":
    case "rendering":
      return "running";
    case "interrupted":
      return "danger";
    default:
      return "muted";
  }
}

export function RunStatusBadge({ run }: { run: RunSummary }) {
  const variant = runStatusVariant(run.ui_status);
  const live = run.job?.alive && ["planning", "producing", "rendering"].includes(run.ui_status);
  return (
    <Badge variant={variant}>
      {live ? <StatusDot tone="running" pulse /> : null}
      {run.ui_status_label}
    </Badge>
  );
}

export function stageTone(
  s: UiStageStatus,
): "ok" | "warn" | "danger" | "info" | "running" | "muted" {
  switch (s) {
    case "complete":
      return "ok";
    case "running":
      return "running";
    case "failed":
      return "danger";
    case "awaiting_approval":
      return "warn";
    case "skipped":
      return "info";
    default:
      return "muted";
  }
}

export const STAGE_STATUS_LABEL: Record<UiStageStatus, string> = {
  waiting: "Waiting",
  running: "Running",
  complete: "Complete",
  failed: "Failed",
  skipped: "Skipped",
  awaiting_approval: "Awaiting approval",
};

export function StageStatusBadge({ status }: { status: UiStageStatus }) {
  return (
    <Badge variant={stageTone(status)}>
      {status === "running" ? <StatusDot tone="running" pulse /> : null}
      {STAGE_STATUS_LABEL[status]}
    </Badge>
  );
}

export function JobStateNote({ job }: { job: JobView | null }) {
  if (!job) return null;
  if (job.cancel_state === "waiting_for_in_flight_call") {
    const call = job.in_flight[0];
    return (
      <div className="rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-xs text-warn">
        {job.pause_requested_at && !job.cancel_requested_at ? "Pause" : "Cancellation"} requested. A
        provider call is already in progress and cannot be interrupted
        {call
          ? ` (${call.provider} ${call.model}${call.shot_id ? `, ${call.shot_id}` : ""}, estimated ${call.est_cost_usd.toFixed(3)} USD)`
          : ""}
        ; it will be charged and the run stops right after it.
      </div>
    );
  }
  if (job.cancel_state === "requested") {
    return (
      <div className="rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-xs text-warn">
        {job.cancel_requested_at ? "Cancellation" : "Pause"} requested — stopping before the next
        paid operation.
      </div>
    );
  }
  if (job.status === "orphaned") {
    return (
      <div className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
        The job process died ({job.error ?? "unknown reason"}). Any call that was in flight is kept
        at its estimated cost and marked as unknown. Resume to continue from the last completed
        step.
      </div>
    );
  }
  return null;
}
