import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite.js";
import { BudgetWindowError } from "../util/errors.js";
import { BudgetLedger, startOfDayIso } from "./ledger.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicp-ledger-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function freshLedger(name: string): { ledger: BudgetLedger; file: string } {
  const file = path.join(tmp, `${name}.db`);
  const db = openDb(file);
  db.prepare(
    `INSERT INTO fx_rates (base, quote, rate, effective_at, source, created_at) VALUES ('USD','INR',80,'2026-01-01T00:00:00Z','test','2026-01-01T00:00:00Z')`,
  ).run();
  return { ledger: new BudgetLedger(db), file };
}

function spend(
  ledger: BudgetLedger,
  brand: string,
  usd: number,
  at: string,
  mode = "live",
  runId = "r0",
) {
  ledger.db
    .prepare(
      `INSERT INTO budget_ledger (brand_id, run_id, kind, amount_usd, provider_mode, actor, created_at) VALUES (?, ?, 'spend', ?, ?, 'test', ?)`,
    )
    .run(brand, runId, usd, mode, at);
}

describe("budget ledger", () => {
  it("admits within the wallet, daily and 48h limits and names the blocking rule", () => {
    const { ledger } = freshLedger("rules");
    // ₹4,000 wallet, ₹500/day, ₹900/48h at 80 INR/USD → $50, $6.25, $11.25
    ledger.saveSettings("bachalogy", {
      currency: "INR",
      wallet_amount: 4000,
      daily_amount: 500,
      two_day_amount: 900,
      wallet_since: "2026-01-01T00:00:00Z",
      timezone: "UTC",
    });
    const now = new Date("2026-09-11T10:00:00Z");
    // spent today $3, yesterday $5 (inside 48h), last week $20 (wallet only)
    spend(ledger, "bachalogy", 3, "2026-09-11T08:00:00Z");
    spend(ledger, "bachalogy", 5, "2026-09-10T12:00:00Z");
    spend(ledger, "bachalogy", 20, "2026-09-04T12:00:00Z");
    const st = ledger.status("bachalogy", now);
    expect(st.daily.spent_usd).toBe(3);
    expect(st.two_day.spent_usd).toBe(8);
    expect(st.wallet.spent_usd).toBe(28);
    expect(st.daily.limit_usd).toBeCloseTo(6.25, 6);

    // $2.5 hold fits today ($3 + 2.5 ≤ 6.25) and in 48h ($8 + 2.5 ≤ 11.25)
    const ok = ledger.check("bachalogy", 2.5, { now });
    expect(ok.ok).toBe(true);
    // $3.5 breaks today's limit first
    const daily = ledger.check("bachalogy", 3.5, { now });
    expect(daily.ok).toBe(false);
    expect(daily.blocking_rule).toBe("daily");
    // after more spend in the window, the 48h rule blocks even a small hold
    spend(ledger, "bachalogy", 3, "2026-09-10T02:00:00Z");
    const twoDay = ledger.check("bachalogy", 1, { now });
    expect(twoDay.ok).toBe(false);
    expect(twoDay.blocking_rule).toBe("two_day");
    // per-run cap
    const cap = ledger.check("bachalogy", 1, { now, runCapUsd: 2.5, estimateUsd: 3 });
    expect(cap.blocking_rule).toBe("run_cap");
    expect(() =>
      ledger.admit({
        brandId: "bachalogy",
        runId: "r1",
        jobId: "j1",
        holdUsd: 1,
        providerMode: "live",
        label: "t",
        now,
      }),
    ).toThrow(BudgetWindowError);
  });

  it("holds maximum exposure, decrements as spend commits, and releases the rest", () => {
    const { ledger } = freshLedger("holds");
    ledger.saveSettings("b", {
      currency: "USD",
      wallet_amount: 10,
      daily_amount: null,
      two_day_amount: null,
      timezone: "UTC",
    });
    const a = ledger.admit({
      brandId: "b",
      runId: "run-a",
      jobId: "ja",
      holdUsd: 4,
      providerMode: "live",
      label: "a",
    });
    expect(ledger.status("b").wallet.held_usd).toBe(4);
    // a second run may hold 6 but not 7
    expect(ledger.check("b", 7).ok).toBe(false);
    expect(ledger.check("b", 6).ok).toBe(true);
    const b = ledger.admit({
      brandId: "b",
      runId: "run-b",
      jobId: "jb",
      holdUsd: 6,
      providerMode: "live",
      label: "b",
    });
    expect(() =>
      ledger.admit({
        brandId: "b",
        runId: "run-c",
        jobId: "jc",
        holdUsd: 0.5,
        providerMode: "live",
        label: "c",
      }),
    ).toThrow(/wallet/);
    // spend inside run-a's hold
    ledger.db
      .prepare(
        `INSERT INTO generations (run_id, stage_id, kind, provider, model, brand_config_version, status, created_at, est_cost_usd) VALUES ('run-a','s','llm','openai','m','v','completed','2026-09-11T00:00:00Z',1)`,
      )
      .run();
    const genId = Number(
      (ledger.db.prepare(`SELECT id FROM generations WHERE run_id='run-a'`).get() as { id: number })
        .id,
    );
    ledger.db
      .prepare(
        `INSERT INTO budget_ledger (brand_id, run_id, generation_id, reservation_id, kind, amount_usd, provider_mode, actor, created_at) VALUES ('b','run-a',?,?,'spend',1.5,'live','test',?)`,
      )
      .run(genId, a.reservationId, new Date().toISOString());
    ledger.db
      .prepare(`UPDATE budget_reservations SET hold_usd = MAX(0, hold_usd - 1.5) WHERE id = ?`)
      .run(a.reservationId);
    const st = ledger.status("b");
    expect(st.wallet.spent_usd).toBe(1.5);
    expect(st.wallet.held_usd).toBeCloseTo(8.5, 6); // 2.5 + 6
    expect(st.wallet.available_usd).toBeCloseTo(0, 6);
    ledger.release(a.reservationId, "done", 1.5);
    ledger.release(b.reservationId, "cancelled", 0);
    const after = ledger.status("b");
    expect(after.wallet.held_usd).toBe(0);
    expect(after.wallet.available_usd).toBeCloseTo(8.5, 6);
    expect(ledger.reservationsForRun("run-a")[0]?.release_reason).toBe("done");
    const kinds = ledger.ledgerRows("b").map((r) => r.kind);
    expect(kinds).toContain("hold");
    expect(kinds).toContain("release");
  });

  it("re-admitting the same run supersedes its previous hold instead of double counting", () => {
    const { ledger } = freshLedger("supersede");
    ledger.saveSettings("b", { currency: "USD", wallet_amount: 5 });
    ledger.admit({
      brandId: "b",
      runId: "r",
      jobId: "j1",
      holdUsd: 3,
      providerMode: "live",
      label: "first",
    });
    const second = ledger.admit({
      brandId: "b",
      runId: "r",
      jobId: "j2",
      holdUsd: 4,
      providerMode: "live",
      label: "second",
    });
    expect(ledger.status("b").wallet.held_usd).toBe(4);
    expect(ledger.activeReservationForRun("r")?.id).toBe(second.reservationId);
  });

  it("excludes mock runs when configured to", () => {
    const { ledger } = freshLedger("mock");
    ledger.saveSettings("b", {
      currency: "USD",
      daily_amount: 2,
      count_mock_runs: false,
      timezone: "UTC",
    });
    const now = new Date();
    spend(ledger, "b", 1.9, now.toISOString(), "mock");
    expect(ledger.check("b", 1, { now }).ok).toBe(true);
    ledger.saveSettings("b", { count_mock_runs: true });
    expect(ledger.check("b", 1, { now }).ok).toBe(false);
    // a mock run is not admitted against limits when mock spend is excluded
    ledger.saveSettings("b", { count_mock_runs: false, daily_amount: 0.5 });
    expect(() =>
      ledger.admit({
        brandId: "b",
        runId: "m",
        jobId: "j",
        holdUsd: 3,
        providerMode: "mock",
        label: "mock",
        now,
      }),
    ).not.toThrow();
  });

  it("computes local midnight in the configured timezone", () => {
    const now = new Date("2026-09-11T03:30:00Z"); // 09:00 IST
    expect(startOfDayIso(now, "Asia/Kolkata")).toBe("2026-09-10T18:30:00.000Z");
    expect(startOfDayIso(now, "UTC")).toBe("2026-09-11T00:00:00.000Z");
  });

  it("serialises concurrent admissions: a competing connection waits for the write lock", () => {
    const { ledger, file } = freshLedger("lock");
    ledger.saveSettings("b", { currency: "USD", wallet_amount: 5 });
    const other = new BudgetLedger(openDb(file, { timeoutMs: 150 }));
    ledger.db.exec("BEGIN IMMEDIATE");
    expect(() =>
      other.admit({
        brandId: "b",
        runId: "r2",
        jobId: "j2",
        holdUsd: 3,
        providerMode: "live",
        label: "b",
      }),
    ).toThrow(/SQLITE_BUSY|database is locked/);
    ledger.db
      .prepare(
        `INSERT INTO budget_reservations (brand_id, run_id, job_id, hold_usd, initial_hold_usd, provider_mode, status, created_at) VALUES ('b','r1','j1',3,3,'live','active',?)`,
      )
      .run(new Date().toISOString());
    ledger.db.exec("COMMIT");
    expect(() =>
      other.admit({
        brandId: "b",
        runId: "r2",
        jobId: "j2",
        holdUsd: 3,
        providerMode: "live",
        label: "b",
      }),
    ).toThrow(BudgetWindowError);
    expect(
      other.admit({
        brandId: "b",
        runId: "r2",
        jobId: "j2",
        holdUsd: 2,
        providerMode: "live",
        label: "b",
      }).holdUsd,
    ).toBe(2);
    other.db.close();
  });

  it("admits exactly the affordable number of holds under a real race", async () => {
    const { ledger, file } = freshLedger("race");
    ledger.saveSettings("b", { currency: "USD", wallet_amount: 5 });
    const processes = 8;
    const script = path.join(tmp, "race-worker.ts");
    fs.writeFileSync(
      script,
      `import { openDb } from ${JSON.stringify(path.resolve("src/db/sqlite.ts"))};
import { BudgetLedger } from ${JSON.stringify(path.resolve("src/budget/ledger.ts"))};
const [file, i] = process.argv.slice(2);
const ledger = new BudgetLedger(openDb(file, { timeoutMs: 10000 }));
try {
  ledger.admit({ brandId: "b", runId: "run-" + i, jobId: "j" + i, holdUsd: 2, providerMode: "live", label: "race" });
  console.log("ok");
} catch (e) {
  console.log("denied:" + (e instanceof Error ? e.message : String(e)));
}
`,
    );
    const results = await Promise.all(
      Array.from(
        { length: processes },
        (_, i) =>
          new Promise<string>((resolve) => {
            const child = spawn(process.execPath, ["--import", "tsx", script, file, String(i)], {
              cwd: process.cwd(),
              env: { ...process.env, AICP_DATA_DIR: tmp },
            });
            let out = "";
            let err = "";
            child.stdout.on("data", (d) => {
              out += String(d);
            });
            child.stderr.on("data", (d) => {
              err += String(d);
            });
            child.on("exit", () => resolve(out.trim() || `error:${err.trim()}`));
          }),
      ),
    );
    const admitted = results.filter((r) => r === "ok").length;
    expect(results.filter((r) => r.startsWith("error"))).toEqual([]);
    expect(admitted).toBe(2); // $5 wallet, $2 holds → exactly two fit
    expect(ledger.status("b").wallet.held_usd).toBe(4);
  }, 120_000);
});
