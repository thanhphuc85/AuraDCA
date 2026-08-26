// Auto-spend after a faucet top-up — the "bot spends by itself once the project
// updates" half. This ONLY produces a recommendation; it is never the spend
// authority. The caller must pass the returned amount through clampDecision()
// (src/decision/guardrails.ts), which stays the sole owner of the real number —
// this planner just decides whether to propose a spend at all, and caps it.

import { autoSpendMaxUsdc, faucetToken, isAutoSpendEnabled } from "./config.js";
import type { FaucetResult, FaucetSpendPlan } from "./types.js";

export interface PlanFaucetSpendInput {
  /** The faucet claim result this spend would follow. */
  faucet: FaucetResult;
  /** Current spendable USDC balance (decimal string). */
  balanceUsdc: string;
  /** Whole-USDC amount to spend per cycle if proceeding (defaults to the cap). */
  desiredUsdc?: string;
}

/** Decimal-string min, avoiding float drift for the small values in play here. */
function minDecimal(a: string, b: string): string {
  return Number(a) <= Number(b) ? a : b;
}

/**
 * Decide whether to auto-spend after a faucet claim, and how much to PROPOSE.
 * Gating:
 *   - FLOP_AUTOSPEND_ENABLED must be "true";
 *   - the faucet must actually have claimed (no spending on a skip/error);
 *   - proposed amount is capped at min(desired, FLOP_AUTOSPEND_MAX_USDC, balance).
 * Returns `proceed:false` with a reason otherwise. The amount is still only a
 * recommendation — clampDecision() has the final say.
 */
export function planFaucetSpend(input: PlanFaucetSpendInput): FaucetSpendPlan {
  if (!isAutoSpendEnabled()) {
    return { proceed: false, amountUsdc: "0", reason: "FLOP_AUTOSPEND_ENABLED is not true" };
  }
  if (input.faucet.outcome !== "claimed") {
    return { proceed: false, amountUsdc: "0", reason: `no faucet credit to spend (faucet outcome: ${input.faucet.outcome})` };
  }

  const cap = autoSpendMaxUsdc();
  const desired = input.desiredUsdc && /^\d+(\.\d+)?$/.test(input.desiredUsdc) ? input.desiredUsdc : cap;
  const balance = /^\d+(\.\d+)?$/.test(input.balanceUsdc) ? input.balanceUsdc : "0";

  const proposed = minDecimal(minDecimal(desired, cap), balance);
  if (Number(proposed) <= 0) {
    return { proceed: false, amountUsdc: "0", reason: "no spendable balance after applying the auto-spend cap" };
  }

  return {
    proceed: true,
    amountUsdc: proposed,
    reason: `faucet-funded ${faucetToken()} top-up; proposing ${proposed} USDC (cap ${cap}), pending clampDecision()`,
  };
}
