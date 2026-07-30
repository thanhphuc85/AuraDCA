import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildRequirements } from "../src/x402/config.js";
import { decodePayment, verifyPayment } from "../src/x402/payment.js";
import { ARC_AGENT_ADDRESS } from "../src/ledger/constants.js";
import { X402_VERSION, type SettlementResponse } from "../src/x402/types.js";

// x402-metered "premium market brief" endpoint.
//
// First request with no `X-PAYMENT` header → HTTP 402 + the payment requirements
// (the `accepts[]` a client signs against). A retry carrying a signed USDC
// authorization is cryptographically VERIFIED and then served — but the payment
// is NOT settled on-chain in this honest slice (settlement gated off, mirroring
// the project's paper-fill pattern). The signature is the exact EIP-3009
// `transferWithAuthorization` a facilitator would settle, so turning settlement
// on later requires no change to what the client signs.

const RESOURCE = "/api/x402-brief";

function encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf-8").toString("base64");
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-PAYMENT");
  res.setHeader("Access-Control-Expose-Headers", "X-PAYMENT-RESPONSE");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  // The service wallet paid for the brief — the agent's own treasury by default,
  // so "the agent pays for its inputs" is self-contained on testnet.
  const payTo = process.env.X402_PAY_TO?.trim() || ARC_AGENT_ADDRESS;
  const requirements = buildRequirements({
    resource: RESOURCE,
    description: "Aura DCA — premium market brief (x402-metered, USDC on Arc Testnet)",
    payTo,
  });

  const header = req.headers["x-payment"];
  const paymentHeader = Array.isArray(header) ? header[0] : header;

  // No payment yet → challenge with 402 + requirements.
  if (!paymentHeader) {
    res.status(402).json({
      x402Version: X402_VERSION,
      error: "payment required",
      accepts: [requirements],
    });
    return;
  }

  // A payment was presented → verify it (no settlement).
  const payload = decodePayment(paymentHeader);
  if (!payload) {
    res.status(402).json({ x402Version: X402_VERSION, error: "malformed X-PAYMENT header", accepts: [requirements] });
    return;
  }

  const result = verifyPayment(payload, requirements);
  if (!result.isValid) {
    res.status(402).json({ x402Version: X402_VERSION, error: `payment invalid: ${result.invalidReason}`, accepts: [requirements] });
    return;
  }

  // Verified. Serve the paid resource and report the (unsettled) payment.
  const settlement: SettlementResponse = {
    success: true,
    settled: false,
    mode: "verified-only",
    network: requirements.network,
    payer: result.payer,
    authorizedAmount: requirements.maxAmountRequired,
    note: "Testnet honest mode: authorization verified, not broadcast on-chain.",
  };
  res.setHeader("X-PAYMENT-RESPONSE", encode(settlement));
  res.status(200).json({
    resource: RESOURCE,
    generatedAt: new Date().toISOString(),
    paidBy: result.payer,
    brief: {
      note: "Premium brief unlocked via a verified x402 USDC payment authorization.",
      network: requirements.network,
      priceUsdcAtomic: requirements.maxAmountRequired,
    },
  });
}
