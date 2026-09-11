import { isRetryable } from "./errors.js";

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  label?: string;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Override the default retryability decision. */
  shouldRetry?: (err: unknown) => boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bounded retry with exponential backoff + jitter. Never retries errors classed as permanent
 * (auth, quota, safety, validation of our own inputs).
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseDelayMs ?? 1500;
  const max = opts.maxDelayMs ?? 20_000;
  const decide = opts.shouldRetry ?? isRetryable;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = opts.timeoutMs
      ? setTimeout(
          () => controller.abort(new Error(`timeout after ${opts.timeoutMs} ms`)),
          opts.timeoutMs,
        )
      : null;
    try {
      return await fn(controller.signal);
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !decide(err)) throw err;
      const delay = Math.min(max, base * 2 ** (attempt - 1)) * (0.7 + Math.random() * 0.6);
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr;
}
