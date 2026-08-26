// FLOP faucet + auto-spend — public surface.
//
// Additive & gated: importing this file loads nothing and spends nothing. Both
// halves are inert until FLOP_FAUCET_ENABLED / FLOP_AUTOSPEND_ENABLED are "true"
// AND a real DID signer + faucet URL are wired. It deliberately does NOT hook
// into run.ts; wire it from a cron step once the FLOP spec lands (see README).

export * from "./types.js";
export * from "./config.js";
export { claimFaucet, buildClaimRequest, parseFaucetResponse, type ClaimFaucetOpts, type ProofSigner } from "./faucet.js";
export { planFaucetSpend, type PlanFaucetSpendInput } from "./autospend.js";
export {
  base58btcEncode,
  didKeyFromEd25519PublicKey,
  ed25519KeyFromSeed,
  parseSeedMaterial,
  canonicalize,
  createEd25519Signer,
  loadSignerFromEnv,
  type DidSigner,
} from "./signer.js";
export {
  isPostEnabled,
  technocoreBaseUrl,
  technocoreRoom,
  seqStorePath,
  postUrl,
  buildSignedMessage,
  parsePostResponse,
  postSignedMessage,
  saveSeq,
  loadSeqs,
  DEFAULT_SEQ_STORE,
  type SignedMessage,
  type BuildSignedMessageInput,
  type PostResult,
  type PostOutcome,
  type PostSignedMessageOpts,
  type SeqRecord,
} from "./technocore.js";

export {
  isTestnetEnabled,
  ledgerMode,
  flopRpcUrl,
  ledgerStorePath,
  isDecimal,
  isPositiveDecimal,
  addDecimal,
  subDecimal,
  cmpDecimal,
  loadLedger,
  checkBalance,
  creditToken,
  spendToken,
  DEFAULT_LEDGER_STORE,
  DEFAULT_TOKEN,
  type LedgerMode,
  type LedgerEntry,
  type LedgerState,
  type CreditTokenOpts,
  type CreditResult,
  type SpendOutcome,
  type SpendResult,
  type SpendTokenOpts,
  type SubmitTx,
} from "./ledger.js";

import { claimFaucet, type ClaimFaucetOpts } from "./faucet.js";
import { planFaucetSpend } from "./autospend.js";
import type { FaucetResult, FaucetSpendPlan } from "./types.js";

export interface FaucetCycleResult {
  faucet: FaucetResult;
  /** Only present when auto-spend is enabled and the claim succeeded. */
  plan?: FaucetSpendPlan;
}

/**
 * One faucet cycle: claim, then (if enabled) produce a spend RECOMMENDATION.
 * The plan is never executed here — the caller runs it through clampDecision()
 * and the existing swap path. Pure orchestration over the two gated halves.
 */
export async function runFaucetCycle(
  balanceUsdc: string,
  opts: ClaimFaucetOpts = {},
): Promise<FaucetCycleResult> {
  const faucet = await claimFaucet(opts);
  if (faucet.outcome !== "claimed") return { faucet };
  const plan = planFaucetSpend({ faucet, balanceUsdc });
  return { faucet, plan };
}
