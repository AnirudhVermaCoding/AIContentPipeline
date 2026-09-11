import type { RunManifest, StageState } from "../schema/manifest.js";
import type { ShotRecord } from "../schema/shot.js";
import { nowIso } from "../util/fs.js";
import type { Db } from "./sqlite.js";

export interface GenerationRow {
  id?: number;
  run_id: string;
  stage_id: string;
  shot_id: string | null;
  kind: "llm" | "image" | "video" | "tts" | "stock";
  provider: string;
  model: string;
  label: string | null;
  prompt_hash: string | null;
  prompt_version: string | null;
  brand_config_version: string;
  source_assets: string[];
  duration_s: number | null;
  resolution: string | null;
  retries: number;
  latency_ms: number | null;
  est_cost_usd: number;
  actual_cost_usd: number | null;
  usage: Record<string, unknown> | null;
  status: "reserved" | "completed" | "failed" | "refunded";
  error: string | null;
  created_at: string;
}

export class Repos {
  constructor(private readonly db: Db) {}

  upsertRun(m: RunManifest, runDir: string): void {
    this.db
      .prepare(
        `INSERT INTO runs (run_id, brand_id, brand_config_version, topic, status, created_at, updated_at, estimated_usd, spent_usd, run_dir)
         VALUES (@run_id, @brand_id, @brand_config_version, @topic, @status, @created_at, @updated_at, @estimated_usd, @spent_usd, @run_dir)
         ON CONFLICT(run_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at,
           estimated_usd=excluded.estimated_usd, spent_usd=excluded.spent_usd`,
      )
      .run({
        run_id: m.run_id,
        brand_id: m.brand_id,
        brand_config_version: m.brand_config_version,
        topic: m.topic,
        status: m.status,
        created_at: m.created_at,
        updated_at: m.updated_at,
        estimated_usd: m.cost.estimated_usd,
        spent_usd: m.cost.spent_usd,
        run_dir: runDir,
      });
  }

  upsertStage(runId: string, stageId: string, s: StageState): void {
    this.db
      .prepare(
        `INSERT INTO stages (run_id, stage_id, status, inputs_hash, started_at, finished_at, duration_ms, cost_usd, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, stage_id) DO UPDATE SET status=excluded.status, inputs_hash=excluded.inputs_hash,
           started_at=excluded.started_at, finished_at=excluded.finished_at, duration_ms=excluded.duration_ms,
           cost_usd=excluded.cost_usd, error=excluded.error`,
      )
      .run(
        runId,
        stageId,
        s.status,
        s.inputs_hash,
        s.started_at,
        s.finished_at,
        s.duration_ms,
        s.cost_usd,
        s.error,
      );
  }

  upsertShot(runId: string, shot: ShotRecord): void {
    this.db
      .prepare(
        `INSERT INTO shots (run_id, shot_id, status, source, shot_hash, cost_usd, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, shot_id) DO UPDATE SET status=excluded.status, source=excluded.source,
           shot_hash=excluded.shot_hash, cost_usd=excluded.cost_usd, updated_at=excluded.updated_at`,
      )
      .run(
        runId,
        shot.shot_id,
        shot.status,
        shot.source,
        shot.shot_hash,
        shot.cost_usd,
        shot.updated_at,
      );
  }

  insertGeneration(row: Omit<GenerationRow, "id" | "created_at">): number {
    const res = this.db
      .prepare(
        `INSERT INTO generations (run_id, stage_id, shot_id, kind, provider, model, label, prompt_hash, prompt_version,
           brand_config_version, source_assets, duration_s, resolution, retries, latency_ms, est_cost_usd, actual_cost_usd,
           usage, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.run_id,
        row.stage_id,
        row.shot_id,
        row.kind,
        row.provider,
        row.model,
        row.label,
        row.prompt_hash,
        row.prompt_version,
        row.brand_config_version,
        JSON.stringify(row.source_assets),
        row.duration_s,
        row.resolution,
        row.retries,
        row.latency_ms,
        row.est_cost_usd,
        row.actual_cost_usd,
        row.usage ? JSON.stringify(row.usage) : null,
        row.status,
        row.error,
        nowIso(),
      );
    return Number(res.lastInsertRowid);
  }

  finishGeneration(
    id: number,
    patch: {
      status: GenerationRow["status"];
      actual_cost_usd: number | null;
      latency_ms: number | null;
      retries: number;
      usage: Record<string, unknown> | null;
      error: string | null;
      duration_s?: number | null;
      resolution?: string | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE generations SET status=?, actual_cost_usd=?, latency_ms=?, retries=?, usage=?, error=?,
           duration_s=COALESCE(?, duration_s), resolution=COALESCE(?, resolution) WHERE id=?`,
      )
      .run(
        patch.status,
        patch.actual_cost_usd,
        patch.latency_ms,
        patch.retries,
        patch.usage ? JSON.stringify(patch.usage) : null,
        patch.error,
        patch.duration_s ?? null,
        patch.resolution ?? null,
        id,
      );
  }

  listGenerations(runId: string): GenerationRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM generations WHERE run_id = ? ORDER BY id`)
      .all(runId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      ...(r as unknown as GenerationRow),
      source_assets: JSON.parse((r.source_assets as string) ?? "[]"),
      usage: r.usage ? JSON.parse(r.usage as string) : null,
    }));
  }

  spentForRun(runId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(actual_cost_usd), 0) AS spent FROM generations WHERE run_id = ? AND status = 'completed'`,
      )
      .get(runId) as { spent: number };
    return row.spent;
  }

  listRuns(limit = 20): Array<{
    run_id: string;
    brand_id: string;
    topic: string;
    status: string;
    updated_at: string;
    spent_usd: number;
    run_dir: string;
  }> {
    return this.db
      .prepare(
        `SELECT run_id, brand_id, topic, status, updated_at, spent_usd, run_dir FROM runs ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as ReturnType<Repos["listRuns"]>;
  }

  findRun(runId: string): { run_dir: string; brand_id: string } | undefined {
    return this.db.prepare(`SELECT run_dir, brand_id FROM runs WHERE run_id = ?`).get(runId) as
      | { run_dir: string; brand_id: string }
      | undefined;
  }

  insertQc(
    runId: string,
    stageId: string,
    shotId: string | null,
    status: string,
    report: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT INTO qc_results (run_id, stage_id, shot_id, status, report, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(runId, stageId, shotId, status, JSON.stringify(report), nowIso());
  }

  insertAsset(a: {
    id: string;
    brand_id: string;
    run_id: string | null;
    shot_id: string | null;
    kind: string;
    path: string;
    description: string;
    tags: string[];
    entities: string[];
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO assets (id, brand_id, run_id, shot_id, kind, path, description, tags, entities, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.id,
        a.brand_id,
        a.run_id,
        a.shot_id,
        a.kind,
        a.path,
        a.description,
        JSON.stringify(a.tags),
        JSON.stringify(a.entities),
        nowIso(),
      );
  }
}
