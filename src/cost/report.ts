import * as fs from "node:fs";
import * as path from "node:path";
import { PRICING_AS_OF, pricingIsStale } from "../config/pricing.js";
import { controlsForRun } from "../creative/controls.js";
import type { GenerationRow } from "../db/repos.js";
import type { RunContext } from "../pipeline/run.js";
import { loadShotRecord } from "../pipeline/shots.js";
import { FinalQcReportSchema } from "../schema/qc.js";
import { RoutingPlanSchema } from "../schema/routing.js";
import { StoryboardArtifactSchema } from "../schema/storyboard.js";
import { exists, readJson } from "../util/fs.js";

export interface CostReport {
  run_id: string;
  brand_id: string;
  topic: string;
  status: string;
  final_video: string | null;
  qc_status: string | null;
  cost: {
    hard_cap_usd: number;
    target_usd: number;
    estimated_usd: number;
    spent_usd: number;
    headroom_usd: number;
    by_kind: Record<string, { calls: number; usd: number }>;
    by_stage: Record<string, { usd: number; duration_ms: number | null; status: string }>;
  };
  generation: {
    ai_video_seconds: number;
    keyframes: number;
    keyframe_retries: number;
    video_clips: number;
    tts_characters: number;
    llm_tokens_in: number;
    llm_tokens_out: number;
  };
  generations: Array<{
    stage: string;
    shot: string | null;
    kind: string;
    provider: string;
    model: string;
    label: string | null;
    status: string;
    est_usd: number;
    actual_usd: number | null;
    latency_ms: number | null;
    duration_s: number | null;
    resolution: string | null;
    prompt_version: string | null;
  }>;
  decisions: Array<{ stage: string; subject: string; reason: string }>;
  pricing_as_of: string;
  pricing_stale: boolean;
  /** The creative controls this run generated with (absent on runs from before the controls). */
  creative: {
    creative_freedom: number;
    goal_focus: number;
    creative_label: string;
    goal_label: string;
    candidate_count: number | null;
    source: "run" | "legacy";
  } | null;
}

function creativeReport(run: RunContext): CostReport["creative"] {
  const o = run.manifest.options;
  const legacy = o.creative_freedom == null || o.goal_focus == null;
  const c = controlsForRun(run);
  const file = path.join(run.runDir, "00_brief", "director.json");
  const director = exists(file) ? readJson<{ candidate_count?: number }>(file) : null;
  return {
    creative_freedom: c.creative_freedom,
    goal_focus: c.goal_focus,
    creative_label: c.creative_label,
    goal_label: c.goal_label,
    candidate_count: director?.candidate_count ?? null,
    source: legacy ? "legacy" : "run",
  };
}

export function buildReport(run: RunContext): CostReport {
  const m = run.manifest;
  const rows: GenerationRow[] = run.repos.listGenerations(run.runId);
  const byKind: CostReport["cost"]["by_kind"] = {};
  let tokensIn = 0;
  let tokensOut = 0;
  let ttsChars = 0;
  for (const r of rows) {
    if (r.status !== "completed") continue;
    const k = byKind[r.kind] ?? { calls: 0, usd: 0 };
    k.calls += 1;
    k.usd += r.actual_cost_usd ?? 0;
    byKind[r.kind] = k;
    if (r.kind === "llm" && r.usage) {
      tokensIn += Number(r.usage.inputTokens ?? 0);
      tokensOut += Number(r.usage.outputTokens ?? 0);
    }
    if (r.kind === "tts" && r.prompt_hash) ttsChars += 0;
  }
  const byStage: CostReport["cost"]["by_stage"] = {};
  for (const [id, st] of Object.entries(m.stages)) {
    byStage[id] = {
      usd: Math.round(st.cost_usd * 1000) / 1000,
      duration_ms: st.duration_ms,
      status: st.status,
    };
  }

  let aiVideoSeconds = 0;
  let keyframes = 0;
  let keyframeRetries = 0;
  let clips = 0;
  if (run.hasOutput("04_storyboard")) {
    const sb = run.readOutput("04_storyboard", StoryboardArtifactSchema);
    const plan = run.hasOutput("06_route") ? run.readOutput("06_route", RoutingPlanSchema) : null;
    for (const shot of sb.shots) {
      const rec = loadShotRecord(run, shot.id);
      if (!rec) continue;
      const kf = rec.attempts.filter((a) => a.kind === "keyframe");
      if (rec.keyframe) keyframes += 1;
      keyframeRetries += Math.max(0, kf.length - 1);
      if (rec.final?.kind === "video") {
        clips += 1;
        aiVideoSeconds +=
          plan?.shots.find((r) => r.shot_id === shot.id)?.video_seconds ??
          rec.final.meta.duration_s;
      }
    }
  }
  if (run.hasOutput("03_voice")) {
    const voice = readJson<{ characters?: number }>(run.outputPath("03_voice"));
    ttsChars = voice.characters ?? 0;
  }
  const qc = run.hasOutput("12_final_qc")
    ? run.readOutput("12_final_qc", FinalQcReportSchema)
    : null;
  const finalVideo = exists(run.abs("11_render/final.mp4")) ? "11_render/final.mp4" : null;
  const spent = run.budget.spentUsd;
  // The report stage runs before the runner marks the run done; reflect that in the report.
  const othersDone = Object.entries(m.stages)
    .filter(([id]) => id !== "report")
    .every(([, st]) => st.status === "done");
  const status = m.status === "running" && othersDone ? "done" : m.status;

  return {
    run_id: m.run_id,
    brand_id: m.brand_id,
    topic: m.topic,
    status,
    final_video: finalVideo,
    qc_status: qc?.status ?? null,
    cost: {
      hard_cap_usd: m.cost.hard_cap_usd,
      target_usd: m.cost.target_usd,
      estimated_usd: m.cost.estimated_usd,
      spent_usd: Math.round(spent * 1000) / 1000,
      headroom_usd: Math.round((m.cost.hard_cap_usd - spent) * 1000) / 1000,
      by_kind: byKind,
      by_stage: byStage,
    },
    generation: {
      ai_video_seconds: aiVideoSeconds,
      keyframes,
      keyframe_retries: keyframeRetries,
      video_clips: clips,
      tts_characters: ttsChars,
      llm_tokens_in: tokensIn,
      llm_tokens_out: tokensOut,
    },
    generations: rows.map((r) => ({
      stage: r.stage_id,
      shot: r.shot_id,
      kind: r.kind,
      provider: r.provider,
      model: r.model,
      label: r.label,
      status: r.status,
      est_usd: Math.round(r.est_cost_usd * 10000) / 10000,
      actual_usd: r.actual_cost_usd === null ? null : Math.round(r.actual_cost_usd * 10000) / 10000,
      latency_ms: r.latency_ms,
      duration_s: r.duration_s,
      resolution: r.resolution,
      prompt_version: r.prompt_version,
    })),
    decisions: run.events
      .decisions()
      .map((d) => ({ stage: d.stage, subject: d.subject, reason: d.reason })),
    pricing_as_of: PRICING_AS_OF,
    pricing_stale: pricingIsStale(),
    creative: creativeReport(run),
  };
}

const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : `$${n.toFixed(3)}`;

export function renderMarkdown(r: CostReport): string {
  const lines: string[] = [];
  lines.push(`# Cost report — ${r.brand_id} / ${r.run_id}`, "");
  lines.push(
    `Topic: ${r.topic}`,
    `Status: ${r.status}${r.qc_status ? ` · QC: ${r.qc_status}` : ""}`,
    `Video: ${r.final_video ?? "not rendered"}`,
    "",
  );
  lines.push("## Budget", "", "| | USD |", "|---|---|");
  lines.push(
    `| Hard cap | ${usd(r.cost.hard_cap_usd)} |`,
    `| Target | ${usd(r.cost.target_usd)} |`,
    `| Estimated at routing | ${usd(r.cost.estimated_usd)} |`,
    `| **Spent** | **${usd(r.cost.spent_usd)}** |`,
    `| Headroom | ${usd(r.cost.headroom_usd)} |`,
    "",
  );
  lines.push("## Spend by kind", "", "| Kind | Calls | USD |", "|---|---|---|");
  for (const [k, v] of Object.entries(r.cost.by_kind))
    lines.push(`| ${k} | ${v.calls} | ${usd(v.usd)} |`);
  lines.push(
    "",
    "## Generation",
    "",
    `- Generated video: ${r.generation.ai_video_seconds}s across ${r.generation.video_clips} clip(s)`,
    `- Keyframes: ${r.generation.keyframes} (+${r.generation.keyframe_retries} retries)`,
    `- Narration: ${r.generation.tts_characters} characters`,
    `- LLM tokens: ${r.generation.llm_tokens_in} in / ${r.generation.llm_tokens_out} out`,
    "",
  );
  lines.push("## Stages", "", "| Stage | Status | Time | USD |", "|---|---|---|---|");
  for (const [id, s] of Object.entries(r.cost.by_stage))
    lines.push(
      `| ${id} | ${s.status} | ${s.duration_ms === null ? "-" : `${(s.duration_ms / 1000).toFixed(1)}s`} | ${usd(s.usd)} |`,
    );
  lines.push(
    "",
    "## Generations",
    "",
    "| Stage | Shot | Kind | Provider / model | Label | Status | Est | Actual | Latency | Prompt v |",
    "|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const g of r.generations) {
    lines.push(
      `| ${g.stage} | ${g.shot ?? ""} | ${g.kind} | ${g.provider} / ${g.model} | ${g.label ?? ""} | ${g.status} | ${usd(g.est_usd)} | ${usd(g.actual_usd)} | ${g.latency_ms === null ? "-" : `${g.latency_ms} ms`} | ${g.prompt_version ?? ""} |`,
    );
  }
  lines.push("", "## Decisions", "");
  for (const d of r.decisions) lines.push(`- **${d.stage} / ${d.subject}**: ${d.reason}`);
  lines.push(
    "",
    `Prices as of ${r.pricing_as_of}${r.pricing_stale ? " (STALE: refresh src/config/pricing.ts)" : ""}.`,
    "",
  );
  return lines.join("\n");
}

export function writeReport(
  run: RunContext,
  dir: string,
): { json: string; md: string; report: CostReport } {
  const report = buildReport(run);
  const json = path.join(dir, "report.json");
  const md = path.join(dir, "report.md");
  fs.writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(md, renderMarkdown(report));
  return { json, md, report };
}
