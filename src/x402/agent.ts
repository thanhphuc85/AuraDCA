import { ethers } from "ethers";
import { buildRequirements } from "./config.js";
import { signPayment, verifyPayment } from "./payment.js";
import { fetchWithX402 } from "./client.js";
import { isSettlementEnabled, settleBriefViaGateway, type GatewayClientFactory } from "./settle.js";
import { ARC_AGENT_ADDRESS } from "../ledger/constants.js";
import { logger } from "../logger.js";

const RESOURCE = "/api/x402-brief";

export interface X402RunReceipt {
  resource: string;
  amountUsdcAtomic: string;
  payer: string;
  payTo: string;
  settled: boolean;
  mode: string;
  via: "http" | "in-process";
  // Present only when settled on-chain (Circle Gateway).
  transferId?: string; // Gateway transfer id — lets the dashboard resolve the hash
  settleStatus?: string; // Gateway transfer status (received | batched | confirmed…)
  txHash?: string; // on-chain settlement hash, once the batch lands
  explorerUrl?: string;
}

/**
 * Gated, best-effort: each run the agent pays a metered USDC micro-payment for
 * its market-brief input via x402 — turning "the agent pays for its own inputs"
 * into a literal per-run event.
 *
 * SAFETY: this NEVER throws to the caller and NEVER touches DCA money or state —
 * every path is wrapped and returns a receipt or null. It is inert unless
 * X402_ENABLED=true AND an X402_PAYER_PRIVATE_KEY is set (a dedicated testnet
 * key; signing with the agent's Circle wallet is the documented next step). With
 * X402_BRIEF_URL set it does a real HTTP pay-per-call; otherwise it runs the
 * sign→verify handshake in-process. Settlement stays gated off (verified-only).
 */
export async function payForMarketBriefBestEffort(
  opts: { settleClientFactory?: GatewayClientFactory; settleResolveFetch?: typeof fetch } = {},
): Promise<X402RunReceipt | null> {
  try {
    if ((process.env.X402_ENABLED ?? "").trim().toLowerCase() !== "true") return null;

    const pk = process.env.X402_PAYER_PRIVATE_KEY?.trim();
    if (!pk) {
      logger.warn("x402 enabled but X402_PAYER_PRIVATE_KEY is unset — skipping brief payment");
      return null;
    }
    let signer: ethers.Wallet;
    try {
      signer = new ethers.Wallet(pk);
    } catch {
      logger.warn("x402: X402_PAYER_PRIVATE_KEY is not a valid key — skipping brief payment");
      return null;
    }

    const payTo = process.env.X402_PAY_TO?.trim() || ARC_AGENT_ADDRESS;
    const requirements = buildRequirements({
      resource: RESOURCE,
      description: "Aura DCA — premium market brief (agent input, x402-metered)",
      payTo,
    });

    const url = process.env.X402_BRIEF_URL?.trim();

    // Full on-chain settlement (Circle Gateway "Nanopayments"), gated. Needs a
    // deployed Gateway-x402 endpoint and a payer holding a Gateway deposit. The
    // pay is gasless and returns a real settlement tx hash. A settle failure is
    // non-fatal: we fall through to the verified-only path below.
    if (url && isSettlementEnabled()) {
      try {
        const settled = await settleBriefViaGateway({
          privateKey: pk,
          url,
          depositUsdc: process.env.X402_DEPOSIT_USDC?.trim(),
          clientFactory: opts.settleClientFactory,
          resolveFetch: opts.settleResolveFetch,
        });
        const txNote = settled.txHash ? `tx ${settled.txHash}` : `transfer ${settled.transferId} (tx pending, status ${settled.status})`;
        logger.info(`x402: SETTLED ${settled.amountUsdcAtomic} atomic USDC for the market brief on-chain → ${txNote}`);
        return {
          resource: RESOURCE,
          amountUsdcAtomic: settled.amountUsdcAtomic,
          payer: settled.payer,
          payTo,
          settled: true,
          mode: "settled",
          via: "http",
          transferId: settled.transferId,
          settleStatus: settled.status,
          txHash: settled.txHash,
          explorerUrl: settled.explorerUrl,
        };
      } catch (err) {
        logger.warn(`x402: on-chain settlement failed (${(err as Error).message}) — falling back to verified-only`);
      }
    }

    // Custom-scheme HTTP pay-per-call — only when settlement is OFF. With
    // settlement on, the endpoint speaks the Gateway protocol (handled above), so
    // a settle failure falls through to the self-contained in-process handshake.
    if (url && !isSettlementEnabled()) {
      // Real network pay-per-call against a deployed endpoint.
      const res = await fetchWithX402(url, signer);
      if (!res.paid || !res.requirements) {
        logger.warn(`x402: brief not unlocked over HTTP (status ${res.status}) — continuing without it`);
        return null;
      }
      const settled = res.settlement?.settled ?? false;
      const mode = res.settlement?.mode ?? "verified-only";
      logger.info(`x402: paid ${res.requirements.maxAmountRequired} atomic USDC for the market brief → ${res.requirements.payTo} (settled=${settled}, http)`);
      return { resource: RESOURCE, amountUsdcAtomic: res.requirements.maxAmountRequired, payer: await signer.getAddress(), payTo: res.requirements.payTo, settled, mode, via: "http" };
    }

    // In-process handshake — self-contained, no endpoint required.
    const payment = await signPayment(signer, requirements);
    const result = verifyPayment(payment, requirements);
    if (!result.isValid || !result.payer) {
      logger.warn(`x402: self-verify failed (${result.invalidReason}) — continuing without the brief payment`);
      return null;
    }
    logger.info(`x402: signed+verified ${requirements.maxAmountRequired} atomic USDC for the market brief → ${payTo} (verified-only, not settled)`);
    return { resource: RESOURCE, amountUsdcAtomic: requirements.maxAmountRequired, payer: result.payer, payTo, settled: false, mode: "verified-only", via: "in-process" };
  } catch (err) {
    logger.warn(`x402 best-effort brief payment failed (non-fatal): ${(err as Error).message}`);
    return null;
  }
}
