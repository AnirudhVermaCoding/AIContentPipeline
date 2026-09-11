"use client";

import type { RunDetail, StageView } from "@pipeline/studio/api-types";
import { Check, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { useState } from "react";
import { CostSourceBadge, Money } from "@/components/money";
import { StageStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { cn, formatInt, formatMs } from "@/lib/utils";

function StageIcon({ status }: { status: StageView["ui_status"] }) {
  const base = "flex h-6 w-6 items-center justify-center rounded-full border text-[11px]";
  if (status === "complete")
    return (
      <span className={cn(base, "border-ok bg-ok text-white")}>
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  if (status === "running")
    return (
      <span className={cn(base, "border-running bg-running-bg text-running")}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    );
  if (status === "failed")
    return (
      <span className={cn(base, "border-danger bg-danger text-white")}>
        <X className="h-3.5 w-3.5" />
      </span>
    );
  if (status === "awaiting_approval")
    return <span className={cn(base, "border-warn bg-warn-bg text-warn")}>!</span>;
  if (status === "skipped")
    return <span className={cn(base, "border-border bg-surface-2 text-fg-subtle")}>–</span>;
  return <span className={cn(base, "border-border bg-surface text-fg-subtle")} />;
}

function usageLine(u: StageView["usage"]): string[] {
  const out: string[] = [];
  if (u.input_tokens) out.push(`Input: ${formatInt(u.input_tokens)} tokens`);
  if (u.output_tokens) out.push(`Output: ${formatInt(u.output_tokens)} tokens`);
  if (u.image_count) out.push(`${u.image_count} image${u.image_count === 1 ? "" : "s"}`);
  if (u.video_seconds) out.push(`${u.video_seconds} s of video`);
  if (u.audio_characters) out.push(`${formatInt(u.audio_characters)} characters`);
  return out;
}

export function PipelineRail({
  detail,
  onSelectStage,
}: {
  detail: RunDetail;
  onSelectStage?: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const shots = detail.shots;
  return (
    <ol className="relative space-y-1">
      {detail.stages.map((st, i) => {
        const open = openId === st.id;
        const last = i === detail.stages.length - 1;
        const generated = st.calls.filter((c) => c.outcome === "used").length;
        const regenerated = st.calls.filter((c) => c.outcome === "superseded").length;
        const model = st.models[0];
        const isShotStage = st.id === "keyframes" || st.id === "animate";
        return (
          <li key={st.id} className="relative pl-9">
            {!last ? (
              <span className="absolute left-[11px] top-7 h-[calc(100%-4px)] w-px bg-border" />
            ) : null}
            <span className="absolute left-0 top-1.5">
              <StageIcon status={st.ui_status} />
            </span>
            <div
              className={cn(
                "rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border",
                open && "border-border bg-surface",
              )}
            >
              <button
                type="button"
                className="flex w-full items-center gap-3 text-left"
                onClick={() => {
                  setOpenId(open ? null : st.id);
                  onSelectStage?.(st.id);
                }}
              >
                <span className="flex-1">
                  <span className="text-sm font-medium uppercase tracking-wide">{st.label}</span>
                  {st.note ? <span className="ml-2 text-xs text-fg-subtle">{st.note}</span> : null}
                </span>
                <StageStatusBadge status={st.ui_status} />
                {st.ui_status !== "waiting" && !st.synthetic ? (
                  <span className="hidden w-24 text-right text-xs text-fg-muted sm:inline">
                    {formatMs(st.duration_ms)}
                  </span>
                ) : null}
                {!st.synthetic ? (
                  <span className="w-20 text-right">
                    <Money usd={st.cost_usd} secondary={false} size="sm" />
                  </span>
                ) : null}
                {open ? (
                  <ChevronDown className="h-4 w-4 text-fg-subtle" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-fg-subtle" />
                )}
              </button>
              {open ? (
                <div className="mt-2 grid gap-3 border-t border-border pt-3 text-xs sm:grid-cols-[1fr_auto]">
                  <div className="space-y-1">
                    {model ? (
                      <p className="text-sm font-medium">{st.models.join(", ")}</p>
                    ) : st.synthetic ? null : (
                      <p className="text-fg-subtle">No paid calls</p>
                    )}
                    {usageLine(st.usage).map((l) => (
                      <p key={l} className="text-fg-muted">
                        {l}
                      </p>
                    ))}
                    {st.duration_ms != null ? (
                      <p className="text-fg-muted">Duration: {formatMs(st.duration_ms)}</p>
                    ) : null}
                    {!st.synthetic ? (
                      <p className="text-fg-muted">
                        Cost: <Money usd={st.cost_usd} size="sm" />{" "}
                        {st.calls[0] ? <CostSourceBadge source={st.calls[0].cost_source} /> : null}
                      </p>
                    ) : null}
                    {isShotStage ? (
                      <p className="text-fg-muted">
                        {generated} generated · {regenerated} regenerated · {st.failed_calls} failed
                      </p>
                    ) : (
                      <p className="text-fg-muted">
                        Retries: {st.retries}
                        {st.failed_calls ? ` · failed calls: ${st.failed_calls}` : ""}
                      </p>
                    )}
                    {st.error ? <p className="text-danger">Error: {st.error}</p> : null}
                  </div>
                  {isShotStage && shots.length ? (
                    <ul className="min-w-[220px] space-y-1">
                      {shots.map((s) => {
                        const kf = st.id === "keyframes";
                        const done = kf ? !!s.keyframe_url : !!s.final_url;
                        const running =
                          s.progress &&
                          (s.progress.status === "queued" || s.progress.status === "in_progress") &&
                          !done;
                        const failed = !done && !!s.last_error && st.ui_status === "failed";
                        const cost = kf
                          ? s.versions.keyframes.reduce((n, v) => n + v.cost_usd, 0)
                          : s.versions.clips.reduce((n, v) => n + v.cost_usd, 0);
                        const label = kf
                          ? ""
                          : s.animation.kind === "GEN_VIDEO"
                            ? `${s.animation.seconds ?? ""} s`
                            : "still";
                        return (
                          <li key={s.shot_id} className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5">
                              {done ? (
                                <Check className="h-3 w-3 text-ok" />
                              ) : running ? (
                                <Loader2 className="h-3 w-3 animate-spin text-running" />
                              ) : failed ? (
                                <X className="h-3 w-3 text-danger" />
                              ) : (
                                <span className="inline-block h-3 w-3 rounded-full border border-border" />
                              )}
                              <span className={cn(failed && "text-danger")}>
                                {s.shot_id.replace("shot_", "Shot ")}
                              </span>
                              {!kf && s.animation.kind !== "GEN_VIDEO" ? (
                                <Badge variant="muted">{label}</Badge>
                              ) : null}
                            </span>
                            <span className="text-fg-muted">
                              {done ? (
                                <Money usd={cost} secondary={false} size="sm" />
                              ) : running ? (
                                s.progress?.status === "queued" ? (
                                  "queued"
                                ) : (
                                  "generating…"
                                )
                              ) : failed ? (
                                "failed"
                              ) : (
                                "waiting"
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
