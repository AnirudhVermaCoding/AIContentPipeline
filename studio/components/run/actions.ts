"use client";

import type {
  CreativeSettingsView,
  EditImpact,
  JobView,
  RegenerationEstimate,
  RunSummary,
  StoryboardEditRequest,
} from "@pipeline/studio/api-types";
import { useCallback, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

export type Variation = CreativeSettingsView["variation_options"][number]["id"];

export interface KeyframeDecisionInput {
  shotId: string;
  decision: "approve" | "reject";
  note?: string | null;
  instruction?: string | null;
  prompt?: string | null;
  /** How far the regenerated version may move from the current one. */
  variation?: Variation | null;
}

export interface PlanningRegenerationInput {
  variation?: Variation;
  instruction?: string | null;
}

export interface ActionResult {
  run?: RunSummary;
  job?: JobView | null;
  [k: string]: unknown;
}

/** Every button that can spend money or change a run goes through here; errors surface inline. */
export function useRunActions(runId: string, onDone?: () => void | Promise<void>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const call = useCallback(
    async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      setBusy(label);
      setError(null);
      try {
        const r = await fn();
        await onDone?.();
        return r;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [onDone],
  );
  const base = `/api/runs/${runId}`;
  return {
    busy,
    error,
    clearError: () => setError(null),
    approveStoryboard: () =>
      call("approve-storyboard", () =>
        apiPost<ActionResult>(`${base}/actions/approve-storyboard`, {}),
      ),
    regenerateStoryboard: (req: PlanningRegenerationInput = {}) =>
      call("regenerate-storyboard", () =>
        apiPost<ActionResult>(`${base}/actions/regenerate-storyboard`, req),
      ),
    regenerateConcept: (req: PlanningRegenerationInput = {}) =>
      call("regenerate-concept", () =>
        apiPost<ActionResult>(`${base}/actions/regenerate-concept`, req),
      ),
    regenerateShot: (shotId: string, req: PlanningRegenerationInput = {}) =>
      call("regenerate-shot", () =>
        apiPost<ActionResult>(`${base}/actions/storyboard/regenerate-shot`, {
          shot_id: shotId,
          ...req,
        }),
      ),
    previewEdit: (req: StoryboardEditRequest) =>
      apiPost<EditImpact>(`${base}/storyboard/preview`, req),
    applyEdit: (req: StoryboardEditRequest) =>
      call("edit-storyboard", () =>
        apiPost<ActionResult & { impact: EditImpact }>(`${base}/storyboard/edit`, req),
      ),
    keyframes: (decisions: KeyframeDecisionInput[], approveRemaining = false, resume = true) =>
      call("keyframes", () =>
        apiPost<ActionResult>(`${base}/actions/keyframes`, {
          decisions,
          approve_remaining: approveRemaining,
          resume,
        }),
      ),
    selectKeyframeVersion: (shotId: string, attempt: number, resume = false) =>
      call("select-keyframe", () =>
        apiPost<ActionResult>(`${base}/actions/keyframes/select-version`, {
          shot_id: shotId,
          attempt,
          resume,
        }),
      ),
    regenerateClip: (
      shotId: string,
      instruction: string | null,
      variation: Variation | null = null,
    ) =>
      call("regenerate-clip", () =>
        apiPost<ActionResult>(`${base}/actions/clips/regenerate`, {
          shot_id: shotId,
          instruction,
          variation,
        }),
      ),
    selectClipVersion: (shotId: string, attempt: number) =>
      call("select-clip", () =>
        apiPost<ActionResult>(`${base}/actions/clips/select-version`, { shot_id: shotId, attempt }),
      ),
    replaceWithStill: (shotId: string) =>
      call("use-still", () =>
        apiPost<ActionResult>(`${base}/actions/clips/use-still`, { shot_id: shotId }),
      ),
    resume: (opts: { budget_override_usd?: number | null; adopt_brand?: boolean } = {}) =>
      call("resume", () => apiPost<ActionResult>(`${base}/actions/resume`, opts)),
    rerun: (fromStage: string) =>
      call("rerun", () =>
        apiPost<ActionResult>(`${base}/actions/rerun`, { from_stage: fromStage }),
      ),
    pause: () => call("pause", () => apiPost<ActionResult>(`${base}/actions/pause`, {})),
    cancel: () => call("cancel", () => apiPost<ActionResult>(`${base}/actions/cancel`, {})),
    abort: () => call("abort", () => apiPost<ActionResult>(`${base}/actions/abort`, {})),
    duplicate: () =>
      call("duplicate", () => apiPost<ActionResult>(`${base}/actions/duplicate`, {})),
    openFolder: () =>
      call("open-folder", () =>
        apiPost<{ ok: boolean; path: string }>(`${base}/actions/open-folder`, {}),
      ),
    estimate: (kind: RegenerationEstimate["kind"], shotId?: string | null) =>
      apiGet<RegenerationEstimate>(
        `${base}/estimate?kind=${kind}${shotId ? `&shot=${encodeURIComponent(shotId)}` : ""}`,
      ),
  };
}

export type RunActions = ReturnType<typeof useRunActions>;
