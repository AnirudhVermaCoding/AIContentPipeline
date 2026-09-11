"use client";

import type { RunDetail } from "@pipeline/studio/api-types";
import { Check, Loader2 } from "lucide-react";
import { Progress, SectionTitle } from "@/components/ui/misc";
import { cn, formatClock, formatTimecode } from "@/lib/utils";

const PHASES: Array<{ id: string; label: string }> = [
  { id: "preparing", label: "Preparing timeline" },
  { id: "bundling", label: "Loading composition" },
  { id: "staging_assets", label: "Loading assets" },
  { id: "starting_browser", label: "Starting renderer" },
  { id: "rendering", label: "Remotion render" },
  { id: "encoding", label: "Encoding MP4" },
  { id: "normalizing_audio", label: "Mixing narration & music" },
  { id: "done", label: "Final MP4 ready" },
];

export function RenderView({ detail }: { detail: RunDetail }) {
  const p = detail.artifacts.render_progress;
  const stage = detail.stages.find((s) => s.id === "render");
  const edl = detail.artifacts.edl;
  const out = detail.artifacts.render_output;
  if (!p && stage?.ui_status === "waiting")
    return (
      <p className="text-sm text-fg-muted">Rendering starts once every shot has its final asset.</p>
    );
  const idx = p ? PHASES.findIndex((x) => x.id === p.phase) : -1;
  const pct = p ? Math.round(p.progress * 100) : 0;
  return (
    <div className="space-y-4">
      <SectionTitle
        title="Render"
        description={
          p
            ? `${p.renderer === "remotion" ? "Remotion" : "FFmpeg"} · ${p.mode} edit · ${p.output.width}×${p.output.height} @ ${p.output.fps} fps`
            : "Render"
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="card p-4">
          <ol className="space-y-2">
            {PHASES.filter(
              (ph) =>
                !(
                  p?.renderer === "ffmpeg" &&
                  ["bundling", "starting_browser", "rendering"].includes(ph.id)
                ),
            ).map((ph) => {
              const i = PHASES.findIndex((x) => x.id === ph.id);
              const state =
                p?.phase === "failed"
                  ? i < idx
                    ? "done"
                    : "failed"
                  : p?.done
                    ? "done"
                    : i < idx
                      ? "done"
                      : i === idx
                        ? "active"
                        : "waiting";
              return (
                <li
                  key={ph.id}
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    state === "waiting" && "text-fg-subtle",
                    state === "failed" && "text-danger",
                  )}
                >
                  {state === "done" ? (
                    <Check className="h-4 w-4 text-ok" />
                  ) : state === "active" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-running" />
                  ) : (
                    <span className="inline-block h-4 w-4 rounded-full border border-border" />
                  )}
                  {ph.label}
                  {ph.id === "rendering" && p && (state === "active" || state === "done") ? (
                    <span className="ml-auto num text-xs text-fg-muted">
                      Frame {p.rendered_frames} / {p.total_frames}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {p && !p.done && p.phase !== "failed" ? (
            <div className="mt-4">
              <Progress value={pct} tone="running" />
              <div className="mt-1 flex justify-between text-xs text-fg-muted">
                <span className="num">{pct}%</span>
                <span>Elapsed {formatClock(p.elapsed_ms / 1000)}</span>
              </div>
            </div>
          ) : null}
          {p?.error ? <p className="mt-3 text-sm text-danger">Render failed: {p.error}</p> : null}
        </div>
        <div className="card p-4 text-sm">
          <p className="text-xs font-medium text-fg-muted">Current stage</p>
          <p className="font-medium">
            {p ? (PHASES.find((x) => x.id === p.phase)?.label ?? p.phase) : "—"}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <dt className="text-fg-muted">Output</dt>
            <dd className="num">{p ? `${p.output.width} × ${p.output.height}` : "—"}</dd>
            <dt className="text-fg-muted">Frame rate</dt>
            <dd className="num">{p ? `${p.output.fps} fps` : "—"}</dd>
            <dt className="text-fg-muted">Codec</dt>
            <dd>H.264 + AAC</dd>
            <dt className="text-fg-muted">Frames</dt>
            <dd className="num">{p?.total_frames ?? "—"}</dd>
            {out ? (
              <>
                <dt className="text-fg-muted">Rendered in</dt>
                <dd className="num">{formatClock(out.render_ms / 1000)}</dd>
                <dt className="text-fg-muted">Duration</dt>
                <dd className="num">{out.meta.duration_s.toFixed(1)} s</dd>
              </>
            ) : null}
          </dl>
        </div>
      </div>
      {edl ? (
        <div>
          <p className="mb-1 text-xs font-medium text-fg-muted">Timeline</p>
          <div className="flex h-9 w-full overflow-hidden rounded-md border border-border bg-surface-2 text-[10px]">
            {edl.timeline.map((t) => (
              <div
                key={`${t.shot_id}-${t.start_s}`}
                className={cn(
                  "flex items-center justify-center border-r border-surface px-1 uppercase",
                  t.kind === "video" ? "bg-info-bg text-info" : "bg-surface text-fg-muted",
                )}
                style={{ width: `${(t.duration_s / edl.total_duration_s) * 100}%` }}
                title={`${t.shot_id} ${formatTimecode(t.start_s)} · ${t.kind}${t.treatment !== "none" ? ` · ${t.treatment}` : ""}`}
              >
                <span className="truncate">{t.shot_id.replace("shot_", "S")}</span>
              </div>
            ))}
            {edl.end_card ? (
              <div
                className="flex items-center justify-center bg-neutral-800 px-1 text-white"
                style={{ width: `${(edl.end_card.duration_s / edl.total_duration_s) * 100}%` }}
              >
                END
              </div>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {edl.mode} edit · {edl.timeline.length} items · {edl.total_duration_s.toFixed(1)} s ·{" "}
            {edl.text_overlays.length} overlay(s) · music {edl.audio.music_path ? "yes" : "no"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
