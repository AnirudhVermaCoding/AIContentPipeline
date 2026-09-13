#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { listBrandIds, loadBrand } from "../brand/loader.js";
import { listProducts } from "../brand/products.js";
import { BudgetLedger } from "../budget/ledger.js";
import { loadEnv, providerMode } from "../config/env.js";
import { buildReport, renderMarkdown } from "../cost/report.js";
import { controlsForRun, describeControls } from "../creative/controls.js";
import { Repos } from "../db/repos.js";
import { openDb } from "../db/sqlite.js";
import { addTrack, loadMusicLibrary, musicDir } from "../media/music.js";
import { applyKeyframeDecisions, type KeyframeDecision } from "../pipeline/approval.js";
import { attachProviders } from "../pipeline/attach.js";
import { createRun, openRun, type RunContext } from "../pipeline/run.js";
import { type RunResult, resetFrom, runStages } from "../pipeline/runner.js";
import { loadShotRecord } from "../pipeline/shots.js";
import { ALL_STAGES } from "../pipeline/stages/index.js";
import { FinalQcReportSchema } from "../schema/qc.js";
import { StoryboardArtifactSchema } from "../schema/storyboard.js";
import { BudgetWindowError } from "../util/errors.js";

loadEnv();

/**
 * Run the stages under the brand's wallet / daily / 48-hour rules, exactly like a studio job:
 * hold the maximum exposure, release it to actual spend afterwards. A refused hold exits with
 * the budget-conflict code and names the rule.
 */
async function runUnderBudget(run: RunContext, label: string): Promise<RunResult> {
  const ledger = new BudgetLedger(openDb());
  const hold = Math.max(0, run.manifest.cost.hard_cap_usd - run.budget.spentUsd);
  let reservationId: number | null = null;
  try {
    reservationId = ledger.admit({
      brandId: run.manifest.brand_id,
      runId: run.runId,
      jobId: null,
      holdUsd: hold,
      providerMode: run.options.provider_mode,
      label,
    }).reservationId;
  } catch (err) {
    if (err instanceof BudgetWindowError) {
      console.log(`BUDGET_CONFLICT (${err.rule}): ${err.message}`);
      console.log(
        "Adjust the brand's wallet / daily / 48-hour limits in the studio (Budget & Usage) or wait for the window to pass.",
      );
      return process.exit(4);
    }
    throw err;
  }
  run.budgetHold = { reservationId };
  let result: RunResult | null = null;
  try {
    result = await runStages(run, ALL_STAGES);
    return result;
  } finally {
    ledger.release(reservationId, result?.status ?? "failed", run.budget.spentUsd);
  }
}

const program = new Command();
program
  .name("aicp")
  .description("Local-first multi-brand AI short-form video pipeline")
  .version("0.1.0");

function exitFor(result: RunResult, run: RunContext): never {
  const dir = path.relative(process.cwd(), run.runDir);
  console.log("");
  if (result.status === "done") {
    const qc = run.hasOutput("12_final_qc")
      ? run.readOutput("12_final_qc", FinalQcReportSchema)
      : null;
    console.log(`Done. Video: ${dir}/final.mp4  Report: ${dir}/report.md`);
    console.log(
      `Spent $${run.budget.spentUsd.toFixed(3)} of $${run.manifest.cost.hard_cap_usd.toFixed(2)}; QC ${qc?.status ?? "n/a"}.`,
    );
    return process.exit(qc?.status === "fail" ? 2 : 0);
  }
  if (result.status === "stopped") {
    console.log(`Stopped after ${result.lastStage}: ${result.message ?? ""}`);
    console.log(`Inspect: pnpm cli inspect ${run.runId}   Continue: pnpm cli resume ${run.runId}`);
    return process.exit(0);
  }
  if (result.status === "waiting_approval") {
    console.log(result.message ?? "waiting for approval");
    return process.exit(3);
  }
  if (result.status === "budget_conflict") {
    console.log(`BUDGET_CONFLICT: ${result.message ?? ""}`);
    console.log(
      `See ${dir}/06_route/output.json for alternatives. Raise the cap with: pnpm cli resume ${run.runId} --budget <usd>`,
    );
    return process.exit(4);
  }
  console.log(`Failed at ${result.lastStage}: ${result.message ?? ""}`);
  console.log(`Fix the cause, then: pnpm cli resume ${run.runId}`);
  return process.exit(1);
}

program
  .command("brands")
  .description("List configured brands")
  .action(() => {
    for (const id of listBrandIds()) {
      const b = loadBrand(id);
      console.log(
        `${id.padEnd(14)} ${b.profile.name} — ${b.profile.product.category}; pillars: ${b.profile.content_pillars.map((p) => p.id).join(", ")}; edit bias ${b.profile.edit_defaults.mode_bias}; text ${b.profile.text_policy.captions}; version ${b.version}`,
      );
      for (const p of listProducts(b.dir)) {
        const refs = p.references.filter((r) => r.exists).length;
        console.log(
          `  product ${p.profile.id.padEnd(20)} ${p.profile.name} (${refs} reference image${refs === 1 ? "" : "s"})`,
        );
      }
    }
  });

program
  .command("run")
  .description("Produce a video for a brand and topic")
  .requiredOption("--brand <id>", "brand id (folder under brands/)")
  .requiredOption("--topic <text>", "topic or subject")
  .option("--goal <text>", "what the video should achieve")
  .option("--product <id>", "product from brands/<brand>/products to feature")
  .option("--title <text>", "title shown in the studio (defaults to the topic)")
  .option("--pin-brand", "freeze the brand profile at creation for every later resume", false)
  .option("--budget <usd>", "override the absolute hard cap", Number.parseFloat)
  .option(
    "--ai-video-seconds <n>",
    "override the soft target of generated video seconds",
    Number.parseFloat,
  )
  .option(
    "--approve-keyframes",
    "pause for human approval of keyframes before any animation",
    false,
  )
  .option(
    "--creative-freedom <0-1>",
    "how adventurous the creative direction may be (brand default, else 0.65)",
    Number.parseFloat,
  )
  .option(
    "--goal-focus <0-1>",
    "how strongly every decision serves the goal (brand default, else 0.85)",
    Number.parseFloat,
  )
  .option("--dry-run", "plan and estimate only; stop before the first paid media generation", false)
  .option("--until <stage>", "stop after this stage id")
  .option("--mock", "use offline mock providers (also PROVIDER_MODE=mock)", false)
  .option("--quiet", "less console output", false)
  .action(async (opts) => {
    const mode = opts.mock ? "mock" : providerMode();
    for (const [flag, value] of [
      ["--creative-freedom", opts.creativeFreedom],
      ["--goal-focus", opts.goalFocus],
    ] as const) {
      if (value !== undefined && !(Number.isFinite(value) && value >= 0 && value <= 1)) {
        console.error(`${flag} must be a number between 0 and 1`);
        process.exit(1);
      }
    }
    const run = createRun({
      brandId: opts.brand,
      topic: opts.topic,
      goal: opts.goal ?? null,
      productId: opts.product ?? null,
      title: opts.title ?? null,
      createdBy: "cli",
      options: {
        provider_mode: mode,
        approve_keyframes: opts.approveKeyframes,
        budget_override_usd: Number.isFinite(opts.budget) ? opts.budget : null,
        ai_video_seconds_override: Number.isFinite(opts.aiVideoSeconds)
          ? opts.aiVideoSeconds
          : null,
        until: opts.until ?? null,
        dry_run: opts.dryRun,
        brand_source: opts.pinBrand ? "snapshot" : "live",
        ...(Number.isFinite(opts.creativeFreedom)
          ? { creative_freedom: opts.creativeFreedom }
          : {}),
        ...(Number.isFinite(opts.goalFocus) ? { goal_focus: opts.goalFocus } : {}),
      },
      quiet: opts.quiet,
    });
    attachProviders(run, mode);
    const creative = controlsForRun(run);
    console.log(
      `Run ${run.runId} for ${run.brand.profile.name} (${mode} providers, cap $${run.manifest.cost.hard_cap_usd.toFixed(2)}, ${describeControls(creative)})`,
    );
    const result = await runUnderBudget(run, `cli run ${run.runId}`);
    exitFor(result, run);
  });

program
  .command("resume <run_id>")
  .description("Continue a run after a failure, a budget stop or an approval pause")
  .option("--budget <usd>", "raise the absolute hard cap", Number.parseFloat)
  .option("--approve-keyframes", "turn the approval gate on")
  .option("--no-approve-keyframes", "turn the approval gate off")
  .option("--pin-brand", "use the brand profile frozen when the run was created")
  .option("--adopt-brand", "use the live brand file (re-runs stages it affects)")
  .option("--quiet", "less console output", false)
  .action(async (runId, opts) => {
    const patch: Record<string, unknown> = { until: null };
    if (Number.isFinite(opts.budget)) patch.budget_override_usd = opts.budget;
    if (opts.approveKeyframes === true) patch.approve_keyframes = true;
    if (opts.approveKeyframes === false) patch.approve_keyframes = false;
    const brandSource = opts.pinBrand ? "snapshot" : opts.adoptBrand ? "live" : undefined;
    const run = openRun(runId, { options: patch, quiet: opts.quiet, brandSource });
    attachProviders(run, run.options.provider_mode);
    const result = await runUnderBudget(run, `cli resume ${runId}`);
    exitFor(result, run);
  });

program
  .command("rerun <run_id>")
  .description("Re-run from a stage onward (unchanged shots are reused)")
  .requiredOption("--from <stage>", "stage id to restart from")
  .option("--quiet", "less console output", false)
  .action(async (runId, opts) => {
    const run = openRun(runId, { options: { until: null }, quiet: opts.quiet });
    attachProviders(run, run.options.provider_mode);
    const reset = resetFrom(run, ALL_STAGES, opts.from);
    console.log(`Reset: ${reset.join(", ")}`);
    const result = await runUnderBudget(run, `cli rerun ${runId}`);
    exitFor(result, run);
  });

program
  .command("approve <run_id>")
  .description("Approve pending keyframes; reject specific shots with a note")
  .option("--reject <shot:note...>", "shot id and note, e.g. --reject shot_03:'too dark'")
  .action((runId, opts) => {
    const run = openRun(runId, { quiet: true });
    const decisions: KeyframeDecision[] = [];
    for (const r of (opts.reject as string[] | undefined) ?? []) {
      const [id, ...note] = r.split(":");
      if (id)
        decisions.push({ shotId: id, decision: "reject", note: note.join(":") || "rejected" });
    }
    const summary = applyKeyframeDecisions(run, decisions, {
      approveRemainingPending: true,
      actor: "cli",
    });
    console.log(
      `Approved ${summary.approved}, rejected ${summary.rejected}. Continue with: pnpm cli resume ${runId}`,
    );
  });

program
  .command("inspect <run_id>")
  .description("Show stage status, shots and cost")
  .action((runId) => {
    const run = openRun(runId, { quiet: true });
    const m = run.manifest;
    console.log(
      `${m.run_id}  ${m.brand_id}  "${m.topic}"  status=${m.status}  dir=${path.relative(process.cwd(), run.runDir)}`,
    );
    console.log(
      `cap $${m.cost.hard_cap_usd.toFixed(2)}  estimated $${m.cost.estimated_usd.toFixed(2)}  spent $${run.budget.spentUsd.toFixed(3)}`,
    );
    console.log(describeControls(controlsForRun(run)));
    console.log("\nStages:");
    for (const s of ALL_STAGES) {
      const st = m.stages[s.id];
      const t = st?.duration_ms == null ? "" : `${(st.duration_ms / 1000).toFixed(1)}s`;
      console.log(
        `  ${s.id.padEnd(12)} ${(st?.status ?? "pending").padEnd(16)} ${t.padEnd(8)} $${(st?.cost_usd ?? 0).toFixed(3)}${st?.error ? `  ${st.error}` : ""}`,
      );
    }
    if (run.hasOutput("04_storyboard")) {
      const sb = run.readOutput("04_storyboard", StoryboardArtifactSchema);
      console.log("\nShots:");
      for (const shot of sb.shots) {
        const rec = loadShotRecord(run, shot.id);
        console.log(
          `  ${shot.id}  ${(rec?.status ?? "-").padEnd(17)} ${(rec?.source ?? "").padEnd(12)} ${rec?.final?.path ?? rec?.keyframe?.path ?? ""}  ${rec ? `$${rec.cost_usd.toFixed(3)}` : ""}${rec?.approval.status === "pending" ? "  [awaiting approval]" : ""}`,
        );
      }
    }
    if (m.last_error) console.log(`\nLast error: ${m.last_error}`);
  });

program
  .command("report <run_id>")
  .description("Print the cost report")
  .action((runId) => {
    const run = openRun(runId, { quiet: true });
    console.log(renderMarkdown(buildReport(run)));
  });

const music = program.command("music").description("Manage the royalty-free music library");
music
  .command("add <file>")
  .description("Copy a track into assets/music, measure it and register it")
  .option("--id <id>", "track id (defaults to the file name)")
  .requiredOption("--tags <tags>", "comma-separated mood tags, e.g. warm,acoustic,ukulele")
  .option("--energy <level>", "low | medium | high", "low")
  .option("--license <text>", "licence, e.g. CC0")
  .option("--source <url>", "where it came from")
  .action(async (file, opts) => {
    const energy = ["low", "medium", "high"].includes(opts.energy) ? opts.energy : "low";
    const t = await addTrack({
      file: path.resolve(file),
      id: opts.id,
      moodTags: String(opts.tags).split(","),
      energy,
      license: opts.license,
      source: opts.source,
    });
    console.log(
      `Added ${t.id} (${t.duration_s}s, ${t.energy}, tags: ${t.mood_tags.join(", ")}) to ${musicDir()}`,
    );
  });
music
  .command("list")
  .description("List library tracks")
  .action(() => {
    const tracks = loadMusicLibrary();
    if (!tracks.length) {
      console.log(
        `No tracks yet. Add one with: pnpm cli music add <file.mp3> --tags warm,acoustic --energy low`,
      );
      return;
    }
    for (const t of tracks)
      console.log(
        `${t.id.padEnd(24)} ${String(t.duration_s).padStart(6)}s  ${t.energy.padEnd(6)} ${t.mood_tags.join(", ")}${t.license ? `  [${t.license}]` : ""}`,
      );
  });

program
  .command("runs")
  .description("List recent runs")
  .option("--limit <n>", "how many", Number.parseInt, 20)
  .action((opts) => {
    const repos = new Repos(openDb());
    for (const r of repos.listRuns(opts.limit)) {
      console.log(
        `${r.run_id}  ${r.brand_id.padEnd(12)} ${r.status.padEnd(16)} $${r.spent_usd.toFixed(3)}  ${r.topic}${fs.existsSync(path.join(r.run_dir, "final.mp4")) ? "  [video]" : ""}`,
      );
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
