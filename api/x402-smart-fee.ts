import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isSettlementEnabled, facilitatorUrl } from "../src/x402/settle.js";
import { ARC_AGENT_ADDRESS } from "../src/ledger/constants.js";
import { ARC_TESTNET_EXPLORER } from "../src/config.js";
import { X402_VERSION } from "../src/x402/types.js";

// x402-metered "smart execution fee" endpoint — the settle half of the smart-mode
// fee. The autonomous run calls this via Circle Gateway (Nanopayments) to settle a
// run's COLLECTED smart fee on-chain in one payment (agent → fee-collector), after
// the fee was already debited from users' deposited balances in the ledger. It is
// query-driven: `?amount=<decimal USDC>` sets the 402 price, clamped here to a hard
// ceiling so a caller bug can never drain the payer's Gateway balance.
//
// Settlement-only: unlike the brief, a fee has no "verified-only" mode — it exists
// solely to put a real tx hash on the collected fee. Inert (503) unless
// X402_SETTLE_ENABLED=true.

const RESOURCE = "/api/x402-smart-fee";

// Absolute ceiling on a single settled fee, regardless of the requested amount.
// A run's collected fee is tiny (payers × ~0.01 USDC); this only guards against a
// malformed/oversized request draining the agent's Gateway deposit.
const HARD_MAX_USDC = Number.parseFloat(process.env.X402_SMART_FEE_MAX_USDC?.trim() || "5");
const MIN_USDC = 0.000001; // one atomic unit

/** Parse + clamp the requested fee amount (decimal USDC) to a safe, positive range. */
function clampAmountUsdc(raw: unknown): number | null {
  const q = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseFloat(String(q ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.max(n, MIN_USDC), HARD_MAX_USDC);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-PAYMENT");
  res.setHeader("Access-Control-Expose-Headers", "X-PAYMENT-RESPONSE");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  // The fee accrues to the configured fee-collector (X402_PAY_TO), falling back to
  // the agent treasury so the endpoint is self-contained on testnet.
  const payTo = process.env.X402_PAY_TO?.trim() || ARC_AGENT_ADDRESS;

  // Fee settlement only makes sense on-chain — there is no verify-only fallback.
  if (!isSettlementEnabled()) {
    res.status(503).json({ error: "smart-fee settlement is disabled (X402_SETTLE_ENABLED is not true)" });
    return;
  }

  const amountUsdc = clampAmountUsdc(req.query.amount);
  if (amountUsdc == null) {
    res.status(400).json({ error: "missing or invalid ?amount= (decimal USDC, > 0)" });
    return;
  }
  const priceStr = amountUsdc.toFixed(6);

  const { createGatewayMiddleware } = await import("@circle-fin/x402-batching/server");
  const gateway = createGatewayMiddleware({
    sellerAddress: payTo,
    networks: "eip155:5042002", // Arc Testnet (CAIP-2)
    facilitatorUrl: facilitatorUrl(),
    description: "Aura DCA — smart execution fee (x402 settled via Circle Gateway)",
  });
  const middleware = gateway.require(`$${priceStr}`);

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
    // Middleware already sent the 402 challenge (or an error). Guard against a hung
    // request if it somehow returned without writing a response.
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
    settledAt: new Date().toISOString(),
    paidBy: payment.payer,
    settlement: {
      settled: true,
      mode: "settled",
      txHash: payment.transaction,
      explorerUrl: payment.transaction ? `${ARC_TESTNET_EXPLORER}/tx/${payment.transaction}` : undefined,
      network: payment.network,
      authorizedAmount: payment.amount,
    },
    fee: {
      note: "Smart execution fee settled on-chain via Circle Gateway (Nanopayments).",
      priceUsdc: priceStr,
    },
  });
}
