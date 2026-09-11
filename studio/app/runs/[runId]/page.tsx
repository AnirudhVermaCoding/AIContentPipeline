"use client";

import { AlertTriangle, ArrowLeft, Ban, Check, Pause, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { RunDetail } from "@pipeline/studio/api-types";
import { Money } from "@/components/money";
import { useRunActions } from "@/components/run/actions";
import { AnimationView } from "@/components/run/animation";
import { CostsView } from "@/components/run/costs";
import { FinalVideo } from "@/components/run/final-video";
import { KeyframeGrid } from "@/components/run/keyframes";
import { PipelineRail } from "@/components/run/pipeline-rail";
import { PreflightPanel, StoryboardCards } from "@/components/run/plan-review";
import { ProvenanceView } from "@/components/run/provenance";
import { RenderView } from "@/components/run/render-view";
import { JobStateNote, RunStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner, Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/hooks/use-api";
import { useMoney } from "@/components/money";

const LIVE = new Set(["planning", "producing", "rendering"]);

function defaultTab(d: RunDetail): string {
  switch (d.run.ui_status) {
    case "awaiting_storyboard_approval":
      return "plan";
    case "awaiting_keyframe_approval":
      return "keyframes";
    case "rendering":
      return "render";
    case "complete":
      return "video";
    case "producing":
      return d.run.current_stage === "animate" ? "animation" : "keyframes";
    default:
      return "pipeline";
  }
}

export default function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { data, error, loading, refresh } = useApi<RunDetail>(`/api/runs/${runId}`, { refreshMs: 1500, deps: [runId] });
  const actions = useRunActions(runId, refresh);
  const [tab, setTab] = useState<string | null>(null);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [budgetRaise, setBudgetRaise] = useState("");
  const m = useMoney();
  const live = data ? LIVE.has(data.run.ui_status) && !!data.run.job?.alive : false;
  useEffect(() => {
    if (data && tab === null) setTab(defaultTab(data));
  }, [data, tab]);
  const lastStatus = useMemo(() => data?.run.ui_status, [data?.run.ui_status]);
  useEffect(() => {
    // Follow the run as it moves between phases unless the operator is elsewhere.
    if (!data) return;
    if (lastStatus === "awaiting_keyframe_approval") setTab("keyframes");
    if (lastStatus === "awaiting_storyboard_approval") setTab("plan");
    if (lastStatus === "complete")
      setTab((t) =>
        t === "pipeline" || t === "render" || t === "animation" || t === "keyframes" ? "video" : t,
      );
  }, [lastStatus]);

  if (loading && !data) return <Skeleton className="h-64" />;
  if (error && !data) return <ErrorBanner message={error} />;
  if (!data) return null;
  const d = data;
  const job = d.run.job;
  const canResume = ["paused", "interrupted", "failed", "budget_conflict", "stopped", "cancelled"].includes(d.run.ui_status) && !live;
  const budgetConflict = d.run.ui_status === "budget_conflict";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/videos" className="mb-1 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg">
            <ArrowLeft className="h-3 w-3" /> Videos
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{d.run.title}</h1>
            <RunStatusBadge run={d.run} />
            {d.run.provider_mode === "mock" ? <Badge variant="muted">simulated providers</Badge> : null}
          </div>
          <p className="text-sm text-fg-muted">
            {d.brand.name}
            {d.run.product_name ? ` · ${d.run.product_name}` : ""} · {d.run.topic} · <span className="mono text-xs">{d.run.run_id}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 text-right">
            <div className="text-[10px] uppercase tracking-wide text-fg-subtle">{live ? "Spent so far" : "Actual cost"}</div>
            <Money usd={d.costs.actual_usd} size="lg" />
          </div>
          {live ? (
            <>
              <Button variant="secondary" onClick={() => actions.pause()} disabled={!!job?.pause_requested_at || actions.busy !== null}>
                <Pause /> Pause after current operation
              </Button>
              <Button variant="danger" onClick={() => actions.cancel()} disabled={!!job?.cancel_requested_at || actions.busy !== null}>
                <Ban /> Cancel run
              </Button>
            </>
          ) : null}
          {canResume ? (
            <Button onClick={() => (budgetConflict ? setResumeOpen(true) : actions.resume())} disabled={actions.busy !== null}>
              <Play /> {d.run.ui_status === "failed" ? "Retry from failure" : "Resume"}
            </Button>
          ) : null}
          {d.run.ui_status === "awaiting_storyboard_approval" ? (
            <Button onClick={() => actions.approveStoryboard()} disabled={actions.busy !== null || !d.preflight?.budget.ok}>
              <Check /> Approve storyboard & start production
            </Button>
          ) : null}
          {!live && d.run.ui_status !== "complete" ? (
            <Button variant="ghost" onClick={() => actions.abort()} disabled={actions.busy !== null} title="Mark this run as cancelled">
              <RotateCcw /> Abort
            </Button>
          ) : null}
        </div>
      </div>
      <ErrorBanner message={actions.error} />
      <JobStateNote job={job} />
      {d.run.last_error && !live ? (
        <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{d.run.ui_status === "budget_conflict" ? "Budget conflict" : "Stopped with an error"}</p>
            <p className="text-xs">{d.run.last_error}</p>
            <p className="mt-1 text-xs">Money consumed so far: <Money usd={d.costs.actual_usd} secondary={false} size="sm" />. Successful stages and shots are kept; resuming only redoes what failed.</p>
          </div>
        </div>
      ) : null}

      <Tabs value={tab ?? "pipeline"} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="plan">Plan & storyboard</TabsTrigger>
          <TabsTrigger value="keyframes">Keyframes{d.approvals.keyframes_pending ? ` (${d.approvals.keyframes_pending})` : ""}</TabsTrigger>
          <TabsTrigger value="animation">Animation</TabsTrigger>
          <TabsTrigger value="render">Render</TabsTrigger>
          <TabsTrigger value="video">Video</TabsTrigger>
          <TabsTrigger value="costs">Costs</TabsTrigger>
          <TabsTrigger value="provenance">Provenance</TabsTrigger>
        </TabsList>
        <TabsContent value="pipeline">
          <div className="card p-4">
            <PipelineRail detail={d} />
          </div>
        </TabsContent>
        <TabsContent value="plan" className="space-y-6">
          {d.preflight ? <PreflightPanel preflight={d.preflight} detail={d} /> : null}
          {d.run.ui_status === "awaiting_storyboard_approval" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
              <div>
                <p className="text-sm font-medium">Review the storyboard, then approve to start paid generation.</p>
                <p className="text-xs text-fg-muted">Edits re-run continuity only for the shots you change. Approval starts keyframes; animation waits for your keyframe approval.</p>
              </div>
              <Button onClick={() => actions.approveStoryboard()} disabled={actions.busy !== null || !d.preflight?.budget.ok}>
                <Check /> Approve storyboard & start production
              </Button>
            </div>
          ) : null}
          <StoryboardCards detail={d} actions={actions} onChanged={refresh} editable={!live && d.run.ui_status !== "complete" && !!d.artifacts.storyboard} />
        </TabsContent>
        <TabsContent value="keyframes">
          <KeyframeGrid detail={d} actions={actions} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="animation">
          <AnimationView detail={d} actions={actions} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="render">
          <RenderView detail={d} />
        </TabsContent>
        <TabsContent value="video">
          <FinalVideo detail={d} actions={actions} onTab={setTab} />
        </TabsContent>
        <TabsContent value="costs">
          <CostsView detail={d} />
        </TabsContent>
        <TabsContent value="provenance">
          <ProvenanceView detail={d} />
        </TabsContent>
      </Tabs>

      <Dialog open={resumeOpen} onOpenChange={setResumeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resume with a higher per-video cap?</DialogTitle>
            <DialogDescription>
              The router could not fit the plan inside the current cap (<Money usd={d.run.hard_cap_usd} secondary={false} size="sm" />). Raise it for this run only, or pick a cheaper alternative on the Plan tab. Daily and wallet limits still apply.
            </DialogDescription>
          </DialogHeader>
          <Input type="number" placeholder={`New cap in ${m.primary}`} value={budgetRaise} onChange={(e) => setBudgetRaise(e.target.value)} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setResumeOpen(false)}>Cancel</Button>
            <Button onClick={async () => { const usd = budgetRaise ? Number(budgetRaise) / (m.primary === "USD" ? 1 : m.rate) : null; const r = await actions.resume({ budget_override_usd: usd }); if (r) setResumeOpen(false); }} disabled={!budgetRaise || actions.busy !== null}>
              Resume
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
