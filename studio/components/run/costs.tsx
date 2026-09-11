"use client";

import type { CallSummary, RunDetail } from "@pipeline/studio/api-types";
import { CostSourceBadge, Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionTitle, Table, Td, Th, Tr } from "@/components/ui/misc";
import { formatDate, formatInt, formatMs } from "@/lib/utils";

function usageText(c: CallSummary): string {
  const u = c.usage ?? {};
  const parts: string[] = [];
  if (u.input_tokens != null) parts.push(`${formatInt(u.input_tokens)} in`);
  if (u.output_tokens != null) parts.push(`${formatInt(u.output_tokens)} out`);
  if (u.image_count) parts.push(`${u.image_count} image`);
  if (u.video_seconds) parts.push(`${u.video_seconds} s video`);
  if (u.audio_characters) parts.push(`${formatInt(u.audio_characters)} chars`);
  if (!parts.length && c.duration_s) parts.push(`${c.duration_s} s`);
  return parts.join(" · ") || "—";
}

function sourceExplanation(c: CallSummary): string {
  if (c.status === "reserved") return "in flight: estimate";
  if (c.cost_source === "PROVIDER_REPORTED") return "provider-reported usage";
  const u = c.usage ?? {};
  if (u.video_seconds) return `calculated from ${u.video_seconds} s × current ${c.model} rate`;
  if (u.image_count)
    return `calculated from ${u.image_count} image at ${c.resolution ?? "output"} size`;
  if (u.input_tokens != null)
    return `calculated from ${formatInt(u.input_tokens)} + ${formatInt(u.output_tokens ?? 0)} tokens`;
  if (u.audio_characters) return `calculated from ${formatInt(u.audio_characters)} characters`;
  return c.cost_source === "CALCULATED_FROM_USAGE" ? "calculated from usage" : "";
}

export function CostsView({ detail }: { detail: RunDetail }) {
  const c = detail.costs;
  const outcomeVariant = (o: CallSummary["outcome"]) =>
    o === "used" ? "ok" : o === "superseded" ? "warn" : o === "failed" ? "danger" : "info";
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Video total</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-sm">
              {[
                ["Original estimate (at routing)", c.original_estimate_usd, "ESTIMATED" as const],
                ["Reserved (maximum exposure)", c.reserved_usd, null],
                ["Successful generations", c.successful_usd, null],
                ["Failed / retried work", c.failed_usd + c.retry_usd, null],
                ["Actual total", c.actual_usd, null],
                ["Returned reservation", c.returned_usd, null],
              ].map(([label, usd, src]) => (
                <div
                  key={label as string}
                  className={`flex items-baseline justify-between ${label === "Actual total" ? "border-t border-border pt-1.5 font-semibold" : ""}`}
                >
                  <dt className="text-fg-muted">{label as string}</dt>
                  <dd>
                    {usd == null ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <Money usd={usd as number} source={src as "ESTIMATED" | null} size="sm" />
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {c.unknown_usd > 0 ? (
              <p className="mt-2 text-xs text-warn">
                {<Money usd={c.unknown_usd} secondary={false} size="sm" />} of this is from calls
                that were in flight when a job died; the estimate was kept because the charge is
                unknown.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {(
                Object.entries(c.by_source) as Array<[CallSummary["cost_source"] & string, number]>
              ).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1">
                  <CostSourceBadge source={k} /> <Money usd={v} secondary={false} size="sm" />
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-fg-subtle">
              Prices from the table dated {c.pricing_version}
              {c.pricing_stale ? " (stale: refresh src/config/pricing.ts)" : ""} · USD is canonical;{" "}
              {c.fx.currency} shown at {c.fx.rate} per USD.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By provider and model</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <thead>
                <tr className="border-b border-border">
                  <Th>Provider / model</Th>
                  <Th>Calls</Th>
                  <Th>Usage</Th>
                  <Th className="text-right">USD</Th>
                </tr>
              </thead>
              <tbody>
                {c.by_model.map((m) => (
                  <Tr key={`${m.provider}:${m.model}`}>
                    <Td>
                      <span className="font-medium">{m.provider}</span>{" "}
                      <span className="text-fg-muted">{m.model}</span>
                    </Td>
                    <Td className="num">{m.calls}</Td>
                    <Td className="text-xs text-fg-muted">
                      {usageText({ usage: m.usage } as CallSummary)}
                    </Td>
                    <Td className="text-right">
                      <Money usd={m.usd} size="sm" />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By stage</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <thead>
                <tr className="border-b border-border">
                  <Th>Stage</Th>
                  <Th>Calls</Th>
                  <Th>Failed</Th>
                  <Th className="text-right">USD</Th>
                </tr>
              </thead>
              <tbody>
                {c.by_stage.map((s) => (
                  <Tr key={s.stage_id}>
                    <Td>{s.label}</Td>
                    <Td className="num">{s.calls}</Td>
                    <Td className="num">{s.failed || ""}</Td>
                    <Td className="text-right">
                      <Money usd={s.usd} size="sm" />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By shot</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <thead>
                <tr className="border-b border-border">
                  <Th>Shot</Th>
                  <Th className="text-right">Used</Th>
                  <Th className="text-right">Wasted</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {c.by_shot.map((s) => (
                  <Tr key={s.shot_id}>
                    <Td>{s.shot_id.replace("shot_", "Shot ")}</Td>
                    <Td className="text-right">
                      <Money usd={s.successful_usd} secondary={false} size="sm" />
                    </Td>
                    <Td className="text-right">
                      {s.wasted_usd ? (
                        <Money
                          usd={s.wasted_usd}
                          secondary={false}
                          size="sm"
                          className="text-warn"
                        />
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <Money usd={s.usd} secondary={false} size="sm" />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <div>
        <SectionTitle
          title="Every provider call"
          description="One row per paid call, exactly as recorded in the ledger."
        />
        <Card>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr className="border-b border-border">
                  <Th>When</Th>
                  <Th>Stage · shot</Th>
                  <Th>Provider / model</Th>
                  <Th>Usage</Th>
                  <Th>Duration</Th>
                  <Th className="text-right">Estimate</Th>
                  <Th className="text-right">Actual</Th>
                  <Th>Source</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody>
                {c.calls.map((x) => (
                  <Tr key={x.id}>
                    <Td className="whitespace-nowrap text-xs text-fg-muted">
                      {formatDate(x.started_at)}
                    </Td>
                    <Td className="text-xs">
                      {x.stage_id}
                      {x.shot_id ? ` · ${x.shot_id}` : ""}
                      <div className="text-fg-subtle">{x.label}</div>
                    </Td>
                    <Td className="text-xs">
                      {x.provider} <span className="text-fg-muted">{x.model}</span>
                      {x.request_id ? (
                        <div className="mono text-[10px] text-fg-subtle">{x.request_id}</div>
                      ) : null}
                    </Td>
                    <Td className="text-xs text-fg-muted">{usageText(x)}</Td>
                    <Td className="text-xs num">{formatMs(x.latency_ms)}</Td>
                    <Td className="text-right text-xs">
                      <Money usd={x.est_cost_usd} secondary={false} size="sm" />
                    </Td>
                    <Td className="text-right text-xs">
                      {x.actual_cost_usd == null ? (
                        <span className="text-fg-subtle">pending</span>
                      ) : (
                        <Money usd={x.actual_cost_usd} secondary={false} size="sm" />
                      )}
                    </Td>
                    <Td className="text-xs">
                      <CostSourceBadge source={x.cost_source} />
                      <div className="text-[10px] text-fg-subtle">{sourceExplanation(x)}</div>
                    </Td>
                    <Td>
                      <Badge variant={outcomeVariant(x.outcome)}>{x.outcome}</Badge>
                      {x.reconciled ? (
                        <div className="text-[10px] text-warn">{x.reconciled}</div>
                      ) : null}
                      {x.error ? (
                        <div
                          className="max-w-[220px] truncate text-[10px] text-danger"
                          title={x.error}
                        >
                          {x.error}
                        </div>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
