import { BudgetExceededError } from "../util/errors.js";

export interface Reservation {
  id: number;
  label: string;
  estimateUsd: number;
}

/**
 * Absolute hard cap enforcement: estimate → reserve → commit(actual) | refund.
 * The soft targets (ai-video seconds, target cost) live in the router; this class only knows
 * dollars and never lets spent + reserved + next estimate exceed the cap.
 */
export class BudgetGuard {
  private reservations = new Map<number, Reservation>();
  private nextId = 1;
  private spent: number;

  constructor(
    readonly hardCapUsd: number,
    initialSpentUsd = 0,
    private readonly onChange?: (spent: number, reserved: number) => void,
  ) {
    this.spent = initialSpentUsd;
  }

  get spentUsd(): number {
    return this.spent;
  }

  get reservedUsd(): number {
    let total = 0;
    for (const r of this.reservations.values()) total += r.estimateUsd;
    return total;
  }

  get remainingUsd(): number {
    return Math.max(0, this.hardCapUsd - this.spent - this.reservedUsd);
  }

  canAfford(estimateUsd: number): boolean {
    return this.spent + this.reservedUsd + estimateUsd <= this.hardCapUsd + 1e-9;
  }

  reserve(estimateUsd: number, label: string): Reservation {
    if (!this.canAfford(estimateUsd)) {
      throw new BudgetExceededError(
        estimateUsd,
        this.spent,
        this.reservedUsd,
        this.hardCapUsd,
        label,
      );
    }
    const r: Reservation = { id: this.nextId++, label, estimateUsd };
    this.reservations.set(r.id, r);
    this.onChange?.(this.spent, this.reservedUsd);
    return r;
  }

  commit(reservation: Reservation, actualUsd: number): void {
    this.reservations.delete(reservation.id);
    this.spent += actualUsd;
    this.onChange?.(this.spent, this.reservedUsd);
  }

  refund(reservation: Reservation): void {
    this.reservations.delete(reservation.id);
    this.onChange?.(this.spent, this.reservedUsd);
  }

  /** Record spend that happened outside a reservation (e.g. resumed from the ledger). */
  addSpent(usd: number): void {
    this.spent += usd;
    this.onChange?.(this.spent, this.reservedUsd);
  }
}
