import { logger } from "./logger.js";

export interface RetryOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
  multiplier?: number;
  maxBackoffMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  label?: string;
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
