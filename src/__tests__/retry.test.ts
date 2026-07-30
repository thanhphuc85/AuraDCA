import { describe, it, expect } from "vitest";
import { isRetryableLlmError, withRetry } from "../retry.js";

describe("isRetryableLlmError", () => {
  it("does NOT retry non-transient 4xx (credit, auth, bad request)", () => {
    expect(isRetryableLlmError({ status: 400 })).toBe(false); // credit exhausted
    expect(isRetryableLlmError({ status: 401 })).toBe(false); // auth
    expect(isRetryableLlmError({ status: 403 })).toBe(false);
    expect(isRetryableLlmError({ status: 404 })).toBe(false);
    expect(isRetryableLlmError({ status: 422 })).toBe(false);
  });

  it("retries transient failures (rate limit, server, overloaded)", () => {
    expect(isRetryableLlmError({ status: 429 })).toBe(true); // rate limited
    expect(isRetryableLlmError({ status: 500 })).toBe(true);
    expect(isRetryableLlmError({ status: 503 })).toBe(true);
    expect(isRetryableLlmError({ status: 529 })).toBe(true); // overloaded
  });

  it("retries network / unknown errors that carry no status", () => {
    expect(isRetryableLlmError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableLlmError({})).toBe(true);
    expect(isRetryableLlmError(null)).toBe(true);
  });
});

describe("withRetry honours shouldRetry", () => {
  it("stops immediately on a non-retryable error (no wasted attempts)", async () => {
    let calls = 0;
    const err = Object.assign(new Error("credit balance too low"), { status: 400 });
    await expect(
      withRetry(async () => { calls++; throw err; }, { maxRetries: 3, shouldRetry: isRetryableLlmError, initialBackoffMs: 1 }),
    ).rejects.toBe(err);
    expect(calls).toBe(1); // tried once, did not retry the 400
  });

  it("retries a transient error up to maxRetries then throws", async () => {
    let calls = 0;
    const err = Object.assign(new Error("overloaded"), { status: 529 });
    await expect(
      withRetry(async () => { calls++; throw err; }, { maxRetries: 2, shouldRetry: isRetryableLlmError, initialBackoffMs: 1 }),
    ).rejects.toBe(err);
    expect(calls).toBe(3); // initial + 2 retries
  });
});
