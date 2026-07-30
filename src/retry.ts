import { logger } from "./logger.js";

export interface RetryOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
  multiplier?: number;
  maxBackoffMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  label?: string;
}

/**
 * Whether an LLM/HTTP error is worth retrying. Non-retryable 4xx — a credit
 * exhaustion (400), auth (401/403), or malformed request (404/422) — will fail
 * again identically, so retrying only wastes calls + backoff. Rate limits (429),
 * server/overload errors (5xx), and network errors (no status) are transient and
 * DO get retried. Reads the `status` the Anthropic SDK sets on its API errors.
 */
export function isRetryableLlmError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  if (typeof status !== "number") return true; // network / unknown → retry
  if (status === 429) return true; // rate limited → transient
  if (status >= 500) return true; // server / overloaded → transient
  return false; // other 4xx (credit, auth, bad request) → do not retry
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const {
    maxRetries = 3,
    initialBackoffMs = 1000,
    multiplier = 2,
    maxBackoffMs = 15_000,
    shouldRetry,
    label = "operation",
  } = options ?? {};

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (shouldRetry && !shouldRetry(err)) throw err;
      if (attempt < maxRetries) {
        const delay = Math.min(initialBackoffMs * multiplier ** attempt, maxBackoffMs);
        logger.warn(`${label}: attempt ${attempt + 1} failed, retrying in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
