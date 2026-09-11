"use client";

import type { DashboardView } from "@pipeline/studio/api-types";
import { ArrowRight, Pencil, PlusCircle } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/money";
import { RunRow } from "@/components/run-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  Progress,
  SectionTitle,
  Skeleton,
  Stat,
} from "@/components/ui/misc";
import { useApi } from "@/hooks/use-api";
import { fileUrl } from "@/lib/api";
import { useStudio } from "@/lib/studio-context";
import { cn, formatInt } from "@/lib/utils";

function BudgetCard({
  title,
  rows,
  progress,
}: {
  title: string;
  rows: Array<{
    label: string;
    usd: number | null;
    tone?: "ok" | "warn" | "danger";
    hint?: string;
  }>;
  progress?: number | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-fg-muted">{r.label}</span>
            <span
              className={cn(
                "num text-sm font-medium",
                r.tone === "ok" && "text-ok",
                r.tone === "warn" && "text-warn",
                r.tone === "danger" && "text-danger",
              )}
            >
              {r.usd == null ? (
                <span className="text-fg-subtle">no limit</span>
              ) : (
                <Money usd={r.usd} secondary={false} size="sm" />
              )}
            </span>
          </div>
        ))}
        {progress != null ? (
          <Progress
            value={progress}
            tone={progress >= 100 ? "warn" : progress >= 80 ? "warn" : "accent"}
            className="mt-1"
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { brandId, brand } = useStudio();
  const { data, error, loading } = useApi<DashboardView>(
    brandId ? `/api/brands/${brandId}/dashboard` : null,
    { refreshMs: 5000, deps: [brandId] },
  );
  if (!brandId)
    return (
      <EmptyState
        title="No brand selected"
        description="Add a brand under brands/<id>/brand.yaml and restart the studio."
      />
    );
  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }
  if (error && !data) return <ErrorBanner message={`Could not load the dashboard: ${error}`} />;
  if (!data) return null;
  const { budget, usage_today: today, totals } = data;
  const wallet = budget.wallet;
  const daily = budget.daily;
  const two = budget.two_day;
  const tone = (
    available: number | null,
    limit: number | null,
  ): "ok" | "warn" | "danger" | undefined => {
    if (available == null || limit == null) return undefined;
    if (available <= 0) return "danger";
    if (available < limit * 0.2) return "warn";
    return "ok";
  };
  const pct = (w: typeof wallet) =>
    w.limit_usd ? ((w.spent_usd + w.held_usd) / w.limit_usd) * 100 : null;
  const logo = fileUrl(data.brand.logo_url);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`${data.brand.name} today`}
        description="What is happening with this brand right now: budget, active work, and recent videos."
        right={
          <>
            <Button variant="secondary" asChild>
              <Link href="/brand">
                <Pencil /> Edit Brand Direction
              </Link>
            </Button>
            <Button asChild>
              <Link href="/create">
                <PlusCircle /> Create Video
              </Link>
            </Button>
          </>
        }
      />

      {budget.notices.length ? (
        <div className="space-y-2">
          {budget.notices
            .filter((n) => n.code !== "unconfigured")
            .map((n) => (
              <div
                key={n.code}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm",
                  n.level === "critical"
                    ? "border-danger/30 bg-danger-bg text-danger"
                    : n.level === "warning"
                      ? "border-warn/30 bg-warn-bg text-warn"
                      : "border-info/20 bg-info-bg text-info",
                )}
              >
                {n.message}
              </div>
            ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_2fr]">
        <Card className="overflow-hidden">
          <div
            className="h-1.5"
            style={{
              background: `linear-gradient(90deg, ${data.brand.colors.primary}, ${data.brand.colors.accent})`,
            }}
          />
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-lg font-semibold text-white"
                style={{ background: data.brand.colors.primary }}
              >
                {logo ? (
                  <img src={logo} alt="" className="h-full w-full rounded-lg object-contain" />
                ) : (
                  data.brand.name.slice(0, 1)
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{data.brand.name}</h2>
                <p className="text-xs text-fg-muted">{data.brand.tagline}</p>
              </div>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-xs text-fg-muted">Audience</dt>
                <dd>{data.brand.audience}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Current creative direction</dt>
                <dd className="line-clamp-4 text-fg">{data.brand.direction_summary}</dd>
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {data.brand.tone.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1 text-xs text-fg-subtle">
                <span>BrandProfile version</span>
                <span className="mono">{data.brand.version}</span>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3">
          <BudgetCard
            title="Production wallet"
            rows={[
              { label: "Wallet", usd: wallet.limit_usd },
              { label: "Spent total", usd: wallet.spent_usd },
              { label: "Reserved by active jobs", usd: wallet.held_usd },
              {
                label: "Available",
                usd: wallet.available_usd,
                tone: tone(wallet.available_usd, wallet.limit_usd),
              },
            ]}
            progress={pct(wallet)}
          />
          <BudgetCard
            title="Today"
            rows={[
              { label: "Today's budget", usd: daily.limit_usd },
              { label: "Today's spend", usd: daily.spent_usd },
              { label: "Reserved", usd: daily.held_usd },
              {
                label: "Remaining today",
                usd: daily.available_usd,
                tone: tone(daily.available_usd, daily.limit_usd),
              },
            ]}
            progress={pct(daily)}
          />
          <BudgetCard
            title="48 hours"
            rows={[
              { label: "48-hour budget", usd: two.limit_usd },
              { label: "48-hour spend", usd: two.spent_usd },
              { label: "Reserved", usd: two.held_usd },
              {
                label: "Remaining",
                usd: two.available_usd,
                tone: tone(two.available_usd, two.limit_usd),
              },
            ]}
            progress={pct(two)}
          />
          <p className="text-[11px] text-fg-subtle sm:col-span-3">
            The wallet is an internal accounting budget: it decides whether the studio may spend,
            nothing is stored or transferred to OpenAI, fal or Cartesia.
            {budget.settings.count_mock_runs
              ? " Simulated (mock) runs are counted."
              : " Simulated runs are excluded."}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <SectionTitle
            title="Activity"
            description="Latest runs for this brand"
            right={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/videos">
                  All videos <ArrowRight />
                </Link>
              </Button>
            }
          />
          <Card>
            <CardContent className="p-2">
              {data.recent_runs.length ? (
                <div className="divide-y divide-border">
                  {data.recent_runs.map((r) => (
                    <RunRow key={r.run_id} run={r} compact />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No videos yet"
                  description="Create the first video for this brand. Planning runs the creative director, script, voice and storyboard before any paid media generation."
                  action={
                    <Button asChild>
                      <Link href="/create">Create Video</Link>
                    </Button>
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <SectionTitle title="Usage today" />
          <Card>
            <CardContent className="pt-4">
              {today.by_provider.length ? (
                <ul className="space-y-1.5">
                  {today.by_provider.map((p) => (
                    <li
                      key={`${p.provider}:${p.model}`}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate text-fg-muted">
                        {p.provider} <span className="text-fg-subtle">{p.model}</span>
                      </span>
                      <Money usd={p.usd} secondary={false} size="sm" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-subtle">No spend yet today.</p>
              )}
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Videos completed"
              value={formatInt(totals.videos_completed)}
              hint={today.videos_completed ? `${today.videos_completed} today` : undefined}
            />
            <Stat
              label="Avg finished-video cost"
              value={
                totals.average_video_cost_usd == null ? (
                  "—"
                ) : (
                  <Money
                    usd={totals.average_video_cost_usd}
                    secondary={false}
                    size="sm"
                    className="text-xl"
                  />
                )
              }
            />
            <Stat
              label="AI video seconds"
              value={`${Math.round(totals.ai_video_seconds)} s`}
              hint={`${Math.round(today.ai_video_seconds)} s today`}
            />
            <Stat
              label="Images generated"
              value={formatInt(totals.images_generated)}
              hint={`${today.images_generated} today`}
            />
            <Stat
              label="Failed / retried"
              value={`${formatInt(totals.failed_generations)} / ${formatInt(today.retried_generations)}`}
              hint="failed total / retried today"
              tone={totals.failed_generations ? "warn" : undefined}
            />
          </div>
        </div>
      </div>
      {!brand?.voice_configured ? (
        <p className="text-xs text-fg-subtle">
          Narration voice id is still a placeholder in brand.yaml; live narration will need a
          Cartesia or ElevenLabs voice id.
        </p>
      ) : null}
    </div>
  );
}
