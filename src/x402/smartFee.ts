import type { Ledger } from "../types.js";
import type { UserSpend } from "../ledger/schedule.js";
import { ARC_AGENT_ADDRESS, USDC_DECIMALS } from "../ledger/constants.js";
import { logger } from "../logger.js";

/**
 * Smart-mode execution fee — a testnet DEMO of x402 pay-per-execution.
 *
 * When a smart-mode user's LIVE buy actually executes, we charge a small flat
 * USDC fee, deducted from their DEPOSITED balance (ledger `usdcBalance`) and
 * accrued to the agent treasury. It is framed as an x402-metered micropayment
 * (user → treasury) but is accounted at the ledger level: the autonomous run
 * fires hourly while the user is offline, so there is no live signature to sign a
 * real on-chain payment — this is a demo, clearly badged, never a real transfer.
 *
 * SAFETY / scope:
 *   - Gated: inert unless X402_SMART_FEE_ENABLED=true.
 *   - LIVE fills only. Paper (simulated) fills touch no real balance, so they are
 *     never charged — the caller must pass only spends whose real swap executed.
 *   - Smart users only (spend.sizeMultiplier != null); auto/manual users pay nothing.
 *   - Never over-charges: the fee is clamped to the user's remaining balance, so
 *     usdcBalance can never go negative.
 */

export const DEFAULT_SMART_FEE_USDC = 0.01;

export interface SmartFeeReceipt {
  feeUsdcEach: string; // the flat fee rate applied per smart payer this run
  totalUsdc: string; // sum actually charged across all payers
  payerCount: number; // how many smart users were charged (fee > 0)
  payTo: string; // treasury address the fee accrues to
  testnet: true; // demo fee — never a real on-chain user payment
  // Filled by run.ts when the collected fee is settled on-chain via Circle Gateway
  // (X402_SETTLE_ENABLED + X402_SMART_FEE_URL). Absent = ledger-accounted only.
  settled?: boolean;
  transferId?: string;
  settleStatus?: string;
  txHash?: string;
  explorerUrl?: string;
}

export function isSmartFeeEnabled(): boolean {
  return (process.env.X402_SMART_FEE_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** The configured per-fill fee, in USDC. Falls back to the default when unset/invalid. */
export function smartFeePerFillUsdc(): number {
  const raw = Number.parseFloat((process.env.X402_SMART_FEE_USDC ?? "").trim());
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SMART_FEE_USDC;
}

/**
 * Charge the smart execution fee for a run's LIVE-executed spends. Mutates the
 * ledger (debits each smart payer's usdcBalance, bumps totalSmartFeesPaidUsdc) and
 * returns a receipt for the run entry, or null when nothing was charged (feature
 * off, no smart payers, or every candidate had a zero balance). Never throws.
 */
export function chargeSmartExecutionFee(
  ledger: Ledger,
  liveExecutedSpends: UserSpend[],
  runTimestamp: string,
  opts: { feeUsdc?: number; payTo?: string } = {},
): SmartFeeReceipt | null {
  try {
    if (!isSmartFeeEnabled()) return null;

    const fee = opts.feeUsdc ?? smartFeePerFillUsdc();
    if (!(fee > 0)) return null;
    const payTo = opts.payTo ?? ARC_AGENT_ADDRESS;

    // One charge per smart user per run: a user DCAs into a single token, so they
    // appear in exactly one live group — but dedupe defensively anyway.
    const smartPayers = new Set<string>();
    for (const s of liveExecutedSpends) {
      if (s.sizeMultiplier != null) smartPayers.add(s.address);
    }
    if (smartPayers.size === 0) return null;

    let total = 0;
    let payerCount = 0;
    for (const address of smartPayers) {
      const user = ledger.users[address];
      if (!user) continue;
      const balance = Number.parseFloat(user.usdcBalance || "0");
      const charged = Number.parseFloat(Math.max(0, Math.min(fee, balance)).toFixed(USDC_DECIMALS));
      if (charged <= 0) continue;
      user.usdcBalance = Math.max(0, balance - charged).toFixed(USDC_DECIMALS);
      user.totalSmartFeesPaidUsdc = (Number.parseFloat(user.totalSmartFeesPaidUsdc ?? "0") + charged).toFixed(USDC_DECIMALS);
      user.lastActivity = runTimestamp;
      total += charged;
      payerCount++;
    }
    if (payerCount === 0) return null;

    const receipt: SmartFeeReceipt = {
      feeUsdcEach: fee.toFixed(USDC_DECIMALS),
      totalUsdc: total.toFixed(USDC_DECIMALS),
      payerCount,
      payTo,
      testnet: true,
    };
    logger.info(`x402 smart fee: charged ${receipt.totalUsdc} USDC across ${payerCount} smart payer(s) → ${payTo} (testnet demo, ${receipt.feeUsdcEach}/fill)`);
    return receipt;
  } catch (err) {
    logger.warn(`x402 smart fee charge failed (non-fatal): ${(err as Error).message}`);
    return null;
  }
}
