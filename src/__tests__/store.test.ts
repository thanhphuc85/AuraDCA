import { describe, it, expect } from "vitest";
import { boundedForWrite } from "../ledger/store.js";
import type { Ledger } from "../types.js";

function mkLedger(distCount: number): Ledger {
  const distributions = Array.from({ length: distCount }, (_, i) => ({
    runTimestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
    tokenOut: "EURC",
    totalUsdcSwapped: "1.000000",
    totalCirBtcReceived: "1.000000",
    allocations: [],
    timestamp: new Date().toISOString(),
    seq: i, // marker to assert which records survived
  }));
  return {
    version: 1,
    lastScannedBlock: 0,
    users: {},
    deposits: [],
    distributions,
    withdrawals: [],
  } as unknown as Ledger;
}

describe("boundedForWrite (distributions prune)", () => {
  it("keeps the array untouched when at or under the cap", () => {
    const ledger = mkLedger(10);
    const out = boundedForWrite(ledger, 200);
    expect(out).toBe(ledger); // same reference — no copy when nothing to trim
    expect(out.distributions).toHaveLength(10);
  });

  it("caps to the most recent N records when over the cap", () => {
    const ledger = mkLedger(250);
    const out = boundedForWrite(ledger, 200);
    expect(out.distributions).toHaveLength(200);
    // newest kept: seq 50..249
    expect((out.distributions[0] as any).seq).toBe(50);
    expect((out.distributions[199] as any).seq).toBe(249);
  });

  it("does not mutate the input ledger", () => {
    const ledger = mkLedger(250);
    boundedForWrite(ledger, 200);
    expect(ledger.distributions).toHaveLength(250); // original still full
  });

  it("handles the exact-boundary case (length === max)", () => {
    const ledger = mkLedger(200);
    const out = boundedForWrite(ledger, 200);
    expect(out).toBe(ledger);
    expect(out.distributions).toHaveLength(200);
  });
});
