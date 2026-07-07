import { describe, expect, it } from "vitest";
import { clampDecision } from "../decision/guardrails.js";
import type { ClaudeDecision, GuardrailConfig } from "../types.js";

const guardrails: GuardrailConfig = {
  maxDailyUsdc: "1.00",
  minUsdcReserve: "0.50",
  minSwapUsdc: "0.10",
};

function decision(overrides: Partial<ClaudeDecision> = {}): ClaudeDecision {
  return { proceed: true, amountUsdc: "0.50", reasoning: "test", ...overrides };
}

describe("clampDecision", () => {
  it("skips when Claude declines", () => {
    const result = clampDecision(decision({ proceed: false }), {
      guardrails,
      walletUsdcBalance: "10",
      alreadySpentTodayUsdc: "0",
    });
    expect(result).toEqual({ proceed: false, amountUsdc: "0", boundBy: "llm_declined", skipReason: "llm_declined" });
  });

  it("skips on invalid/negative amount", () => {
    const result = clampDecision(decision({ amountUsdc: "-5" }), {
      guardrails,
      walletUsdcBalance: "10",
      alreadySpentTodayUsdc: "0",
    });
    expect(result.proceed).toBe(false);
    expect(result.skipReason).toBe("invalid_llm_amount");
  });

  it("skips on non-numeric amount", () => {
    const result = clampDecision(decision({ amountUsdc: "not-a-number" }), {
      guardrails,
      walletUsdcBalance: "10",
      alreadySpentTodayUsdc: "0",
    });
    expect(result.proceed).toBe(false);
    expect(result.skipReason).toBe("invalid_llm_amount");
  });

  it("clamps a recommendation above max daily cap", () => {
    const result = clampDecision(decision({ amountUsdc: "5.00" }), {
      guardrails,
      walletUsdcBalance: "10",
      alreadySpentTodayUsdc: "0",
    });
    expect(result.proceed).toBe(true);
    expect(result.amountUsdc).toBe("1.000000");
    expect(result.boundBy).toBe("max_daily_usdc");
  });

  it("clamps to wallet balance minus reserve when balance is low", () => {
    const result = clampDecision(decision({ amountUsdc: "1.00" }), {
      guardrails,
      walletUsdcBalance: "0.80",
      alreadySpentTodayUsdc: "0",
    });
    expect(result.proceed).toBe(true);
    expect(result.amountUsdc).toBe("0.300000");
    expect(result.boundBy).toBe("wallet_available_after_reserve");
  });

  it("skips below dust threshold", () => {
    const result = clampDecision(decision({ amountUsdc: "0.05" }), {
      guardrails,
      walletUsdcBalance: "10",
      alreadySpentTodayUsdc: "0",
    });
    expect(result.proceed).toBe(false);
    expect(result.skipReason).toBe("below_dust_threshold");
  });

  it("skips when today's daily cap is already exhausted", () => {
    const result = clampDecision(decision({ amountUsdc: "0.50" }), {
      guardrails,
      walletUsdcBalance: "10",
      alreadySpentTodayUsdc: "1.00",
    });
    expect(result.proceed).toBe(false);
    expect(result.skipReason).toBe("daily_cap_exhausted");
  });

  it("clamps to remaining campaign budget when provided", () => {
    const result = clampDecision(decision({ amountUsdc: "1.00" }), {
      guardrails,
      walletUsdcBalance: "10",
      alreadySpentTodayUsdc: "0",
      remainingCampaignBudgetUsdc: "0.20",
    });
    expect(result.proceed).toBe(true);
    expect(result.amountUsdc).toBe("0.200000");
    expect(result.boundBy).toBe("remaining_campaign_budget");
  });

  it("allows the LLM's own recommendation when it is the tightest constraint", () => {
    const result = clampDecision(decision({ amountUsdc: "0.30" }), {
      guardrails,
      walletUsdcBalance: "10",
      alreadySpentTodayUsdc: "0",
    });
    expect(result.proceed).toBe(true);
    expect(result.amountUsdc).toBe("0.300000");
    expect(result.boundBy).toBe("llm_recommendation");
  });
});
