"use client";

import type { RunDetail, ShotView, VersionView } from "@pipeline/studio/api-types";
import { Check, Expand, History, Pencil, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { CostSourceBadge, Money } from "@/components/money";
import type { RunActions } from "@/components/run/actions";
import { ConfirmSpendDialog } from "@/components/run/confirm-spend";
import { type Variation, VariationPicker } from "@/components/run/variation-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { ErrorBanner, SectionTitle } from "@/components/ui/misc";
import { fileUrl } from "@/lib/api";
import { cn, formatDate, titleCase } from "@/lib/utils";

function VersionStrip({
  shot,
  onSelect,
  busy,
}: {
  shot: ShotView;
  onSelect: (attempt: number) => void;
  busy: boolean;
}) {
  const versions = [...shot.versions.keyframes].sort((a, b) => a.attempt - b.attempt);
  if (versions.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <History className="h-3 w-3 text-fg-subtle" />
      {versions.map((v) => (
        <button
          key={v.attempt}
          type="button"
          disabled={busy || v.selected || !v.url || v.status === "failed"}
          onClick={() => onSelect(v.attempt)}
          className={cn(
            "rounded border px-1.5 py-0.5",
            v.selected
              ? "border-accent bg-accent text-accent-fg"
              : v.status === "failed"
                ? "border-border text-fg-subtle line-through"
                : "border-border hover:bg-surface-2",
          )}
          title={`v${v.attempt} · ${v.status}${v.error ? ` · ${v.error}` : ""} · ${v.model}`}
        >
          v{v.attempt}
          {v.selected
            ? shot.approval === "approved"
              ? " approved"
              : shot.approval === "rejected"
                ? " rejected"
                : ""
            : v.status === "rejected"
              ? " rejected"
              : ""}
        </button>
      ))}
    </div>
  );
}

function PromptDetails({ v }: { v: VersionView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        type="button"
        className="text-fg-muted underline-offset-2 hover:underline"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide prompt" : "Show prompt"}
      </button>
      {open ? (
        <div className="mt-1 space-y-1 rounded-md bg-surface-2 p-2">
          <p className="whitespace-pre-wrap text-fg">{v.prompt}</p>
          {typeof v.params.negative_prompt === "string" && v.params.negative_prompt ? (
            <p className="text-fg-muted">Negative: {v.params.negative_prompt}</p>
          ) : null}
          <p className="text-fg-subtle">
            {v.provider} {v.model} · prompt v{v.prompt_version} · seed{" "}
            {String(v.params.seed ?? "auto")} · {v.latency_ms} ms
            {v.request_id ? ` · request ${v.request_id}` : ""}
          </p>
          {v.checks.length ? (
            <p className="text-fg-subtle">
              Checks: {v.checks.map((c) => `${c.id} ${c.status}`).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function KeyframeGrid({
  detail,
  actions,
  onChanged,
}: {
  detail: RunDetail;
  actions: RunActions;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [regen, setRegen] = useState<{ shot: ShotView; prompt?: string } | null>(null);
  const [editPrompt, setEditPrompt] = useState<ShotView | null>(null);
  const [bulkRegen, setBulkRegen] = useState(false);
  const [full, setFull] = useState<ShotView | null>(null);
  const [promptText, setPromptText] = useState("");
  const [variation, setVariation] = useState<Variation>("fresh");
  const [bulkVariation, setBulkVariation] = useState<Variation>("fresh");
  const shots = detail.shots.filter((s) => s.record?.keyframe || s.versions.keyframes.length);
  const gate = detail.manifest.options.approve_keyframes;
  const pending = detail.approvals.keyframes_pending;
  const liveJob = detail.run.job?.alive;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  if (!shots.length)
    return (
      <p className="text-sm text-fg-muted">
        No keyframes yet. They are generated after the storyboard is approved.
      </p>
    );
  return (
    <div className="space-y-4">
      <SectionTitle
        title="Keyframes"
        description={
          gate
            ? `${detail.approvals.keyframes_approved} approved · ${pending} pending · ${detail.approvals.keyframes_rejected} to regenerate. Animation starts only when every keyframe is approved.`
            : "Approval gate is off for this run; keyframes were accepted automatically."
        }
        right={
          <div className="flex flex-wrap gap-2">
            {selected.size ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setBulkVariation("fresh");
                  setBulkRegen(true);
                }}
                disabled={!!liveJob}
              >
                <RefreshCw /> Regenerate selected ({selected.size})
              </Button>
            ) : null}
            {pending > 0 ? (
              <Button
                size="sm"
                onClick={() => actions.keyframes([], true, true)}
                disabled={actions.busy !== null || !!liveJob}
              >
                <Check /> Approve all pending & continue
              </Button>
            ) : null}
          </div>
        }
      />
      <ErrorBanner message={actions.error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {shots.map((shot) => {
          const current =
            shot.versions.keyframes.find((v) => v.selected) ?? shot.versions.keyframes[0];
          const src = fileUrl(shot.keyframe_url ?? current?.url ?? null);
          const isSel = selected.has(shot.shot_id);
          const approvalTone =
            shot.approval === "approved"
              ? "ok"
              : shot.approval === "rejected"
                ? "danger"
                : shot.approval === "pending"
                  ? "warn"
                  : "muted";
          const generating =
            shot.progress?.status === "queued" || shot.progress?.status === "in_progress";
          return (
            <div
              key={shot.shot_id}
              className={cn("card overflow-hidden", isSel && "ring-2 ring-accent")}
            >
              <button
                type="button"
                className="relative block w-full bg-neutral-900"
                onClick={() => setFull(shot)}
              >
                {src ? (
                  <img src={src} alt={shot.shot_id} className="aspect-[9/16] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[9/16] items-center justify-center text-xs text-fg-subtle">
                    {generating ? "Generating…" : "No image"}
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white">
                  {shot.shot_id.replace("shot_", "Shot ")}
                </span>
                {current ? (
                  <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
                    v{current.attempt}
                  </span>
                ) : null}
                <span className="absolute bottom-2 right-2 rounded bg-black/60 p-1 text-white">
                  <Expand className="h-3 w-3" />
                </span>
              </button>
              <div className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={approvalTone}>
                    {shot.approval === "none" ? "auto-accepted" : shot.approval}
                  </Badge>
                  <span className="text-xs">
                    <Money usd={current?.cost_usd ?? 0} secondary={false} size="sm" />{" "}
                    {current ? <CostSourceBadge source={current.cost_source} /> : null}
                  </span>
                </div>
                {shot.approval_note ? (
                  <p className="text-xs text-fg-muted">Note: {shot.approval_note}</p>
                ) : null}
                {shot.storyboard ? (
                  <p className="line-clamp-2 text-xs text-fg-muted">
                    {shot.storyboard.description}
                  </p>
                ) : null}
                {shot.references.length ? (
                  <p className="text-[11px] text-fg-subtle">
                    References:{" "}
                    {shot.references
                      .map((r) => (r.view ? titleCase(r.view) : r.path.split("/").pop()))
                      .join(", ")}
                  </p>
                ) : (
                  <p className="text-[11px] text-fg-subtle">No product references used</p>
                )}
                {current ? <PromptDetails v={current} /> : null}
                <VersionStrip
                  shot={shot}
                  busy={actions.busy !== null || !!liveJob}
                  onSelect={(attempt) => actions.selectKeyframeVersion(shot.shot_id, attempt)}
                />
                <div className="flex flex-wrap gap-1 border-t border-border pt-2">
                  {gate && shot.approval !== "approved" ? (
                    <Button
                      size="sm"
                      variant="success"
                      disabled={actions.busy !== null || !!liveJob}
                      onClick={() =>
                        actions.keyframes(
                          [{ shotId: shot.shot_id, decision: "approve" }],
                          false,
                          false,
                        )
                      }
                    >
                      <Check /> Approve
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!!liveJob}
                    onClick={() => {
                      setVariation("fresh");
                      setRegen({ shot });
                    }}
                  >
                    <RefreshCw /> Regenerate
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!!liveJob}
                    onClick={() => {
                      setEditPrompt(shot);
                      setPromptText(current?.prompt ?? "");
                    }}
                  >
                    <Pencil /> Edit prompt
                  </Button>
                  <label className="ml-auto flex items-center gap-1 text-xs text-fg-muted">
                    <input type="checkbox" checked={isSel} onChange={() => toggle(shot.shot_id)} />{" "}
                    select
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {gate &&
      pending === 0 &&
      detail.approvals.keyframes_rejected === 0 &&
      detail.run.ui_status === "awaiting_keyframe_approval" ? (
        <div className="flex items-center justify-between rounded-md border border-ok/30 bg-ok-bg px-3 py-2 text-sm text-ok">
          <span>All keyframes approved.</span>
          <Button size="sm" onClick={() => actions.resume()} disabled={actions.busy !== null}>
            Continue to animation
          </Button>
        </div>
      ) : null}
      {detail.approvals.keyframes_rejected > 0 && !liveJob ? (
        <div className="flex items-center justify-between rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-sm text-warn">
          <span>{detail.approvals.keyframes_rejected} keyframe(s) marked for regeneration.</span>
          <Button size="sm" onClick={() => actions.resume()} disabled={actions.busy !== null}>
            Regenerate now
          </Button>
        </div>
      ) : null}

      {regen ? (
        <ConfirmSpendDialog
          open
          onOpenChange={(o) => !o && setRegen(null)}
          title={`Regenerate ${regen.shot.shot_id.replace("shot_", "Shot ")}`}
          description="The current image is kept as a previous version. FLUX is called again with your instruction as feedback to the prompter."
          instruction={{
            label: "Optional instruction",
            placeholder: "e.g. Keep everything but make the camera slightly lower.",
          }}
          loadEstimate={() => actions.estimate("keyframe", regen.shot.shot_id)}
          confirmLabel="Confirm regenerate"
          busy={actions.busy === "keyframes"}
          onConfirm={async (instruction) => {
            const r = await actions.keyframes(
              [
                {
                  shotId: regen.shot.shot_id,
                  decision: "reject",
                  instruction: instruction || "regenerate",
                  prompt: regen.prompt ?? null,
                  variation: regen.prompt ? null : variation,
                },
              ],
              false,
              true,
            );
            if (r) {
              setRegen(null);
              onChanged();
            }
          }}
        >
          {fileUrl(regen.shot.keyframe_url) ? (
            <img
              src={fileUrl(regen.shot.keyframe_url) as string}
              alt=""
              className="mx-auto max-h-48 rounded-md"
            />
          ) : null}
          {regen.prompt ? (
            <p className="text-xs text-fg-muted">
              Your prompt is used verbatim, so the variation strength does not apply.
            </p>
          ) : (
            <VariationPicker value={variation} onChange={setVariation} name="kf-variation" />
          )}
        </ConfirmSpendDialog>
      ) : null}
      {editPrompt ? (
        <Dialog open onOpenChange={(o) => !o && setEditPrompt(null)}>
          <DialogContent wide>
            <DialogHeader>
              <DialogTitle>
                Edit prompt for {editPrompt.shot_id.replace("shot_", "Shot ")}
              </DialogTitle>
              <DialogDescription>
                Your prompt is sent to FLUX verbatim (the image prompter is skipped, saving that LLM
                call). The current image stays as a previous version.
              </DialogDescription>
            </DialogHeader>
            <Textarea rows={8} value={promptText} onChange={(e) => setPromptText(e.target.value)} />
            <DialogFooter>
              <Button variant="secondary" onClick={() => setEditPrompt(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const s = editPrompt;
                  setEditPrompt(null);
                  setRegen({ shot: s, prompt: promptText });
                }}
                disabled={promptText.trim().length < 20}
              >
                Continue to cost confirmation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      <ConfirmSpendDialog
        open={bulkRegen}
        onOpenChange={setBulkRegen}
        title={`Regenerate ${selected.size} keyframe(s)`}
        description="Each selected shot is regenerated with the same instruction; every previous image is kept."
        instruction={{
          label: "Instruction for all selected",
          placeholder: "e.g. Warmer light, less clutter.",
        }}
        loadEstimate={async () => {
          const ests = await Promise.all(
            [...selected].map((id) => actions.estimate("keyframe", id)),
          );
          return {
            estimate_usd: ests.reduce((n, e) => n + e.estimate_usd, 0),
            breakdown: ests.map((e) => ({ item: `${e.shot_id}`, usd: e.estimate_usd, note: "" })),
            budget: ests[ests.length - 1]?.budget ?? null,
          };
        }}
        confirmLabel="Confirm regenerate"
        busy={actions.busy === "keyframes"}
        onConfirm={async (instruction) => {
          const r = await actions.keyframes(
            [...selected].map((id) => ({
              shotId: id,
              decision: "reject" as const,
              instruction: instruction || "regenerate",
              variation: bulkVariation,
            })),
            false,
            true,
          );
          if (r) {
            setSelected(new Set());
            setBulkRegen(false);
            onChanged();
          }
        }}
      >
        <VariationPicker value={bulkVariation} onChange={setBulkVariation} name="bulk-variation" />
      </ConfirmSpendDialog>
      {full ? (
        <Dialog open onOpenChange={(o) => !o && setFull(null)}>
          <DialogContent wide className="bg-neutral-950 p-2">
            <DialogTitle className="sr-only">{full.shot_id}</DialogTitle>
            {fileUrl(full.keyframe_url) ? (
              <img
                src={fileUrl(full.keyframe_url) as string}
                alt={full.shot_id}
                className="mx-auto max-h-[85vh] rounded"
              />
            ) : null}
            <p className="px-2 pb-1 text-xs text-neutral-300">
              {full.shot_id} · v{full.keyframe_version} · {full.storyboard?.description}
              {full.record?.updated_at ? ` · ${formatDate(full.record.updated_at)}` : ""}
            </p>
          </DialogContent>
        </Dialog>
      ) : null}
      <button type="button" className="sr-only" onClick={() => setSelected(new Set())}>
        <X />
      </button>
    </div>
  );
}
