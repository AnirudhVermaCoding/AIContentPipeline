import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { brandsRoot, listBrandIds, loadBrand } from "../brand/loader.js";
import { BudgetLedger } from "../budget/ledger.js";
import { runsDir } from "../config/env.js";
import { Repos } from "../db/repos.js";
import type { Db } from "../db/sqlite.js";
import {
  applyKeyframeDecisions,
  approveStoryboard,
  type KeyframeDecision,
  requestClipRegeneration,
  selectClipVersion,
  selectKeyframeVersion,
  useStillForShot,
} from "../pipeline/approval.js";
import { createRun } from "../pipeline/run.js";
import type { VariationStrength } from "../schema/creative.js";
import { nowIso, readJsonl } from "../util/fs.js";
import type {
  CreateVideoRequest,
  RegenerateConceptRequest,
  RegenerateShotRequest,
  RegenerateStoryboardRequest,
  RegenerationEstimate,
  RunListFilters,
  StoryboardEditRequest,
} from "./api-types.js";
import { JobSupervisor, type SpawnOptions } from "./jobs.js";
import {
  brandDetail,
  listBrands,
  readBrandVersionFile,
  saveBrandProfile,
} from "./service/brand.js";
import { STAGE_ORDER } from "./service/common.js";
import { createVideo } from "./service/create.js";
import { parseVariation, runRequestView, STUDIO_REQUEST_FILE } from "./service/creative.js";
import { dashboardView } from "./service/dashboard.js";
import { regenerationEstimate } from "./service/estimates.js";
import { healthReport } from "./service/health.js";
import {
  addProductReference,
  getProductView,
  listProductViews,
  updateProductReference,
  upsertProduct,
} from "./service/products.js";
import {
  auditRows,
  jobView,
  listRuns,
  openRunForStudio,
  runDetail,
  runExists,
  type StudioContext,
  summaryFromManifest,
} from "./service/runs.js";
import { ensureDefaultFx, getStudioSettings, updateStudioSettings } from "./service/settings.js";
import {
  applyEdit,
  computeEdit,
  requestConceptRegeneration,
  requestStoryboardRegeneration,
  requestStoryboardShotRegeneration,
} from "./service/storyboard.js";

/**
 * The studio API: JSON over HTTP on 127.0.0.1 for the Next.js app, plus artifact streaming.
 * Every route reads the same SQLite/run-directory state the pipeline writes; nothing here
 * invents progress or spend.
 */

export interface AppOptions {
  /** Origins allowed to call mutating routes (the Next dev/prod server). */
  origins?: string[];
  spawn?: SpawnOptions;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
};

function safeFile(root: string, rel: string): string | null {
  if (rel.includes("\0")) return null;
  const abs = path.resolve(root, rel);
  if (!fs.existsSync(abs) || !fs.existsSync(root)) return null;
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(abs);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
  if (!fs.statSync(real).isFile()) return null;
  if (!(path.extname(real).toLowerCase() in MIME)) return null;
  return real;
}

export function createStudioContext(db: Db, spawnOpts?: SpawnOptions): StudioContext {
  ensureDefaultFx(db);
  const ctx: StudioContext = {
    db,
    repos: new Repos(db),
    ledger: new BudgetLedger(db),
    jobs: new JobSupervisor(db, spawnOpts),
  };
  seedBudgetDefaults(ctx);
  return ctx;
}

/** First time the studio sees a brand: take its wallet defaults from brand.yaml into the ledger. */
export function seedBudgetDefaults(ctx: StudioContext): void {
  for (const id of listBrandIds()) {
    if (ctx.ledger.getSettings(id)) continue;
    let wallet: ReturnType<typeof loadBrand>["profile"]["budget"]["wallet"];
    try {
      wallet = loadBrand(id).profile.budget.wallet;
    } catch {
      continue;
    }
    if (!wallet) continue;
    ctx.ledger.saveSettings(
      id,
      {
        currency: wallet.currency,
        wallet_amount: wallet.amount,
        daily_amount: wallet.daily,
        two_day_amount: wallet.two_day,
        timezone: wallet.timezone,
        wallet_since: nowIso(),
      },
      "system",
    );
  }
}

async function json<T>(c: { req: { json(): Promise<unknown> } }): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HTTPException(400, { message: "invalid JSON body" });
  }
}

export function createApp(ctx: StudioContext, opts: AppOptions = {}): Hono {
  const app = new Hono();
  const origins = opts.origins ?? ["http://localhost:3000", "http://127.0.0.1:3000"];
  app.use(
    "*",
    cors({
      origin: origins,
      allowHeaders: ["Content-Type", "X-Studio-Client"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  // A local API is still reachable by any web page: mutations need the studio header and a
  // loopback Host so a stray browser tab cannot spend money.
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS") {
      const host = (c.req.header("host") ?? "").split(":")[0] ?? "";
      if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host))
        throw new HTTPException(403, { message: "studio API only accepts local requests" });
      if (c.req.header("x-studio-client") !== "1")
        throw new HTTPException(403, { message: "missing X-Studio-Client header" });
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    const status = /not found/i.test(err.message) ? 404 : 400;
    return c.json(
      { error: err.message, issues: (err as Error & { issues?: string[] }).issues ?? undefined },
      status,
    );
  });

  // ---- health / settings --------------------------------------------------------------------
  app.get("/api/health", async (c) =>
    c.json(
      await healthReport(ctx.db, c.req.query("brand") ?? null, {
        probe: c.req.query("probe") === "1",
      }),
    ),
  );
  app.get("/api/settings", (c) => c.json(getStudioSettings(ctx.db)));
  app.put("/api/settings", async (c) => c.json(updateStudioSettings(ctx.db, await json(c))));
  app.get("/api/pricing", (c) => c.json(getStudioSettings(ctx.db).pricing));

  // ---- brands & products --------------------------------------------------------------------
  app.get("/api/brands", (c) => c.json(listBrands()));
  app.get("/api/brands/:brand", (c) => c.json(brandDetail(ctx.db, c.req.param("brand"))));
  app.get("/api/brands/:brand/dashboard", async (c) =>
    c.json(await dashboardView(ctx, c.req.param("brand"))),
  );
  app.put("/api/brands/:brand/profile", async (c) => {
    const body = await json<{ profile: unknown; note?: string | null }>(c);
    return c.json(
      saveBrandProfile(ctx.db, c.req.param("brand"), body.profile, { note: body.note ?? null }),
    );
  });
  app.get("/api/brands/:brand/versions/:version", (c) => {
    const text = readBrandVersionFile(c.req.param("brand"), c.req.param("version"), ctx.db);
    if (!text) throw new HTTPException(404, { message: "version file not found" });
    return c.text(text, 200, { "Content-Type": "text/yaml; charset=utf-8" });
  });
  app.get("/api/brands/:brand/products", (c) =>
    c.json(listProductViews(ctx.db, c.req.param("brand"))),
  );
  app.post("/api/brands/:brand/products", async (c) =>
    c.json(
      upsertProduct(ctx.db, c.req.param("brand"), (await json<{ profile: unknown }>(c)).profile),
    ),
  );
  app.get("/api/brands/:brand/products/:product", (c) =>
    c.json(getProductView(ctx.db, c.req.param("brand"), c.req.param("product"))),
  );
  app.put("/api/brands/:brand/products/:product", async (c) => {
    const body = await json<{ profile: Record<string, unknown> }>(c);
    return c.json(
      upsertProduct(ctx.db, c.req.param("brand"), { ...body.profile, id: c.req.param("product") }),
    );
  });
  app.post(
    "/api/brands/:brand/products/:product/references",
    bodyLimit({ maxSize: 25 * 1024 * 1024 }),
    async (c) => {
      const body = await c.req.parseBody({ all: false });
      const file = body.file;
      if (!(file instanceof File))
        throw new HTTPException(400, { message: "multipart field 'file' is required" });
      const data = Buffer.from(await file.arrayBuffer());
      const view = typeof body.view === "string" ? body.view : undefined;
      const identity = body.identity_critical === "true" || body.identity_critical === "1";
      const note = typeof body.note === "string" ? body.note : undefined;
      return c.json(
        await addProductReference(
          ctx.db,
          c.req.param("brand"),
          c.req.param("product"),
          { name: file.name, data },
          { view, identity_critical: identity, note },
        ),
      );
    },
  );
  app.patch("/api/brands/:brand/products/:product/references", async (c) => {
    const body = await json<{
      path: string;
      view?: string;
      identity_critical?: boolean;
      note?: string;
      remove?: boolean;
    }>(c);
    return c.json(
      updateProductReference(ctx.db, c.req.param("brand"), c.req.param("product"), body.path, body),
    );
  });

  // ---- budget -------------------------------------------------------------------------------
  app.get("/api/budget/:brand", (c) => c.json(ctx.ledger.status(c.req.param("brand"))));
  app.put("/api/budget/:brand/settings", async (c) => {
    const body = await json<Record<string, unknown>>(c);
    const patch: Record<string, unknown> = {};
    for (const k of [
      "currency",
      "wallet_amount",
      "daily_amount",
      "two_day_amount",
      "wallet_since",
      "count_mock_runs",
      "timezone",
    ])
      if (k in body) patch[k] = body[k];
    ctx.ledger.saveSettings(c.req.param("brand"), patch);
    return c.json(ctx.ledger.status(c.req.param("brand")));
  });
  app.get("/api/budget/:brand/ledger", (c) =>
    c.json(ctx.ledger.ledgerRows(c.req.param("brand"), Number(c.req.query("limit") ?? 200))),
  );

  // ---- runs ---------------------------------------------------------------------------------
  app.get("/api/runs", (c) => {
    const q = c.req.query();
    const filters: RunListFilters = {
      brand: q.brand || undefined,
      product: q.product || undefined,
      status: q.status ? (q.status.split(",") as RunListFilters["status"]) : undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      min_usd: q.min_usd ? Number(q.min_usd) : undefined,
      max_usd: q.max_usd ? Number(q.max_usd) : undefined,
      model: q.model || undefined,
      qc: q.qc ? q.qc.split(",") : undefined,
      search: q.search || undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    };
    return c.json(listRuns(ctx, filters));
  });
  app.post("/api/runs", async (c) =>
    c.json(await createVideo(ctx, await json<CreateVideoRequest>(c))),
  );
  app.get("/api/jobs", (c) =>
    c.json(
      ctx.jobs
        .list({ brandId: c.req.query("brand") || undefined, live: c.req.query("live") === "1" })
        .map((j) => jobView(ctx.jobs, j)),
    ),
  );

  const requireRun = (id: string) => {
    if (!runExists(id)) throw new HTTPException(404, { message: `run ${id} not found` });
  };
  app.get("/api/runs/:id", (c) => {
    requireRun(c.req.param("id"));
    return c.json(runDetail(ctx, c.req.param("id")));
  });
  app.get("/api/runs/:id/events", (c) => {
    requireRun(c.req.param("id"));
    const run = openRunForStudio(c.req.param("id"));
    const after = Number(c.req.query("after") ?? 0);
    const all = readJsonl<Record<string, unknown>>(path.join(run.runDir, "events.jsonl"));
    return c.json({
      total: all.length,
      events: all.slice(after).map((e, i) => ({ index: after + i, ...e })),
    });
  });
  app.get("/api/runs/:id/audit", (c) => c.json(auditRows(ctx.db, c.req.param("id"))));
  app.get("/api/runs/:id/request", (c) => {
    requireRun(c.req.param("id"));
    return c.json(runRequestView(openRunForStudio(c.req.param("id"))));
  });
  app.get("/api/runs/:id/estimate", (c) => {
    requireRun(c.req.param("id"));
    const kind = c.req.query("kind") as RegenerationEstimate["kind"];
    if (
      !["keyframe", "clip", "storyboard", "continuity", "concept", "storyboard_shot"].includes(kind)
    )
      throw new HTTPException(400, {
        message: "kind must be keyframe|clip|storyboard|continuity|concept|storyboard_shot",
      });
    return c.json(
      regenerationEstimate(
        openRunForStudio(c.req.param("id")),
        ctx.ledger,
        kind,
        c.req.query("shot") ?? null,
      ),
    );
  });
  app.post("/api/runs/:id/storyboard/preview", async (c) => {
    requireRun(c.req.param("id"));
    return c.json(
      computeEdit(openRunForStudio(c.req.param("id")), await json<StoryboardEditRequest>(c)),
    );
  });

  const noLiveJob = (runId: string) => {
    const live = ctx.jobs.liveForRun(runId);
    if (live)
      throw new HTTPException(409, {
        message: `run has a live job (${live.status}); pause or wait for it first`,
      });
  };
  const resume = async (runId: string, reason: string, args: Record<string, unknown> = {}) => {
    const run = openRunForStudio(runId);
    const job = await ctx.jobs.enqueue("resume", runId, run.manifest.brand_id, { reason, ...args });
    return jobView(ctx.jobs, job);
  };
  const withRun = (runId: string) => {
    requireRun(runId);
    noLiveJob(runId);
    return openRunForStudio(runId);
  };
  const respond = (
    c: { json: (v: unknown) => Response },
    runId: string,
    extra: Record<string, unknown> = {},
  ) => {
    const run = openRunForStudio(runId);
    return c.json({ run: summaryFromManifest(ctx, run.manifest, run.runDir), ...extra });
  };

  app.post("/api/runs/:id/storyboard/edit", async (c) => {
    const run = withRun(c.req.param("id"));
    const impact = applyEdit(run, await json<StoryboardEditRequest>(c));
    if (!impact.valid) return c.json({ error: "storyboard invalid", impact }, 422);
    const body = impact;
    const job = await resume(run.runId, "storyboard edited: re-plan");
    return respond(c, run.runId, { impact: body, job });
  });
  app.post("/api/runs/:id/actions/approve-storyboard", async (c) => {
    const run = withRun(c.req.param("id"));
    if (!run.hasOutput("06_route"))
      throw new HTTPException(409, { message: "planning has not finished yet" });
    approveStoryboard(run);
    const job = await resume(run.runId, "storyboard approved: start production");
    return respond(c, run.runId, { job });
  });
  app.post("/api/runs/:id/actions/regenerate-storyboard", async (c) => {
    const run = withRun(c.req.param("id"));
    const body = await json<RegenerateStoryboardRequest>(c);
    const reset = requestStoryboardRegeneration(run, "local-user", {
      variation: parseVariation(body.variation),
      instruction: body.instruction?.trim() || null,
    });
    const job = await resume(run.runId, "regenerate storyboard");
    return respond(c, run.runId, { reset, job });
  });
  app.post("/api/runs/:id/actions/regenerate-concept", async (c) => {
    const run = withRun(c.req.param("id"));
    const body = await json<RegenerateConceptRequest>(c);
    const reset = requestConceptRegeneration(run, {
      variation: parseVariation(body.variation),
      instruction: body.instruction?.trim() || null,
      actor: "local-user",
    });
    const job = await resume(run.runId, "regenerate concept");
    return respond(c, run.runId, { reset, job });
  });
  app.post("/api/runs/:id/actions/storyboard/regenerate-shot", async (c) => {
    const run = withRun(c.req.param("id"));
    const body = await json<RegenerateShotRequest>(c);
    if (!body.shot_id) throw new HTTPException(400, { message: "shot_id is required" });
    const reset = requestStoryboardShotRegeneration(run, body.shot_id, {
      variation: parseVariation(body.variation, "small"),
      instruction: body.instruction?.trim() || null,
      actor: "local-user",
    });
    const job = await resume(run.runId, `rewrite ${body.shot_id}`);
    return respond(c, run.runId, { reset, job });
  });
  app.post("/api/runs/:id/actions/keyframes", async (c) => {
    const run = withRun(c.req.param("id"));
    const body = await json<{
      decisions: KeyframeDecision[];
      approve_remaining?: boolean;
      resume?: boolean;
    }>(c);
    const decisions = (body.decisions ?? []).map((d) => ({
      ...d,
      variation: d.variation == null ? null : parseVariation(d.variation),
    }));
    const summary = applyKeyframeDecisions(run, decisions, {
      approveRemainingPending: body.approve_remaining ?? false,
    });
    const job = body.resume === false ? null : await resume(run.runId, "keyframe decisions");
    return respond(c, run.runId, { summary, job });
  });
  app.post("/api/runs/:id/actions/keyframes/select-version", async (c) => {
    const run = withRun(c.req.param("id"));
    const body = await json<{ shot_id: string; attempt: number; resume?: boolean }>(c);
    const record = await selectKeyframeVersion(run, body.shot_id, body.attempt);
    const job = body.resume
      ? await resume(run.runId, `use keyframe v${body.attempt} for ${body.shot_id}`)
      : null;
    return respond(c, run.runId, { record, job });
  });
  app.post("/api/runs/:id/actions/clips/regenerate", async (c) => {
    const run = withRun(c.req.param("id"));
    const body = await json<{
      shot_id: string;
      instruction?: string | null;
      variation?: VariationStrength | null;
      resume?: boolean;
    }>(c);
    const record = requestClipRegeneration(
      run,
      body.shot_id,
      body.instruction ?? null,
      "local-user",
      body.variation == null ? null : parseVariation(body.variation),
    );
    const job =
      body.resume === false ? null : await resume(run.runId, `regenerate clip ${body.shot_id}`);
    return respond(c, run.runId, { record, job });
  });
  app.post("/api/runs/:id/actions/clips/select-version", async (c) => {
    const run = withRun(c.req.param("id"));
    const body = await json<{ shot_id: string; attempt: number; resume?: boolean }>(c);
    const record = await selectClipVersion(run, body.shot_id, body.attempt);
    const job =
      body.resume === false
        ? null
        : await resume(run.runId, `use clip v${body.attempt} for ${body.shot_id}`);
    return respond(c, run.runId, { record, job });
  });
  app.post("/api/runs/:id/actions/clips/use-still", async (c) => {
    const run = withRun(c.req.param("id"));
    const body = await json<{ shot_id: string; resume?: boolean }>(c);
    const record = await useStillForShot(run, body.shot_id);
    const job =
      body.resume === false ? null : await resume(run.runId, `use still for ${body.shot_id}`);
    return respond(c, run.runId, { record, job });
  });
  app.post("/api/runs/:id/actions/resume", async (c) => {
    const run = withRun(c.req.param("id"));
    const body = await json<{
      budget_override_usd?: number | null;
      adopt_brand?: boolean;
      approve_keyframes?: boolean;
    }>(c).catch(
      () =>
        ({}) as {
          budget_override_usd?: number | null;
          adopt_brand?: boolean;
          approve_keyframes?: boolean;
        },
    );
    const args: Record<string, unknown> = { options: {} };
    if (body.budget_override_usd != null) args.budget_override_usd = body.budget_override_usd;
    if (body.adopt_brand) args.brand_source = "live";
    if (body.approve_keyframes != null)
      (args.options as Record<string, unknown>).approve_keyframes = body.approve_keyframes;
    run.repos.audit({
      action: "run.resume",
      target_type: "run",
      target_id: run.runId,
      run_id: run.runId,
      details: body,
    });
    const job = await resume(run.runId, "resume", args);
    return respond(c, run.runId, { job });
  });
  app.post("/api/runs/:id/actions/rerun", async (c) => {
    const run = withRun(c.req.param("id"));
    const body = await json<{ from_stage: string }>(c);
    if (!STAGE_ORDER.includes(body.from_stage as (typeof STAGE_ORDER)[number]))
      throw new HTTPException(400, { message: "unknown stage" });
    const job = await ctx.jobs.enqueue("rerun", run.runId, run.manifest.brand_id, {
      from_stage: body.from_stage,
      reason: `rerun from ${body.from_stage}`,
    });
    return respond(c, run.runId, { job: jobView(ctx.jobs, job) });
  });
  app.post("/api/runs/:id/actions/pause", (c) => {
    const live = ctx.jobs.liveForRun(c.req.param("id"));
    if (!live) throw new HTTPException(409, { message: "no live job to pause" });
    return c.json({ job: jobView(ctx.jobs, ctx.jobs.requestPause(live.id)) });
  });
  app.post("/api/runs/:id/actions/cancel", (c) => {
    const live = ctx.jobs.liveForRun(c.req.param("id"));
    if (!live) throw new HTTPException(409, { message: "no live job to cancel" });
    return c.json({ job: jobView(ctx.jobs, ctx.jobs.requestCancel(live.id)) });
  });
  app.post("/api/runs/:id/actions/abort", (c) => {
    const run = withRun(c.req.param("id"));
    run.manifest.status = "stopped";
    run.manifest.stop_reason = "cancelled";
    run.save();
    run.repos.audit({
      action: "run.abort",
      target_type: "run",
      target_id: run.runId,
      run_id: run.runId,
    });
    return respond(c, run.runId);
  });
  app.post("/api/runs/:id/actions/duplicate", async (c) => {
    const src = openRunForStudio(c.req.param("id"));
    const m = src.manifest;
    const run = createRun({
      brandId: m.brand_id,
      productId: m.product_id ?? null,
      topic: m.topic,
      goal: m.goal,
      title: `${m.title ?? m.topic} (copy)`,
      createdBy: "studio",
      options: { ...m.options, until: null, dry_run: true, brand_source: "snapshot" },
      quiet: true,
    });
    // The stored Create Video request travels with the copy so it can be duplicated again.
    const requestFile = path.join(src.runDir, STUDIO_REQUEST_FILE);
    if (fs.existsSync(requestFile))
      fs.copyFileSync(requestFile, path.join(run.runDir, STUDIO_REQUEST_FILE));
    run.repos.audit({
      action: "run.duplicate",
      target_type: "run",
      target_id: run.runId,
      run_id: run.runId,
      details: { source: m.run_id },
    });
    const job = await ctx.jobs.enqueue("start", run.runId, m.brand_id, {
      reason: `duplicate of ${m.run_id}`,
    });
    return c.json({
      run: summaryFromManifest(ctx, run.manifest, run.runDir),
      job: jobView(ctx.jobs, job),
    });
  });
  app.post("/api/runs/:id/actions/open-folder", (c) => {
    const run = openRunForStudio(c.req.param("id"));
    const opener =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "explorer"
          : "xdg-open";
    try {
      const child = spawn(opener, [run.runDir], { detached: true, stdio: "ignore" });
      child.on("error", () => undefined);
      child.unref();
      return c.json({ ok: true, path: run.runDir });
    } catch (err) {
      return c.json({
        ok: false,
        path: run.runDir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ---- files --------------------------------------------------------------------------------
  const serve = (root: string) => (c: Context) => {
    const rel = decodeURIComponent(c.req.path.replace(/^\/files\/(runs|brands)\//, ""));
    const file = safeFile(root, rel);
    if (!file) return c.notFound();
    const size = fs.statSync(file).size;
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    c.header("Accept-Ranges", "bytes");
    c.header("Content-Type", type);
    c.header("Cache-Control", "private, max-age=60");
    const range = c.req.header("range");
    const toWeb = (s: fs.ReadStream) => Readable.toWeb(s) as unknown as ReadableStream;
    const send = (status: 200 | 206, open: () => fs.ReadStream) =>
      c.req.method === "HEAD" ? c.body(null, status) : c.body(toWeb(open()), status);
    if (!range) {
      c.header("Content-Length", String(size));
      return send(200, () => fs.createReadStream(file));
    }
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = m?.[1] ? Number(m[1]) : Number.NaN;
    let end = m?.[2] ? Number(m[2]) : size - 1;
    if (m && m[1] === "" && m[2]) {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    if (!m || Number.isNaN(start) || start > end || start >= size) {
      c.header("Content-Range", `bytes */${size}`);
      return c.body(null, 416);
    }
    end = Math.min(end, size - 1);
    c.header("Content-Range", `bytes ${start}-${end}/${size}`);
    c.header("Content-Length", String(end - start + 1));
    return send(206, () => fs.createReadStream(file, { start, end }));
  };
  app.on(["GET", "HEAD"], "/files/runs/*", serve(runsDir()));
  app.on(["GET", "HEAD"], "/files/brands/*", serve(brandsRoot()));

  app.get("/", (c) => c.json({ name: "AI Video Studio API", ok: true }));
  return app;
}
