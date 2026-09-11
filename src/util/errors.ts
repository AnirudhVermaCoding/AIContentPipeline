/**
 * Typed error taxonomy. Retry policy and the runner's stop decisions key off these classes,
 * never off message substrings.
 */

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
  }
  get retryable(): boolean {
    return this.options.retryable ?? false;
  }
}

/** A provider call failed. `retryable` distinguishes 429/5xx/network from 4xx/auth. */
export class ProviderError extends PipelineError {
  constructor(
    readonly provider: string,
    message: string,
    options: { cause?: unknown; retryable?: boolean; status?: number } = {},
  ) {
    super(`[${provider}] ${message}`, options);
    this.status = options.status;
  }
  readonly status: number | undefined;
}

/** The provider refused the content (safety). Never retried verbatim; the caller re-prompts. */
export class SafetyRejectionError extends ProviderError {
  constructor(provider: string, message: string, cause?: unknown) {
    super(provider, message, { cause, retryable: false });
  }
}

/** The LLM returned something that failed schema or semantic validation. Retried with feedback. */
export class ValidationError extends PipelineError {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message, { retryable: true });
  }
}

/** A paid call would push spend past the absolute hard cap. */
export class BudgetExceededError extends PipelineError {
  constructor(
    readonly attemptedUsd: number,
    readonly spentUsd: number,
    readonly reservedUsd: number,
    readonly hardCapUsd: number,
    readonly label: string,
  ) {
    super(
      `Budget exceeded: ${label} needs $${attemptedUsd.toFixed(3)} but spent $${spentUsd.toFixed(3)} + reserved $${reservedUsd.toFixed(3)} against a hard cap of $${hardCapUsd.toFixed(2)}`,
    );
  }
}

/** Planning found the creative requirement cannot be met inside the cap. */
export class BudgetConflictError extends PipelineError {
  constructor(
    readonly estimatedUsd: number,
    readonly hardCapUsd: number,
    readonly alternatives: { description: string; est_total_usd: number; cost_of: string }[],
  ) {
    super(
      `Budget conflict: the plan is estimated at $${estimatedUsd.toFixed(2)} against a hard cap of $${hardCapUsd.toFixed(2)}`,
    );
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof PipelineError) return err.retryable;
  if (err && typeof err === "object") {
    const e = err as { name?: string; code?: string; status?: number; statusCode?: number };
    const status = e.status ?? e.statusCode;
    if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
    if (e.name === "AbortError" || e.name === "TimeoutError") return true;
    if (
      e.code &&
      ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED", "EPIPE"].includes(e.code)
    )
      return true;
  }
  return false;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
