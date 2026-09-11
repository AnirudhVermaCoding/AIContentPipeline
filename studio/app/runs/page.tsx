"use client";

import Link from "next/link";
import type { RunSummary } from "@pipeline/studio/api-types";
import { RunRow } from "@/components/run-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorBanner, PageHeader, SectionTitle, Skeleton } from "@/components/ui/misc";
import { useApi } from "@/hooks/use-api";
import { useStudio } from "@/lib/studio-context";

const LIVE = new Set(["planning", "producing", "rendering"]);
const WAITING = new Set(["awaiting_storyboard_approval", "awaiting_keyframe_approval", "paused", "interrupted", "budget_conflict"]);

export default function ActiveRunsPage() {
  const { brandId } = useStudio();
  const { data, error, loading } = useApi<RunSummary[]>(brandId ? `/api/runs?brand=${brandId}&limit=100` : null, { refreshMs: 3000, deps: [brandId] });
  const runs = data ?? [];
  const live = runs.filter((r) => LIVE.has(r.ui_status));
  const waiting = runs.filter((r) => WAITING.has(r.ui_status));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Active runs"
        description="Everything that is generating right now or waiting on you."
        right={
          <Button asChild>
            <Link href="/create">Create Video</Link>
          </Button>
        }
      />
      <ErrorBanner message={error} />
      {loading && !data ? <Skeleton className="h-32" /> : null}
      <div>
        <SectionTitle title="Generating" description={`${live.length} running`} />
        <Card>
          <CardContent className="p-2">
            {live.length ? (
              <div className="divide-y divide-border">
                {live.map((r) => (
                  <RunRow key={r.run_id} run={r} />
                ))}
              </div>
            ) : (
              <EmptyState title="Nothing is running" description="Runs appear here while the pipeline works on them." />
            )}
          </CardContent>
        </Card>
      </div>
      <div>
        <SectionTitle title="Needs attention" description="Approvals, paused runs, budget conflicts and interruptions" />
        <Card>
          <CardContent className="p-2">
            {waiting.length ? (
              <div className="divide-y divide-border">
                {waiting.map((r) => (
                  <RunRow key={r.run_id} run={r} />
                ))}
              </div>
            ) : (
              <EmptyState title="Nothing waiting on you" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
