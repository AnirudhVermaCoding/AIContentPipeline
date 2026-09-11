"use client";

import type { RunSummary } from "@pipeline/studio/api-types";
import { Film } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/money";
import { RunStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Progress, Table, Td, Th, Tr } from "@/components/ui/misc";
import { fileUrl } from "@/lib/api";
import { cn, formatDate, formatDuration, timeAgo } from "@/lib/utils";

export function RunThumb({ run, className }: { run: RunSummary; className?: string }) {
  const src = fileUrl(run.thumbnail_url);
  return (
    <div
      className={cn(
        "relative aspect-[9/16] w-12 shrink-0 overflow-hidden rounded-md bg-surface-2",
        className,
      )}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-fg-subtle">
          <Film className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

export function RunRow({ run, compact }: { run: RunSummary; compact?: boolean }) {
  const live = ["planning", "producing", "rendering"].includes(run.ui_status);
  return (
    <Link
      href={`/runs/${run.run_id}`}
      className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
    >
      <RunThumb run={run} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{run.title}</span>
          {run.provider_mode === "mock" ? <Badge variant="muted">simulated</Badge> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
          <RunStatusBadge run={run} />
          {live && run.current_stage_label ? <span>{run.current_stage_label}</span> : null}
          {!compact ? <span>{run.product_name ?? run.brand_name}</span> : null}
          <span>{timeAgo(run.updated_at)}</span>
        </div>
        {live ? (
          <Progress
            value={(run.stages_done / run.stages_total) * 100}
            tone="running"
            className="mt-1.5 h-1"
          />
        ) : null}
      </div>
      <div className="text-right">
        <Money usd={run.spent_usd} secondary={false} size="sm" className="font-medium" />
        {live ? <div className="text-[10px] text-fg-subtle">so far</div> : null}
      </div>
    </Link>
  );
}

export function RunTable({ runs }: { runs: RunSummary[] }) {
  if (!runs.length)
    return (
      <EmptyState title="No videos match" description="Adjust the filters or create a new video." />
    );
  return (
    <Table>
      <thead>
        <tr className="border-b border-border">
          <Th />
          <Th>Title</Th>
          <Th>Brand · Product</Th>
          <Th>Date</Th>
          <Th>Duration</Th>
          <Th className="text-right">Actual cost</Th>
          <Th>Status</Th>
          <Th>QC</Th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <Tr key={r.run_id}>
            <Td className="w-12">
              <Link href={`/runs/${r.run_id}`}>
                <RunThumb run={r} className="w-9" />
              </Link>
            </Td>
            <Td>
              <Link href={`/runs/${r.run_id}`} className="font-medium hover:underline">
                {r.title}
              </Link>
              <div className="text-xs text-fg-subtle">{r.run_id}</div>
            </Td>
            <Td className="text-fg-muted">
              {r.brand_name}
              {r.product_name ? ` · ${r.product_name}` : ""}
            </Td>
            <Td className="whitespace-nowrap text-fg-muted">{formatDate(r.created_at)}</Td>
            <Td className="num">{formatDuration(r.duration_s)}</Td>
            <Td className="text-right num">
              <Money usd={r.spent_usd} secondary={false} size="sm" />
            </Td>
            <Td>
              <RunStatusBadge run={r} />
            </Td>
            <Td>
              {r.qc_status ? (
                <Badge
                  variant={
                    r.qc_status === "pass" ? "ok" : r.qc_status === "fail" ? "danger" : "warn"
                  }
                >
                  {r.qc_status.replace(/_/g, " ")}
                </Badge>
              ) : (
                <span className="text-fg-subtle">—</span>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
