import type { ClampedDecision, ClaudeDecision, GuardrailConfig } from "../types.js";

function toNumber(value: string | undefined, fallback = 0): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The sole authority on how much USDC actually gets swapped. Claude's
 * amountUsdc is only a recommendation -- every path here re-derives the cap
 * from hard-coded/env-configured guardrails and never trusts the LLM's own
 * arithmetic about remaining budget.
 */
export function clampDecision(
  raw: ClaudeDecision,
  params: {
    guardrails: GuardrailConfig;
    walletUsdcBalance: string;
    alreadySpentTodayUsdc: string;
    remainingCampaignBudgetUsdc?: string;
  },
): ClampedDecision {
  if (!raw.proceed) {
    return { proceed: false, amountUsdc: "0", boundBy: "llm_declined", skipReason: "llm_declined" };
  }

  const rawAmount = Number.parseFloat(raw.amountUsdc);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return { proceed: false, amountUsdc: "0", boundBy: "invalid_llm_amount", skipReason: "invalid_llm_amount" };
  }

  const { guardrails, walletUsdcBalance, alreadySpentTodayUsdc, remainingCampaignBudgetUsdc } = params;

  const maxDaily = toNumber(guardrails.maxDailyUsdc);
  const minReserve = toNumber(guardrails.minUsdcReserve);
  const minSwap = toNumber(guardrails.minSwapUsdc);
  const balance = toNumber(walletUsdcBalance);
  const spentToday = toNumber(alreadySpentTodayUsdc);
  const available = balance - minReserve;
  const remainingDailyCap = maxDaily - spentToday;
  const remainingCampaign = remainingCampaignBudgetUsdc !== undefined ? toNumber(remainingCampaignBudgetUsdc) : Number.POSITIVE_INFINITY;

  const candidates: Array<{ label: string; value: number }> = [
    { label: "llm_recommendation", value: rawAmount },
    { label: "max_daily_usdc", value: maxDaily },
    { label: "wallet_available_after_reserve", value: Math.max(0, available) },
    { label: "remaining_daily_cap", value: Math.max(0, remainingDailyCap) },
    { label: "remaining_campaign_budget", value: remainingCampaign },
  ];

  const binding = candidates.reduce((min, c) => (c.value < min.value ? c : min));
  const cap = Math.max(0, binding.value);

  if (cap < minSwap) {
    const skipReason = remainingDailyCap <= 0 ? "daily_cap_exhausted" : "below_dust_threshold";
    return { proceed: false, amountUsdc: "0", boundBy: binding.label, skipReason };
  }

  return { proceed: true, amountUsdc: cap.toFixed(6), boundBy: binding.label };
}
