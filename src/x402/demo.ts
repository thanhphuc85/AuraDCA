import { ethers } from "ethers";
import { buildRequirements, X402_NETWORK } from "./config.js";
import { signPayment, verifyPayment, encodePayment, decodePayment } from "./payment.js";
import { fetchWithX402 } from "./client.js";
import { logger } from "../logger.js";

// Reproducible x402 probe — like check-routes / prove-swap / sample-fx.
//
//   npm run x402-demo              → offline: sign a USDC payment authorization
//                                    for the brief and verify it end-to-end.
//   X402_BRIEF_URL=<url> npm run x402-demo
//                                  → live: hit a deployed /api/x402-brief, get a
//                                    402, pay, and read the unlocked resource.
//
// No real funds move: the authorization is signed and cryptographically verified
// (the `verify` half of an x402 facilitator); settlement (`settle`) is gated off.

async function offlineRoundTrip(): Promise<void> {
  // A throwaway payer — stands in for the agent's wallet. Productionizing to the
  // Circle Developer-Controlled Wallet (server-side EIP-712 signing) is the next
  // step; the signed struct is identical either way.
  const payer = ethers.Wallet.createRandom();
  const requirements = buildRequirements({
    resource: "/api/x402-brief",
    description: "Aura DCA — premium market brief (offline demo)",
    payTo: ethers.Wallet.createRandom().address, // the "service" wallet
  });

  logger.info(`x402 offline demo — network ${X402_NETWORK}, price ${requirements.maxAmountRequired} atomic USDC`);
  logger.info(`Payer (agent stand-in): ${payer.address}`);
  logger.info(`Pay-to (service):        ${requirements.payTo}`);

  const payment = await signPayment(payer, requirements);
  const header = encodePayment(payment);
  logger.info(`Signed X-PAYMENT header (${header.length} b64 chars): ${header.slice(0, 48)}…`);

  // Server side: decode + verify exactly what a facilitator's `verify` does.
  const decoded = decodePayment(header)!;
  const result = verifyPayment(decoded, requirements);

  if (result.isValid) {
    logger.info(`✅ VERIFIED — payer ${result.payer} authorized ${requirements.maxAmountRequired} atomic USDC to ${requirements.payTo}`);
    logger.info("Settlement: SKIPPED (honest verify-only mode — no on-chain broadcast).");
  } else {
    logger.error(`❌ verification failed: ${result.invalidReason}`);
    process.exitCode = 1;
  }
}

async function liveRoundTrip(url: string): Promise<void> {
  const payer = ethers.Wallet.createRandom();
  logger.info(`x402 live demo → ${url}`);
  logger.info(`Payer (agent stand-in): ${payer.address}`);
  const res = await fetchWithX402(url, payer);
  logger.info(`HTTP ${res.status} — paid=${res.paid}`);
  if (res.requirements) logger.info(`Charged ${res.requirements.maxAmountRequired} atomic USDC → ${res.requirements.payTo}`);
  if (res.settlement) logger.info(`Settlement: settled=${res.settlement.settled} mode=${res.settlement.mode} (${res.settlement.note ?? ""})`);
  logger.info(`Resource: ${JSON.stringify(res.data)}`);
  if (!res.paid) process.exitCode = 1;
}

async function main(): Promise<void> {
  const url = process.env.X402_BRIEF_URL?.trim();
  if (url) await liveRoundTrip(url);
  else await offlineRoundTrip();
}

main().catch((err) => {
  logger.error("x402 demo failed", err);
  process.exitCode = 1;
});
