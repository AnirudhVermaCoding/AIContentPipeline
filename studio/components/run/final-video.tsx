"use client";

import type { RunDetail } from "@pipeline/studio/api-types";
import {
  Copy,
  Download,
  FolderOpen,
  Layers,
  ListOrdered,
  ReceiptText,
  RefreshCw,
} from "lucide-react";
import { Money } from "@/components/money";
import type { RunActions } from "@/components/run/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fileUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

export function FinalVideo({
  detail,
  actions,
  onTab,
}: {
  detail: RunDetail;
  actions: RunActions;
  onTab: (t: string) => void;
}) {
  const src = fileUrl(detail.files.final_video_url);
  const c = detail.costs;
  const qc = detail.artifacts.final_qc;
  const report = detail.artifacts.report;
  const saved = c.original_estimate_usd > 0 ? c.original_estimate_usd - c.actual_usd : null;
  const retries = c.calls.filter((x) => x.outcome === "superseded").length;
  if (!src)
    return (
      <p className="text-sm text-fg-muted">
        The final video appears here once rendering and QC finish.
      </p>
    );
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
      <div className="mx-auto w-full max-w-[380px]">
        <video
          src={src}
          controls
          playsInline
          className="aspect-[9/16] w-full rounded-xl bg-black shadow-lg"
        >
          <track kind="captions" />
        </video>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild>
            <a href={src} download={`${detail.run.run_id}.mp4`}>
              <Download /> Download MP4
            </a>
          </Button>
          <Button variant="secondary" onClick={() => actions.openFolder()}>
            <FolderOpen /> Open output folder
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-fg-subtle">{detail.files.run_dir}</p>
      </div>
      <div className="space-y-4">
        <div>
          <p className="text-xs text-fg-muted">{detail.brand.name}</p>
          <h2 className="text-xl font-semibold">{detail.run.product_name ?? detail.run.title}</h2>
          <p className="text-sm text-fg-muted">
            {detail.run.title} ·{" "}
            {detail.artifacts.render_output
              ? `${detail.artifacts.render_output.meta.duration_s.toFixed(1)} s · ${detail.artifacts.render_output.meta.width}×${detail.artifacts.render_output.meta.height}`
              : ""}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="card p-3">
            <p className="text-xs text-fg-muted">Actual total cost</p>
            <Money usd={c.actual_usd} size="lg" />
          </div>
          <div className="card p-3">
            <p className="text-xs text-fg-muted">Estimate at routing</p>
            <Money usd={c.original_estimate_usd} size="lg" source="ESTIMATED" secondary={false} />
          </div>
          <div className="card p-3">
            <p className="text-xs text-fg-muted">
              {saved != null && saved >= 0 ? "Saved vs estimate" : "Over estimate"}
            </p>
            <div className={cn(saved != null && saved < 0 && "text-warn")}>
              <Money usd={saved == null ? null : Math.abs(saved)} size="lg" secondary={false} />
            </div>
          </div>
          <div className="card p-3">
            <p className="text-xs text-fg-muted">AI video</p>
            <p className="text-xl font-semibold num">
              {report?.generation.ai_video_seconds ?? detail.run.ai_video_seconds ?? 0} s
            </p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-fg-muted">Generated images</p>
            <p className="text-xl font-semibold num">
              {report?.generation.keyframes ?? detail.shots.filter((s) => s.keyframe_url).length}
            </p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-fg-muted">Retries</p>
            <p className="text-xl font-semibold num">{retries}</p>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Quality checks</CardTitle>
            {qc ? (
              <Badge
                variant={qc.status === "pass" ? "ok" : qc.status === "fail" ? "danger" : "warn"}
              >
                QC {qc.status.replace(/_/g, " ")}
              </Badge>
            ) : (
              <Badge variant="muted">not run</Badge>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {detail.qc_semantic.scores.map((s) => (
                <div
                  key={s.id}
                  className="flex items-baseline justify-between border-b border-border py-1 text-sm"
                >
                  <span className="text-fg-muted">{s.label}</span>
                  <span className="text-xs text-fg-subtle">Unavailable</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-fg-subtle">{detail.qc_semantic.reason}</p>
            {qc ? (
              <ul className="mt-3 space-y-1 text-xs">
                {qc.checks.map((ch) => (
                  <li key={ch.id} className="flex items-start gap-2">
                    <Badge
                      variant={
                        ch.status === "pass" ? "ok" : ch.status === "fail" ? "danger" : "warn"
                      }
                      className="w-12 justify-center"
                    >
                      {ch.status}
                    </Badge>
                    <span>
                      <span className="font-medium">{ch.id.replace(/_/g, " ")}</span>{" "}
                      <span className="text-fg-muted">{ch.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onTab("animation")}>
            <RefreshCw /> Regenerate a shot
          </Button>
          <Button
            variant="secondary"
            onClick={() => actions.duplicate()}
            disabled={actions.busy !== null}
          >
            <Copy /> Duplicate as new video
          </Button>
          <Button variant="secondary" onClick={() => onTab("plan")}>
            <ListOrdered /> View storyboard
          </Button>
          <Button variant="secondary" onClick={() => onTab("costs")}>
            <ReceiptText /> View cost breakdown
          </Button>
          <Button variant="secondary" onClick={() => onTab("provenance")}>
            <Layers /> View generation provenance
          </Button>
        </div>
      </div>
    </div>
  );
}
