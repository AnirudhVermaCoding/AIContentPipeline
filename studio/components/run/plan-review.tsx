"use client";

import type {
  EditImpact,
  PreflightView,
  RunDetail,
  ShotView,
  StoryboardEditRequest,
} from "@pipeline/studio/api-types";
import {
  AlertTriangle,
  Check,
  Copy,
  GripVertical,
  Pencil,
  RefreshCw,
  Trash2,
  Wand2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Money } from "@/components/money";
import type { RunActions } from "@/components/run/actions";
import { ConfirmSpendDialog } from "@/components/run/confirm-spend";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ErrorBanner, SectionTitle } from "@/components/ui/misc";
import { cn, formatTimecode, titleCase } from "@/lib/utils";

function BudgetLine({
  label,
  usd,
  tone,
}: {
  label: string;
  usd: number | null;
  tone?: "ok" | "warn" | "danger";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span
        className={cn(
          "num font-medium",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "danger" && "text-danger",
        )}
      >
        {usd == null ? (
          <span className="text-fg-subtle">no limit</span>
        ) : (
          <Money usd={usd} secondary={false} size="sm" />
        )}
      </span>
    </div>
  );
}

export function PreflightPanel({
  preflight,
  detail,
}: {
  preflight: PreflightView;
  detail: RunDetail;
}) {
  const b = preflight.budget;
  const daily = b.windows.find((w) => w.rule === "daily");
  const wallet = b.windows.find((w) => w.rule === "wallet");
  const two = b.windows.find((w) => w.rule === "two_day");
  const after = b.after_run_usd;
  const routeConflict = detail.artifacts.route?.budget_check.status === "conflict";
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Generation plan</CardTitle>
          <Badge variant={preflight.stage === "planned" ? "info" : "warn"}>
            {preflight.stage === "planned" ? "From the routing plan" : "Pre-plan estimate"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {preflight.concept ? (
            <div>
              <p className="text-xs font-medium text-fg-muted">Creative concept</p>
              <p className="text-sm">{preflight.concept}</p>
            </div>
          ) : null}
          {preflight.emotional_arc?.length ? (
            <div>
              <p className="text-xs font-medium text-fg-muted">Emotional angle</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {preflight.emotional_arc.map((e) => (
                  <Badge key={e.beat} variant="outline" title={e.purpose}>
                    {e.beat} · {e.emotion}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-fg-muted">Narration</dt>
              <dd>
                {preflight.narration === "voice"
                  ? "Voice-over"
                  : preflight.narration === "music_only"
                    ? "Music only"
                    : "Decided by the director"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Estimated duration</dt>
              <dd>{preflight.duration_s != null ? `${preflight.duration_s.toFixed(1)} s` : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Storyboard shots</dt>
              <dd>{preflight.shots ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Estimated keyframes</dt>
              <dd>{preflight.images ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Estimated generated video</dt>
              <dd>
                {preflight.ai_video_seconds != null ? `${preflight.ai_video_seconds} s` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Motion promise</dt>
              <dd>{preflight.promise ? (preflight.promise.satisfied ? "met" : "not met") : "—"}</dd>
            </div>
          </dl>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-fg-muted">
                {detail.run.ui_status === "complete"
                  ? "Nothing left to generate"
                  : `Estimated cost${preflight.stage === "planned" ? " to finish" : ""}`}
              </span>
              <span className="num text-lg font-semibold">
                <Money usd={preflight.estimate.min_usd} secondary={false} size="lg" /> –{" "}
                <Money usd={preflight.estimate.max_usd} source="ESTIMATED" size="lg" />
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-fg-muted">
              {preflight.estimate.breakdown.map((x) => (
                <li key={x.item} className="flex justify-between gap-3">
                  <span>
                    {x.item}
                    {x.note ? <span className="text-fg-subtle"> — {x.note}</span> : null}
                  </span>
                  <span className="num whitespace-nowrap">
                    <Money usd={x.min_usd} secondary={false} size="sm" />
                    {x.max_usd !== x.min_usd ? (
                      <>
                        {" – "}
                        <Money usd={x.max_usd} secondary={false} size="sm" />
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {preflight.estimate.assumptions.length ? (
              <p className="mt-2 text-[11px] text-fg-subtle">
                {preflight.estimate.assumptions.join(" ")}
              </p>
            ) : null}
          </div>
          {preflight.alternatives.length ? (
            <div
              className={cn(
                "rounded-md border p-3 text-xs",
                routeConflict
                  ? "border-warn/30 bg-warn-bg text-warn"
                  : "border-border bg-surface-2 text-fg-muted",
              )}
            >
              <p className="font-medium">
                {routeConflict
                  ? "The router could not fit the story inside the cap. Alternatives:"
                  : "Cheaper plans the router considered and set aside:"}
              </p>
              <ul className="mt-1 list-disc pl-4">
                {preflight.alternatives.map((a) => (
                  <li key={a.description}>
                    {a.description} — est{" "}
                    <Money usd={a.est_total_usd} secondary={false} size="sm" /> (gives up:{" "}
                    {a.cost_of})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Budget check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <BudgetLine label="Hard run cap" usd={preflight.hard_cap_usd} />
          <BudgetLine label="Maximum possible exposure" usd={preflight.max_exposure_usd} />
          <BudgetLine label="Already spent on this run" usd={detail.costs.actual_usd} />
          <div className="my-2 h-px bg-border" />
          <BudgetLine label="Today's remaining budget" usd={daily?.available_usd ?? null} />
          <BudgetLine
            label="After this run (expected)"
            usd={after.daily_remaining}
            tone={after.daily_remaining != null && after.daily_remaining < 0 ? "danger" : undefined}
          />
          <BudgetLine label="48-hour remaining" usd={two?.available_usd ?? null} />
          <BudgetLine label="Wallet available" usd={wallet?.available_usd ?? null} />
          <div className="my-2 h-px bg-border" />
          {b.ok ? (
            <div className="flex items-center gap-2 rounded-md bg-ok-bg px-3 py-2 text-sm font-medium text-ok">
              <Check className="h-4 w-4" /> Safe to run
            </div>
          ) : (
            <div className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" /> Blocked by the{" "}
                {b.blocking_rule?.replace("_", " ")} rule
              </p>
              <p className="mt-1 text-xs">{b.reason}</p>
            </div>
          )}
          <p className="text-[11px] text-fg-subtle">
            The studio reserves the maximum exposure while a job runs and releases the difference to
            actual spend when it stops.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ShotEditDialog({
  shot,
  open,
  onOpenChange,
  actions,
  onApplied,
}: {
  shot: ShotView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  actions: RunActions;
  onApplied: () => void;
}) {
  const s = shot.storyboard;
  const [description, setDescription] = useState(s?.description ?? "");
  const [action, setAction] = useState(s?.action ?? "");
  const [intent, setIntent] = useState(s?.shot_intent ?? "");
  const [duration, setDuration] = useState(String(s?.duration_s ?? ""));
  const [impact, setImpact] = useState<EditImpact | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useMemo<StoryboardEditRequest>(
    () => ({
      shots: [
        {
          id: shot.shot_id,
          description,
          action,
          shot_intent: intent,
          duration_s: Number(duration) || undefined,
        },
      ],
      note: "edited in studio",
    }),
    [shot.shot_id, description, action, intent, duration],
  );
  async function preview() {
    setChecking(true);
    setError(null);
    try {
      setImpact(await actions.previewEdit(req));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }
  async function apply() {
    const r = await actions.applyEdit(req);
    if (r) {
      onOpenChange(false);
      onApplied();
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>Edit {shot.shot_id.replace("shot_", "Shot ")}</DialogTitle>
          <DialogDescription>
            Changes re-run continuity for this shot (a small LLM call). Narrated shots keep the
            timing of their narration lines; only silent shots take the duration you type.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Visual (what the frame shows)" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Action" className="sm:col-span-2">
            <Textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} />
          </Field>
          <Field label="Purpose">
            <Input value={intent} onChange={(e) => setIntent(e.target.value)} />
          </Field>
          <Field label="Duration (s)">
            <Input
              type="number"
              step="0.1"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
        </div>
        {impact ? (
          <div
            className={cn(
              "rounded-md border p-3 text-xs",
              impact.valid
                ? "border-border bg-surface-2"
                : "border-danger/30 bg-danger-bg text-danger",
            )}
          >
            {impact.valid ? (
              <>
                <p>
                  <strong>{impact.regenerated_shots.length}</strong> shot
                  {impact.regenerated_shots.length === 1 ? "" : "s"} will be (re)produced (
                  {impact.regenerated_shots.join(", ") || "none"}); {impact.kept_shots.length} kept
                  as they are.
                </p>
                <p className="mt-1">
                  Continuity call ~
                  <Money usd={impact.continuity_llm_estimate_usd} secondary={false} size="sm" />
                  {impact.regeneration_estimate_usd > 0 ? (
                    <>
                      {" "}
                      + re-generation of already produced shots ~
                      <Money usd={impact.regeneration_estimate_usd} secondary={false} size="sm" />
                    </>
                  ) : null}{" "}
                  · new total duration {impact.new_total_duration_s.toFixed(1)} s
                </p>
              </>
            ) : (
              <ul className="list-disc pl-4">
                {impact.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        <ErrorBanner message={error ?? actions.error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={preview} disabled={checking}>
            {checking ? "Checking…" : "Check impact"}
          </Button>
          <Button onClick={apply} disabled={!impact?.valid || actions.busy !== null}>
            Apply and re-plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StoryboardCards({
  detail,
  actions,
  onChanged,
  editable,
}: {
  detail: RunDetail;
  actions: RunActions;
  onChanged: () => void;
  editable: boolean;
}) {
  const [editing, setEditing] = useState<ShotView | null>(null);
  const [pendingOp, setPendingOp] = useState<{ title: string; req: StoryboardEditRequest } | null>(
    null,
  );
  const [impact, setImpact] = useState<EditImpact | null>(null);
  const [regen, setRegen] = useState(false);
  const sb = detail.artifacts.storyboard;
  if (!sb) return <p className="text-sm text-fg-muted">The storyboard has not been written yet.</p>;
  const voiceLines = new Map((detail.artifacts.voice?.lines ?? []).map((l) => [l.line_id, l.text]));
  const shots = detail.shots;
  async function openOp(title: string, req: StoryboardEditRequest) {
    setPendingOp({ title, req });
    setImpact(null);
    try {
      setImpact(await actions.previewEdit(req));
    } catch {
      setImpact(null);
    }
  }
  return (
    <div className="space-y-4">
      <SectionTitle
        title="Storyboard"
        description={`${sb.shots.length} shots · ${sb.total_duration_s.toFixed(1)} s · risk ${sb.risk.verdict} (${sb.risk.score})${sb.visual_through_line ? ` · ${sb.visual_through_line}` : ""}`}
        right={
          editable ? (
            <Button variant="secondary" size="sm" onClick={() => setRegen(true)}>
              <RefreshCw /> Regenerate storyboard
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shots.map((shot) => {
          const s = shot.storyboard;
          if (!s) return null;
          const narration = s.narration_line_ids.map((id) => voiceLines.get(id)).filter(Boolean);
          return (
            <Card key={shot.shot_id} className="flex flex-col">
              {shot.keyframe_url ? (
                <img
                  src={
                    shot.keyframe_url.startsWith("http")
                      ? shot.keyframe_url
                      : `${process.env.NEXT_PUBLIC_STUDIO_API_URL ?? "http://127.0.0.1:4747"}${shot.keyframe_url}`
                  }
                  alt=""
                  className="aspect-[9/16] max-h-56 w-full rounded-t-xl object-cover"
                />
              ) : null}
              <CardHeader className="pb-1">
                <div>
                  <CardTitle className="uppercase tracking-wide">
                    {shot.shot_id.replace("shot_", "Shot ")}
                  </CardTitle>
                  <p className="text-xs text-fg-muted num">
                    {formatTimecode(shot.start_s)}–{formatTimecode(shot.end_s)} ·{" "}
                    {s.duration_s.toFixed(1)} s{s.hero_moment ? " · hero moment" : ""}
                  </p>
                </div>
                <Badge variant={shot.animation.kind === "GEN_VIDEO" ? "info" : "muted"}>
                  {shot.animation.kind === "GEN_VIDEO"
                    ? `FLUX → ${shot.animation.model.split("/").slice(0, 2).join("/")}`
                    : shot.animation.kind === "STILL_MOTION"
                      ? "FLUX + motion"
                      : "FLUX still"}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-2 text-sm">
                <div>
                  <p className="text-[11px] font-medium uppercase text-fg-subtle">Purpose</p>
                  <p>{s.shot_intent}</p>
                </div>
                {narration.length ? (
                  <div>
                    <p className="text-[11px] font-medium uppercase text-fg-subtle">Narration</p>
                    <p className="italic text-fg">“{narration.join(" ")}”</p>
                  </div>
                ) : (
                  <p className="text-xs text-fg-subtle">Silent shot</p>
                )}
                <div>
                  <p className="text-[11px] font-medium uppercase text-fg-subtle">Visual</p>
                  <p>{s.description}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase text-fg-subtle">Camera</p>
                  <p className="text-fg-muted">
                    {titleCase(s.shot_size)}, {titleCase(s.angle)}, {titleCase(s.movement)},{" "}
                    {s.lens}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                  <span>Motion: {s.motion_need}</span>
                  <span>Role: {titleCase(s.narrative_role)}</span>
                </div>
                {shot.references.length ? (
                  <div>
                    <p className="text-[11px] font-medium uppercase text-fg-subtle">
                      Product references
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {shot.references.map((r) => (
                        <Badge key={r.path} variant="outline">
                          {r.view ? titleCase(r.view) : r.path.split("/").pop()}
                          {r.identity_critical ? " ★" : ""}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-auto flex items-center justify-between border-t border-border pt-2">
                  <span className="text-xs text-fg-muted">Expected cost</span>
                  <Money usd={shot.expected_cost_usd} approx source="ESTIMATED" size="sm" />
                </div>
                {editable ? (
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(shot)}>
                      <Pencil /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        openOp(`Duplicate ${shot.shot_id}`, {
                          shots: [{ id: `${shot.shot_id}_copy`, duplicate_of: shot.shot_id }],
                          order: [
                            ...shots
                              .map((x) => x.shot_id)
                              .flatMap((id) =>
                                id === shot.shot_id ? [id, `${shot.shot_id}_copy`] : [id],
                              ),
                          ],
                        })
                      }
                    >
                      <Copy /> Duplicate
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={shot.index === 0}
                      onClick={() =>
                        openOp(`Move ${shot.shot_id} up`, {
                          shots: [],
                          order: (() => {
                            const ids = shots.map((x) => x.shot_id);
                            const i = shot.index;
                            [ids[i - 1], ids[i]] = [ids[i] as string, ids[i - 1] as string];
                            return ids;
                          })(),
                        })
                      }
                    >
                      <GripVertical /> Move up
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() =>
                        openOp(`Delete ${shot.shot_id}`, {
                          shots: [{ id: shot.shot_id, delete: true }],
                        })
                      }
                    >
                      <Trash2 /> Delete
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {editing ? (
        <ShotEditDialog
          key={editing.shot_id}
          shot={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          actions={actions}
          onApplied={onChanged}
        />
      ) : null}
      {pendingOp ? (
        <Dialog open onOpenChange={(o) => !o && setPendingOp(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{pendingOp.title}</DialogTitle>
              <DialogDescription>
                Shots are renumbered in order, so shots after the change get new ids and are
                produced again if they already had keyframes.
              </DialogDescription>
            </DialogHeader>
            {impact ? (
              impact.valid ? (
                <div className="rounded-md border border-border bg-surface-2 p-3 text-xs">
                  <p>
                    {impact.regenerated_shots.length} shot(s) will be (re)produced;{" "}
                    {impact.kept_shots.length} kept. Continuity ~
                    <Money usd={impact.continuity_llm_estimate_usd} secondary={false} size="sm" />
                    {impact.regeneration_estimate_usd > 0 ? (
                      <>
                        {" "}
                        + regeneration ~
                        <Money usd={impact.regeneration_estimate_usd} secondary={false} size="sm" />
                      </>
                    ) : null}
                    .
                  </p>
                </div>
              ) : (
                <div className="rounded-md border border-danger/30 bg-danger-bg p-3 text-xs text-danger">
                  <ul className="list-disc pl-4">
                    {impact.issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </div>
              )
            ) : (
              <p className="text-xs text-fg-muted">Checking impact…</p>
            )}
            <ErrorBanner message={actions.error} />
            <DialogFooter>
              <Button variant="secondary" onClick={() => setPendingOp(null)}>
                Cancel
              </Button>
              <Button
                disabled={!impact?.valid || actions.busy !== null}
                onClick={async () => {
                  const r = await actions.applyEdit(pendingOp.req);
                  if (r) {
                    setPendingOp(null);
                    onChanged();
                  }
                }}
              >
                Apply
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      <ConfirmSpendDialog
        open={regen}
        onOpenChange={setRegen}
        title="Regenerate the whole storyboard?"
        description={`This calls ${detail.manifest.providers.llm_creative.model} again and re-plans continuity and routing. Existing keyframes stay on disk but every shot is produced again.`}
        loadEstimate={() => actions.estimate("storyboard")}
        confirmLabel="Regenerate storyboard"
        busy={actions.busy === "regenerate-storyboard"}
        onConfirm={async () => {
          const r = await actions.regenerateStoryboard();
          if (r) {
            setRegen(false);
            onChanged();
          }
        }}
      />
      <div className="text-xs text-fg-subtle">
        <Wand2 className="mr-1 inline h-3 w-3" />
        Shot count, camera language, FLUX vs H3 routing and pacing were decided by the Creative
        Director, Storyboard artist and Router from the brand direction.
      </div>
    </div>
  );
}
