"use client";

import type { RunDetail, ShotView } from "@pipeline/studio/api-types";
import { Check, History, ImageIcon, Loader2, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { CostSourceBadge, Money } from "@/components/money";
import type { RunActions } from "@/components/run/actions";
import { ConfirmSpendDialog } from "@/components/run/confirm-spend";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBanner, SectionTitle } from "@/components/ui/misc";
import { fileUrl } from "@/lib/api";
import { cn, formatClock } from "@/lib/utils";

function elapsed(iso: string | null | undefined): string {
  if (!iso) return "";
  return formatClock((Date.now() - new Date(iso).getTime()) / 1000);
}

export function AnimationView({
  detail,
  actions,
  onChanged,
}: {
  detail: RunDetail;
  actions: RunActions;
  onChanged: () => void;
}) {
  const [regen, setRegen] = useState<ShotView | null>(null);
  const [still, setStill] = useState<ShotView | null>(null);
  const shots = detail.shots;
  const stage = detail.stages.find((s) => s.id === "animate");
  const liveJob = !!detail.run.job?.alive;
  const animating = stage?.ui_status === "running";
  const failedStage = stage?.ui_status === "failed";
  if (!shots.some((s) => s.record?.keyframe))
    return (
      <p className="text-sm text-fg-muted">Animation starts after the keyframes are approved.</p>
    );
  const soFar = shots.reduce((n, s) => n + s.versions.clips.reduce((m, v) => m + v.cost_usd, 0), 0);
  return (
    <div className="space-y-4">
      <SectionTitle
        title="Animation"
        description={`${shots.filter((s) => s.animation.kind === "GEN_VIDEO").length} shot(s) get generated video; the rest are stills. Only the shot you regenerate is regenerated.`}
        right={
          <span className="text-sm text-fg-muted">
            Cost so far <Money usd={soFar} size="sm" />
          </span>
        }
      />
      <ErrorBanner message={actions.error} />
      <div className="space-y-2">
        {shots.map((shot) => {
          const isVideo = shot.animation.kind === "GEN_VIDEO";
          const clip = shot.versions.clips.find((v) => v.selected);
          const p = shot.progress;
          const generating =
            isVideo &&
            !shot.final_url &&
            p &&
            (p.status === "queued" || p.status === "in_progress") &&
            (animating || liveJob);
          const failed =
            isVideo &&
            !shot.final_url &&
            (p?.status === "failed" || (!!shot.last_error && failedStage));
          const done = !!shot.final_url && (shot.status === "done" || shot.status === "downgraded");
          const videoSrc = fileUrl(shot.video_url);
          const kfSrc = fileUrl(shot.keyframe_url);
          return (
            <div
              key={shot.shot_id}
              className={cn(
                "card flex flex-col gap-3 p-3 sm:flex-row",
                failed && "border-danger/40",
              )}
            >
              <div className="flex shrink-0 gap-2">
                <div className="h-28 w-16 overflow-hidden rounded-md bg-neutral-900">
                  {kfSrc ? <img src={kfSrc} alt="" className="h-full w-full object-cover" /> : null}
                </div>
                {videoSrc && done && shot.final_kind === "video" ? (
                  <video
                    src={videoSrc}
                    className="h-28 w-16 rounded-md bg-black object-cover"
                    controls
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium uppercase tracking-wide">
                    {shot.shot_id.replace("shot_", "Shot ")}
                  </span>
                  <Badge variant={shot.approval === "approved" ? "ok" : "muted"}>
                    {shot.approval === "approved"
                      ? "Approved keyframe"
                      : `keyframe v${shot.keyframe_version ?? "?"}`}
                  </Badge>
                  {isVideo ? (
                    <Badge variant="info">{shot.animation.model}</Badge>
                  ) : (
                    <Badge variant="muted">{shot.animation.label}</Badge>
                  )}
                  {shot.status === "downgraded" ? (
                    <Badge variant="warn">Downgraded to still</Badge>
                  ) : null}
                </div>
                {isVideo ? (
                  <div className="text-sm">
                    {done && clip ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Check className="h-4 w-4 text-ok" /> Complete ·{" "}
                        {clip.params.duration as number} s · <Money usd={clip.cost_usd} size="sm" />{" "}
                        <CostSourceBadge source={clip.cost_source} />
                        {clip.request_id ? (
                          <span className="text-xs text-fg-subtle">request {clip.request_id}</span>
                        ) : null}
                      </span>
                    ) : generating ? (
                      <span className="flex items-center gap-2 text-running">
                        <Loader2 className="h-4 w-4 animate-spin" />{" "}
                        {p?.status === "queued"
                          ? `Queued at ${shot.animation.provider}${p.queue_position != null ? ` (position ${p.queue_position})` : ""}`
                          : "Generating…"}{" "}
                        · {elapsed(p?.started_at)} elapsed
                        <span className="text-xs text-fg-subtle">
                          (the provider reports no percentage)
                        </span>
                      </span>
                    ) : failed ? (
                      <span className="flex items-start gap-2 text-danger">
                        <X className="mt-0.5 h-4 w-4 shrink-0" />{" "}
                        <span>Failed: {shot.last_error ?? p?.message ?? "unknown error"}</span>
                      </span>
                    ) : (
                      <span className="text-fg-muted">
                        Waiting
                        {shot.animation.seconds ? ` · ${shot.animation.seconds} s planned` : ""}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-fg-muted">
                    <ImageIcon className="mr-1 inline h-3.5 w-3.5" /> FLUX still only · no animation
                    required{done ? " · ready" : ""}
                  </p>
                )}
                {shot.versions.clips.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    <History className="h-3 w-3 text-fg-subtle" />
                    {[...shot.versions.clips]
                      .sort((a, b) => a.attempt - b.attempt)
                      .map((v) => (
                        <button
                          key={v.attempt}
                          type="button"
                          disabled={
                            v.selected || v.status !== "ok" || liveJob || actions.busy !== null
                          }
                          onClick={() => actions.selectClipVersion(shot.shot_id, v.attempt)}
                          className={cn(
                            "rounded border px-1.5 py-0.5",
                            v.selected
                              ? "border-accent bg-accent text-accent-fg"
                              : v.status !== "ok"
                                ? "border-border text-fg-subtle line-through"
                                : "border-border hover:bg-surface-2",
                          )}
                          title={v.error ?? `${v.model} · ${v.cost_usd.toFixed(3)} USD`}
                        >
                          v{v.attempt}
                        </button>
                      ))}
                  </div>
                ) : null}
                <p className="text-xs text-fg-subtle">
                  Shot cost so far <Money usd={shot.cost_usd} secondary={false} size="sm" />
                </p>
              </div>
              {isVideo ? (
                <div className="flex flex-row flex-wrap gap-1 sm:flex-col">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={liveJob || !shot.record?.keyframe}
                    onClick={() => setRegen(shot)}
                  >
                    <RefreshCw /> {failed ? "Retry shot" : "Regenerate clip"}
                  </Button>
                  {(failed || !done) && shot.record?.keyframe ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={liveJob}
                      onClick={() => setStill(shot)}
                    >
                      Use still instead
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {regen ? (
        <ConfirmSpendDialog
          open
          onOpenChange={(o) => !o && setRegen(null)}
          title={`Regenerate clip for ${regen.shot_id.replace("shot_", "Shot ")}`}
          description={`Only this shot is regenerated; the current clip is kept as a previous version and the edit and render re-run afterwards (no extra provider cost).`}
          instruction={{
            label: "Optional instruction for the motion prompt",
            placeholder: "e.g. Slower push in, keep the train centred.",
          }}
          loadEstimate={() => actions.estimate("clip", regen.shot_id)}
          confirmLabel="Confirm regenerate"
          busy={actions.busy === "regenerate-clip"}
          onConfirm={async (instruction) => {
            const r = await actions.regenerateClip(regen.shot_id, instruction || null);
            if (r) {
              setRegen(null);
              onChanged();
            }
          }}
        />
      ) : null}
      {still ? (
        <ConfirmSpendDialog
          open
          onOpenChange={(o) => !o && setStill(null)}
          title={`Use the approved keyframe as an animated still for ${still.shot_id.replace("shot_", "Shot ")}`}
          description="No provider call: the edit adds restrained movement to the still. The final QC will note the downgrade."
          loadEstimate={async () => ({
            estimate_usd: 0,
            breakdown: [{ item: "Edit + render re-run", usd: 0, note: "local compute only" }],
            budget: null,
          })}
          confirmLabel="Use still and continue"
          busy={actions.busy === "use-still"}
          onConfirm={async () => {
            const r = await actions.replaceWithStill(still.shot_id);
            if (r) {
              setStill(null);
              onChanged();
            }
          }}
        />
      ) : null}
    </div>
  );
}
