import { describe, it, expect } from "vitest";
import { alreadySpentToday, totalSpent, remainingCampaignBudget } from "../history/store.js";
import type { HistoryEntry } from "../types.js";

// Minimal history-entry factory — the spend helpers only read date/status/
// clampedAmountUsdc, so the rest is filled just to satisfy the type.
const e = (over: Partial<HistoryEntry>): HistoryEntry => ({
  date: "2026-06-15",
  timestamp: "2026-06-15T10:00:00.000Z",
  status: "success",
  tokenOut: "cirBTC",
  ...over,
}) as HistoryEntry;

// The real-fund guardrails (daily cap, campaign budget) must account for REAL
// USDC spent only. A `simulated` (paper) fill moves no real USDC, so it must NOT
// count as spend — otherwise a paper run would consume the real daily cap /
// campaign budget and wrongly starve later live buys. (Locks the #1/#3 semantics:
// simulated spend is bounded by per-user caps, never by the real-fund guardrails.)
describe("spend accounting ignores simulated (paper) fills", () => {
  const history = [
    e({ status: "success", clampedAmountUsdc: "1.000000" }),
    e({ status: "simulated", clampedAmountUsdc: "5.000000" }), // paper — must not count
    e({ status: "dry_run", clampedAmountUsdc: "0.500000" }),   // dry run counts (mirrors a real buy shape)
    e({ status: "error_swap_failed", clampedAmountUsdc: "2.000000" }), // failed — must not count
    e({ status: "skipped_guardrail_clamped", clampedAmountUsdc: "0" }),
  ];

  it("alreadySpentToday counts only success + dry_run, not simulated", () => {
    // 1.0 (success) + 0.5 (dry_run) = 1.5; the 5.0 simulated is excluded.
    expect(alreadySpentToday(history, "2026-06-15")).toBe("1.500000");
  });

  it("alreadySpentToday is 0 on a day with only simulated fills", () => {
    const simOnly = [
      e({ date: "2026-06-16", status: "simulated", clampedAmountUsdc: "3.000000" }),
      e({ date: "2026-06-16", status: "simulated", clampedAmountUsdc: "2.000000" }),
    ];
    expect(alreadySpentToday(simOnly, "2026-06-16")).toBe("0.000000");
  });

  it("totalSpent counts only real (success + dry_run) spend", () => {
    expect(totalSpent(history)).toBe("1.500000");
  });

  it("remainingCampaignBudget is not consumed by paper fills", () => {
    // Budget 10, real spend 1.5 → 8.5 remains; the 5.0 simulated never touches it.
    expect(remainingCampaignBudget(history, "10")).toBe("8.500000");
  });

  it("remainingCampaignBudget is undefined when no budget is configured", () => {
    expect(remainingCampaignBudget(history, undefined)).toBeUndefined();
  });
});
