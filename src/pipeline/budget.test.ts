import { describe, expect, it } from "vitest";
import { BudgetExceededError } from "../util/errors.js";
import { BudgetGuard } from "./budget.js";

describe("BudgetGuard", () => {
  it("reserves, commits actuals and tracks remaining", () => {
    const g = new BudgetGuard(2.5);
    const r = g.reserve(0.8, "video");
    expect(g.reservedUsd).toBeCloseTo(0.8);
    expect(g.remainingUsd).toBeCloseTo(1.7);
    g.commit(r, 0.75);
    expect(g.spentUsd).toBeCloseTo(0.75);
    expect(g.reservedUsd).toBe(0);
    expect(g.remainingUsd).toBeCloseTo(1.75);
  });

  it("refuses a reservation that would exceed the absolute cap", () => {
    const g = new BudgetGuard(1.0, 0.7);
    g.reserve(0.2, "a");
    expect(() => g.reserve(0.2, "b")).toThrow(BudgetExceededError);
    expect(g.canAfford(0.1)).toBe(true);
  });

  it("refunds failed calls", () => {
    const g = new BudgetGuard(1.0);
    const r = g.reserve(0.9, "x");
    g.refund(r);
    expect(g.reservedUsd).toBe(0);
    expect(g.remainingUsd).toBeCloseTo(1.0);
  });

  it("reports spend changes through the callback", () => {
    const seen: Array<[number, number]> = [];
    const g = new BudgetGuard(5, 0, (s, r) => seen.push([s, r]));
    const r = g.reserve(1, "a");
    g.commit(r, 1.2);
    expect(seen.at(-1)).toEqual([1.2, 0]);
  });
});
