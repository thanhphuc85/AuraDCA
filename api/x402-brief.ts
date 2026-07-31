import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildRequirements, X402_BRIEF_PRICE_USDC } from "../src/x402/config.js";
import { decodePayment, verifyPayment, usdcToAtomic } from "../src/x402/payment.js";
import { isSettlementEnabled, facilitatorUrl } from "../src/x402/settle.js";
import { ARC_AGENT_ADDRESS } from "../src/ledger/constants.js";
import { ARC_TESTNET_EXPLORER } from "../src/config.js";
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

  // Full on-chain settlement (gated). When on, this endpoint speaks Circle
  // Gateway's batched-x402 protocol and SETTLES each payment on-chain (returning
  // a tx hash) instead of the verify-only handshake below.
  if (isSettlementEnabled()) {
    await handleGatewaySettled(req, res, payTo);
    return;
  }

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

/**
 * On-chain settlement path (X402_SETTLE_ENABLED). Speaks Circle Gateway's batched
 * x402 protocol via the official middleware: challenges with a 402, then verifies
 * AND settles the presented payment on-chain before releasing the brief. Vercel's
 * req/res are Node http objects, so the Express-style middleware runs directly —
 * it answers the 402 itself, or calls next() once settlement (with a tx hash) is
 * done, at which point we serve the brief.
 */
async function handleGatewaySettled(req: VercelRequest, res: VercelResponse, payTo: string): Promise<void> {
  const { createGatewayMiddleware } = await import("@circle-fin/x402-batching/server");
  const gateway = createGatewayMiddleware({
    sellerAddress: payTo,
    networks: "eip155:5042002", // Arc Testnet (CAIP-2)
    facilitatorUrl: facilitatorUrl(),
    description: "Aura DCA — premium market brief (x402 settled via Circle Gateway)",
  });
  const middleware = gateway.require(`$${X402_BRIEF_PRICE_USDC}`);

  let paid = false;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    res.on("finish", done);
    res.on("close", done);
    Promise.resolve(middleware(req as never, res as never, (err?: unknown) => {
      if (!err) paid = true;
      done();
    })).catch(done);
  });

  if (!paid) {
    // Middleware already sent the 402 challenge (or an error). Guard against a
    // hung request if it somehow returned without writing a response.
    if (!res.writableEnded) {
      res.status(402).json({ x402Version: X402_VERSION, error: "payment required or settlement failed" });
    }
    return;
  }

  const payment = (req as unknown as {
    payment?: { transaction?: string; payer?: string; amount?: string; network?: string };
  }).payment ?? {};
  res.status(200).json({
    resource: RESOURCE,
    generatedAt: new Date().toISOString(),
    paidBy: payment.payer,
    settlement: {
      settled: true,
      mode: "settled",
      txHash: payment.transaction,
      explorerUrl: payment.transaction ? `${ARC_TESTNET_EXPLORER}/tx/${payment.transaction}` : undefined,
      network: payment.network,
      authorizedAmount: payment.amount,
    },
    brief: {
      note: "Premium brief unlocked via a SETTLED x402 USDC payment (Circle Gateway).",
      network: payment.network,
      priceUsdcAtomic: usdcToAtomic(X402_BRIEF_PRICE_USDC),
    },
  });
}
