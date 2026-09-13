"use client";

import type { CreativeView, RunDetail, VersionView } from "@pipeline/studio/api-types";
import { useState } from "react";
import { CostSourceBadge, Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/misc";
import { fileUrl } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";

function AssetRow({
  v,
  shotId,
  creative,
}: {
  v: VersionView;
  shotId: string;
  creative: CreativeView;
}) {
  const [open, setOpen] = useState(false);
  const src = fileUrl(v.url);
  return (
    <div
      className={cn("flex gap-3 rounded-md border border-border p-2", v.archived && "opacity-70")}
    >
      <div className="h-20 w-12 shrink-0 overflow-hidden rounded bg-neutral-900">
        {src && v.kind === "keyframe" ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : src ? (
          <video src={src} className="h-full w-full object-cover" muted preload="metadata">
            <track kind="captions" />
          </video>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">
            {shotId} · {v.kind} v{v.attempt}
          </span>
          <Badge
            variant={
              v.selected
                ? "ok"
                : v.status === "failed"
                  ? "danger"
                  : v.status === "rejected"
                    ? "warn"
                    : "muted"
            }
          >
            {v.selected ? "in use" : v.archived ? "archived" : v.status}
          </Badge>
          <Money usd={v.cost_usd} secondary={false} size="sm" />{" "}
          <CostSourceBadge source={v.cost_source} />
          {v.variation_strength ? (
            <Badge variant="outline">variation {v.variation_strength}</Badge>
          ) : null}
        </div>
        <p className="text-fg-muted">
          {v.provider} {v.model} · prompt v{v.prompt_version}
          {v.request_id ? ` · request ${v.request_id}` : ""}
          {v.created_at ? ` · ${formatDate(v.created_at)}` : ""} · {v.latency_ms} ms
        </p>
        {v.refs.length ? (
          <p className="text-fg-subtle">
            References: {v.refs.map((r) => r.path.split("/").pop()).join(", ")}
          </p>
        ) : null}
        <button
          type="button"
          className="text-fg-muted underline-offset-2 hover:underline"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide prompt & settings" : "Prompt & settings"}
        </button>
        {open ? (
          <div className="mt-1 rounded bg-surface-2 p-2">
            <p className="whitespace-pre-wrap">{v.prompt}</p>
            <p className="mt-1 text-fg-subtle">Settings: {JSON.stringify(v.params)}</p>
            <p className="text-fg-subtle">
              Creative controls (inherited from the run): Creative Freedom {creative.creative_label}{" "}
              · {creative.creative_freedom.toFixed(2)}, Goal Focus {creative.goal_label} ·{" "}
              {creative.goal_focus.toFixed(2)}
              {v.variation_strength ? `; variation strength ${v.variation_strength}` : ""}
            </p>
            {v.checks.length ? (
              <p className="text-fg-subtle">
                Checks: {v.checks.map((c) => `${c.id}=${c.status}`).join(", ")}
              </p>
            ) : null}
            {v.error ? <p className="text-danger">{v.error}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ProvenanceView({ detail }: { detail: RunDetail }) {
  const m = detail.manifest;
  const creative = detail.creative.controls;
  const director = detail.creative.director;
  const chosen = director?.candidates[director.selected_index] ?? null;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Run provenance</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <dt className="text-fg-muted">Run id</dt>
            <dd className="mono">{m.run_id}</dd>
            <dt className="text-fg-muted">Brand config version</dt>
            <dd className="mono">
              {m.brand_config_version}
              {m.options.brand_source === "snapshot" ? " (pinned snapshot)" : " (live brand file)"}
            </dd>
            <dt className="text-fg-muted">Product</dt>
            <dd>{m.product_id ?? "brand default"}</dd>
            <dt className="text-fg-muted">Providers</dt>
            <dd className="text-xs">
              {Object.entries(m.providers)
                .map(([k, v]) => `${k}: ${v.provider}/${v.model}`)
                .join(" · ")}
            </dd>
            <dt className="text-fg-muted">Options</dt>
            <dd className="text-xs">{`mode ${m.options.provider_mode} · keyframe gate ${m.options.approve_keyframes ? "on" : "off"} · cap $${m.cost.hard_cap_usd} · AI seconds target ${m.cost.ai_video_seconds_target}`}</dd>
            <dt className="text-fg-muted">Creative controls</dt>
            <dd className="text-xs">
              Creative Freedom: {creative.creative_freedom.toFixed(2)} — {creative.creative_label} ·
              Goal Focus: {creative.goal_focus.toFixed(2)} — {creative.goal_label}
              <span className="text-fg-subtle">
                {" "}
                (
                {creative.sources.creative_freedom === "run"
                  ? "set for this run"
                  : creative.sources.creative_freedom === "brand"
                    ? "brand default"
                    : "pipeline default"}
                {creative.preset ? `, preset ${creative.preset.replace("_", " ")}` : ""})
              </span>
            </dd>
            <dt className="text-fg-muted">Concept candidates</dt>
            <dd className="text-xs">
              {director
                ? director.candidate_count > 1
                  ? `${director.candidates.length} drafted in one call; chose "${chosen?.title ?? "?"}"${director.ranking.length ? ` · goal-weighted ranking: ${director.ranking.map((r) => `${r.title} ${r.score}`).join(", ")}` : ""}`
                  : "one concept (creative freedom below 0.5)"
                : "not recorded (run predates the controls or has not planned yet)"}
              {director?.regeneration
                ? ` · regenerated with ${director.regeneration.variation} variation${director.regeneration.instruction ? `: “${director.regeneration.instruction}”` : ""}`
                : ""}
            </dd>
            {m.pending_regeneration ? (
              <>
                <dt className="text-fg-muted">Pending regeneration</dt>
                <dd className="text-xs">
                  {m.pending_regeneration.target.replace("_", " ")}
                  {m.pending_regeneration.shot_id ? ` ${m.pending_regeneration.shot_id}` : ""} ·{" "}
                  {m.pending_regeneration.variation} variation (runs on the next resume)
                </dd>
              </>
            ) : null}
            <dt className="text-fg-muted">Created</dt>
            <dd>
              {formatDate(m.created_at)} by {m.created_by ?? "cli"}
            </dd>
          </dl>
          {director && director.candidates.length > 1 ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {director.candidates.map((c, i) => (
                <div
                  key={c.title}
                  className={cn(
                    "rounded-md border p-2 text-xs",
                    i === director.selected_index ? "border-accent" : "border-border opacity-80",
                  )}
                >
                  <p className="font-medium">
                    {c.title}
                    {i === director.selected_index ? " · chosen" : ""}
                  </p>
                  <p className="text-fg-muted">{c.concept}</p>
                  <p className="mt-1 text-fg-subtle">
                    {Object.entries(c.scores)
                      .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
                      .join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <div>
        <SectionTitle
          title="Every generated asset"
          description="All versions ever produced, including rejected and archived ones. Nothing is deleted."
        />
        <div className="space-y-2">
          {detail.shots.flatMap((s) =>
            [...s.versions.keyframes, ...s.versions.clips].map((v) => (
              <AssetRow
                key={`${s.shot_id}-${v.kind}-${v.attempt}-${v.archived}`}
                v={v}
                shotId={s.shot_id}
                creative={creative}
              />
            )),
          )}
          {!detail.shots.some((s) => s.versions.keyframes.length) ? (
            <p className="text-sm text-fg-muted">No assets generated yet.</p>
          ) : null}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Decisions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {detail.decisions.map((d) => (
                <li key={`${d.ts}-${d.stage}-${d.subject}-${d.reason.slice(0, 24)}`}>
                  <span className="font-medium">{d.stage}</span> · {d.subject}:{" "}
                  <span className="text-fg-muted">{d.reason}</span>
                </li>
              ))}
              {!detail.decisions.length ? (
                <li className="text-fg-subtle">No decisions logged yet.</li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Audit trail</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {detail.audit.map((a) => (
                <li key={a.id}>
                  <span className="text-fg-subtle">{formatDate(a.ts)}</span>{" "}
                  <span className="font-medium">{a.action}</span>{" "}
                  {a.shot_id ? `· ${a.shot_id}` : ""}{" "}
                  <span className="text-fg-muted">by {a.actor}</span>
                  {Object.keys(a.details).length ? (
                    <span className="text-fg-subtle">
                      {" "}
                      · {JSON.stringify(a.details).slice(0, 140)}
                    </span>
                  ) : null}
                </li>
              ))}
              {!detail.audit.length ? <li className="text-fg-subtle">Nothing yet.</li> : null}
            </ul>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Event log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 overflow-auto scroll-thin rounded bg-neutral-950 p-3 font-mono text-[11px] text-neutral-200">
            {detail.events.map((e) => (
              <div
                key={`${e.ts}-${e.stage}-${e.shot ?? ""}-${e.message}`}
                className={cn(
                  e.level === "error" && "text-red-300",
                  e.level === "warn" && "text-amber-300",
                  e.level === "debug" && "text-neutral-500",
                )}
              >
                <span className="text-neutral-500">{e.ts.slice(11, 19)}</span> [{e.stage ?? "run"}
                {e.shot ? `/${e.shot}` : ""}] {e.message}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
