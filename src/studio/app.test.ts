import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, openDb } from "../db/sqlite.js";
import { loadShotRecord } from "../pipeline/shots.js";
import type { CreateVideoResponse, RunDetail, RunSummary } from "./api-types.js";
import { createApp, createStudioContext } from "./app.js";
import { executeJob } from "./job.js";
import { openRunForStudio } from "./service/runs.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicp-api-"));
let app: Hono;

beforeAll(() => {
  process.env.AICP_RUNS_DIR = path.join(tmp, "runs");
  process.env.AICP_DATA_DIR = path.join(tmp, "data");
  const ctx = createStudioContext(openDb(), {
    runner: async (id) => {
      await executeJob(id, { log: () => undefined });
    },
  });
  app = createApp(ctx);
});
afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const headers = {
  "Content-Type": "application/json",
  "X-Studio-Client": "1",
  Host: "127.0.0.1:4747",
};
const post = (url: string, body: unknown) =>
  app.request(url, { method: "POST", headers, body: JSON.stringify(body) });
const put = (url: string, body: unknown) =>
  app.request(url, { method: "PUT", headers, body: JSON.stringify(body) });

describe("studio API", () => {
  it("refuses mutations without the studio header", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1:4747" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("serves brands, health, settings and budget", async () => {
    const brands = await (await app.request("/api/brands")).json();
    expect(brands.map((b: { id: string }) => b.id)).toEqual(["bachalogy", "mindcode"]);
    const health = await (await app.request("/api/health?brand=bachalogy")).json();
    expect(health.providers).toHaveLength(5);
    expect(health.tools.some((t: { id: string }) => t.id === "sqlite")).toBe(true);
    expect(JSON.stringify(health)).not.toMatch(/sk-|FAL_KEY=/);
    const settings = await (await app.request("/api/settings")).json();
    expect(settings.display_currency).toBe("INR");
    expect(settings.fx.rate).toBeGreaterThan(0);
    const budget = await (
      await put("/api/budget/bachalogy/settings", {
        currency: "INR",
        wallet_amount: 4000,
        daily_amount: 500,
        two_day_amount: 900,
        timezone: "UTC",
      })
    ).json();
    expect(budget.wallet.limit_display).toBe(4000);
    expect(budget.daily.limit_usd).toBeCloseTo(500 / settings.fx.rate, 6);
  });

  it("creates a video, plans it to the storyboard gate, approves and produces keyframes (mock)", async () => {
    const created = (await (
      await post("/api/runs", {
        brand_id: "bachalogy",
        product_id: null,
        title: "Studio smoke",
        topic: "first steps",
        goal: "make parents want it",
        audience: "parents",
        duration_s: 30,
        platform: "Instagram Reels",
        creative_direction: "playful",
        cta: null,
        notes: null,
        advanced: {
          budget_override_usd: null,
          ai_video_seconds: null,
          voice: "brand_default",
          music: "brand_default",
          approval_mode: "storyboard_and_keyframes",
          provider_mode: "mock",
          provider_overrides: {},
        },
      })
    ).json()) as CreateVideoResponse;
    expect(created.blocked).toBeNull();
    expect(created.preflight.estimate.source).toBe("ESTIMATED");
    expect(created.preflight.estimate.max_usd).toBeLessThanOrEqual(2.5 + 1e-9);
    expect(created.job?.status).toBe("stopped");
    const id = created.run.run_id;

    const detail = (await (await app.request(`/api/runs/${id}`)).json()) as RunDetail;
    expect(detail.run.ui_status).toBe("awaiting_storyboard_approval");
    expect(detail.preflight?.stage).toBe("planned");
    expect(detail.preflight?.shots).toBe(6);
    expect(detail.stages.find((s) => s.id === "route")?.ui_status).toBe("complete");
    expect(detail.stages.find((s) => s.id === "keyframes")?.ui_status).toBe("waiting");
    expect(detail.costs.actual_usd).toBeGreaterThan(0);
    expect(detail.costs.calls.every((c) => c.cost_source === "CALCULATED_FROM_USAGE")).toBe(true);
    expect(detail.approvals.storyboard_approved).toBe(false);

    // Edit preview: changing one description keeps the rest intact.
    const preview = await (
      await post(`/api/runs/${id}/storyboard/preview`, {
        shots: [
          {
            id: "shot_02",
            description: `${detail.artifacts.storyboard?.shots[1]?.description} A red ball rests nearby.`,
          },
        ],
      })
    ).json();
    expect(preview.valid).toBe(true);
    expect(preview.changed_shots).toEqual(["shot_02"]);
    expect(preview.kept_shots.length).toBeGreaterThan(3);

    // Approve storyboard → keyframes → waiting for approval.
    const approved = await (await post(`/api/runs/${id}/actions/approve-storyboard`, {})).json();
    expect(approved.job.status).toBe("waiting_approval");
    const d2 = (await (await app.request(`/api/runs/${id}`)).json()) as RunDetail;
    expect(d2.run.ui_status).toBe("awaiting_keyframe_approval");
    expect(d2.approvals.keyframes_pending).toBe(6);
    expect(d2.shots.every((s) => s.keyframe_url)).toBe(true);
    expect(d2.shots[0]?.versions.keyframes[0]?.selected).toBe(true);
    expect(d2.shots[0]?.regenerate_keyframe_estimate_usd).toBeGreaterThan(0);

    // Keyframe file streams with Range support.
    const url = d2.shots[0]?.keyframe_url as string;
    const head = await app.request(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("accept-ranges")).toBe("bytes");
    const part = await app.request(url, { headers: { Range: "bytes=0-9" } });
    expect(part.status).toBe(206);
    expect((await part.arrayBuffer()).byteLength).toBe(10);
    expect((await app.request("/files/runs/bachalogy/../../package.json")).status).toBe(404);

    // Reject one with an instruction, approve the rest → only shot_03 regenerates.
    const est = await (
      await app.request(`/api/runs/${id}/estimate?kind=keyframe&shot=shot_03`)
    ).json();
    expect(est.estimate_usd).toBeGreaterThan(0);
    const before = d2.costs.calls.filter((c) => c.kind === "image").length;
    const decided = await (
      await post(`/api/runs/${id}/actions/keyframes`, {
        decisions: [
          { shotId: "shot_03", decision: "reject", instruction: "camera slightly lower" },
        ],
        approve_remaining: true,
      })
    ).json();
    expect(decided.summary).toEqual({ approved: 5, rejected: 1, pending: 0 });
    expect(decided.job.status).toBe("waiting_approval");
    const d3 = (await (await app.request(`/api/runs/${id}`)).json()) as RunDetail;
    expect(d3.costs.calls.filter((c) => c.kind === "image").length).toBe(before + 1);
    const shot3 = d3.shots.find((s) => s.shot_id === "shot_03");
    expect(shot3?.versions.keyframes.map((v) => v.attempt)).toEqual([2, 1]);
    expect(shot3?.versions.keyframes.find((v) => v.attempt === 1)?.url).toBeTruthy();
    expect(shot3?.approval).toBe("pending");
    expect(d3.costs.retry_usd).toBeGreaterThan(0);

    // Switch back to v1 and approve everything; production continues to done.
    const sel = await (
      await post(`/api/runs/${id}/actions/keyframes/select-version`, {
        shot_id: "shot_03",
        attempt: 1,
      })
    ).json();
    expect(sel.record.approval.status).toBe("approved");
    const run = openRunForStudio(id);
    expect(loadShotRecord(run, "shot_03")?.keyframe?.path).toMatch(/keyframe_v1\.png$/);
    const done = await (
      await post(`/api/runs/${id}/actions/keyframes`, { decisions: [], approve_remaining: true })
    ).json();
    expect(["done", "waiting_approval"]).toContain(done.job.status);
    const d4 = (await (await app.request(`/api/runs/${id}`)).json()) as RunDetail;
    expect(d4.run.ui_status).toBe("complete");
    expect(d4.files.final_video_url).toBeTruthy();
    expect(d4.artifacts.render_progress?.done).toBe(true);
    expect(d4.qc_semantic.available).toBe(false);
    // "Reserved" is the largest hold ever taken for the video: the first job held the whole cap.
    expect(d4.costs.reserved_usd).toBeCloseTo(2.5, 6);
    expect(d4.costs.reservations.length).toBeGreaterThan(2);
    expect(d4.costs.returned_usd ?? 0).toBeGreaterThan(0);

    // Shot-only clip regeneration touches one shot.
    const videoBefore = d4.costs.calls.filter((c) => c.kind === "video").length;
    const clipShot = d4.shots.find((s) => s.final_kind === "video")?.shot_id as string;
    const regen = await (
      await post(`/api/runs/${id}/actions/clips/regenerate`, {
        shot_id: clipShot,
        instruction: "slower push in",
      })
    ).json();
    expect(regen.job.status).toBe("done");
    const d5 = (await (await app.request(`/api/runs/${id}`)).json()) as RunDetail;
    expect(d5.costs.calls.filter((c) => c.kind === "video").length).toBe(videoBefore + 1);
    expect(
      d5.shots.find((s) => s.shot_id === clipShot)?.versions.clips.map((v) => v.attempt),
    ).toEqual([2, 1]);
    expect(d5.audit.some((a) => a.action === "clip.regenerate")).toBe(true);

    const list = (await (
      await app.request("/api/runs?brand=bachalogy&status=complete")
    ).json()) as RunSummary[];
    expect(list.map((r) => r.run_id)).toContain(id);
    const dash = await (await app.request("/api/brands/bachalogy/dashboard")).json();
    expect(dash.totals.videos_completed).toBe(1);
    expect(dash.budget.wallet.spent_usd).toBeGreaterThan(0);

    // Creative controls: brand defaults populated the run, the API echoes them everywhere.
    expect(d5.creative.controls).toMatchObject({
      creative_freedom: 0.7,
      goal_focus: 0.9,
      creative_label: "Bold",
      goal_label: "Goal-first",
      preset: "creative_ad",
    });
    expect(d5.run.creative.creative_freedom).toBe(0.7);
    expect(d5.preflight?.creative.candidate_count).toBe(2);
    expect(d5.creative.director?.candidate_count).toBe(2);
    expect(d5.artifacts.report?.creative?.creative_label).toBe("Bold");
    const clipVersions = d5.shots.find((s) => s.shot_id === clipShot)?.versions.clips ?? [];
    expect(clipVersions.find((v) => v.attempt === 2)?.variation_strength).toBeNull();

    // Duplicate prefill carries the controls and the original request.
    const req = await (await app.request(`/api/runs/${id}/request`)).json();
    expect(req.source).toBe("stored");
    expect(req.request.topic).toBe("first steps");
    expect(req.request.creative).toEqual({ creative_freedom: 0.7, goal_focus: 0.9 });
    const dup = await (await post(`/api/runs/${id}/actions/duplicate`, {})).json();
    const dupDetail = (await (
      await app.request(`/api/runs/${dup.run.run_id}`)
    ).json()) as RunDetail;
    expect(dupDetail.manifest.options.creative_freedom).toBe(0.7);
    expect(dupDetail.manifest.options.goal_focus).toBe(0.9);
    const dupReq = await (await app.request(`/api/runs/${dup.run.run_id}/request`)).json();
    expect(dupReq.source).toBe("stored");
  }, 600_000);

  it("exposes brand creative defaults, presets and settings, and validates the controls", async () => {
    const brand = await (await app.request("/api/brands/bachalogy")).json();
    expect(brand.creative).toMatchObject({
      creative_freedom: 0.7,
      goal_focus: 0.9,
      sources: { creative_freedom: "brand", goal_focus: "brand" },
    });
    const other = await (await app.request("/api/brands/mindcode")).json();
    expect(other.creative).toMatchObject({
      creative_freedom: 0.65,
      goal_focus: 0.85,
      sources: { creative_freedom: "default", goal_focus: "default" },
    });
    const settings = await (await app.request("/api/settings")).json();
    expect(settings.creative.presets.map((p: { id: string }) => p.id)).toEqual([
      "direct_ad",
      "creative_ad",
      "brand_film",
      "experimental",
    ]);
    expect(settings.creative.creative_ranges.map((r: { label: string }) => r.label)).toEqual([
      "Safe",
      "Focused",
      "Balanced",
      "Bold",
      "Wild",
    ]);
    expect(settings.creative.variation_options.map((v: { id: string }) => v.id)).toEqual([
      "small",
      "fresh",
      "different",
    ]);

    const body = {
      brand_id: "bachalogy",
      product_id: null,
      title: null,
      topic: "bad controls",
      goal: "sell",
      audience: null,
      duration_s: null,
      platform: null,
      creative_direction: null,
      cta: null,
      notes: null,
      advanced: {
        budget_override_usd: null,
        ai_video_seconds: null,
        voice: "brand_default",
        music: "brand_default",
        approval_mode: "storyboard_only",
        provider_mode: "mock",
        provider_overrides: {},
      },
    };
    const tooHigh = await post("/api/runs", { ...body, creative: { creative_freedom: 1.5 } });
    expect(tooHigh.status).toBe(400);
    expect((await tooHigh.json()).error).toMatch(/between 0 and 1/);
    const negative = await post("/api/runs", { ...body, creative: { goal_focus: -0.1 } });
    expect(negative.status).toBe(400);
    const wrongType = await post("/api/runs", { ...body, creative: { creative_freedom: "wild" } });
    expect(wrongType.status).toBe(400);
    // Nothing was created by the rejected requests.
    const runs = (await (await app.request("/api/runs?brand=bachalogy")).json()) as RunSummary[];
    expect(runs.some((r) => r.topic === "bad controls")).toBe(false);

    // A run-level override beats the brand default and is echoed back.
    const created = (await (
      await post("/api/runs", {
        ...body,
        topic: "overridden controls",
        creative: { creative_freedom: 0.2 },
      })
    ).json()) as CreateVideoResponse;
    expect(created.blocked).toBeNull();
    expect(created.run.creative).toMatchObject({
      creative_freedom: 0.2,
      goal_focus: 0.9,
      creative_label: "Safe",
    });
    expect(created.preflight.creative.candidate_count).toBe(1);
    const bad = await post(`/api/runs/${created.run.run_id}/actions/clips/regenerate`, {
      shot_id: "shot_01",
      variation: "huge",
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/variation/);
  }, 600_000);
});
