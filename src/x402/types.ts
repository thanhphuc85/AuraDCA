// x402 (HTTP 402 "Payment Required") — minimal, honest slice.
//
// The agent pays for a metered input (here: a "premium" market brief) with a
// signed USDC payment authorization, per the x402 `exact` scheme. This file is
// the shared vocabulary; the crypto lives in payment.ts (pure, unit-tested), the
// server challenge in api/x402-brief.ts, the paying client in client.ts.
//
// Honest-mode note: in this slice the payment is *authorized and cryptographically
// verified* but NOT broadcast on-chain (settlement is gated off) — mirroring the
// project's paper-fill pattern for the cirBTC outage. The signature produced is
// the exact EIP-3009 `transferWithAuthorization` a facilitator would settle, so
// flipping settlement on later needs no change to what gets signed.

export const X402_VERSION = 1;

/**
 * What the server demands to release a resource — the body of a 402 response
 * (`accepts[]`). Matches the x402 `exact`-scheme PaymentRequirements shape.
 */
export interface PaymentRequirements {
  scheme: "exact";
  network: string; // human network id, e.g. "arc-testnet"
  maxAmountRequired: string; // atomic units of `asset` (USDC has 6 dp)
  resource: string; // the path being paid for
  description: string;
  mimeType: string;
  payTo: string; // recipient wallet (the service)
  maxTimeoutSeconds: number; // how long the signed authorization stays valid
  asset: string; // ERC-20 (USDC) contract address
  // EIP-712 domain the authorization is signed under, carried so client and
  // server agree exactly. verifyingContract is the USDC token (EIP-3009 lives on
  // the token itself).
  extra: { name: string; version: string; chainId: number; verifyingContract: string };
}

/** The EIP-3009 authorization the payer signs (TransferWithAuthorization). */
export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string; // atomic units
  validAfter: string; // unix seconds
  validBefore: string; // unix seconds
  nonce: string; // 0x-prefixed 32-byte hex
}

/** The decoded `X-PAYMENT` header the client sends on retry. */
export interface PaymentPayload {
  x402Version: number;
  scheme: "exact";
  network: string;
  payload: { signature: string; authorization: Eip3009Authorization };
}

/** Result of verifying a PaymentPayload against its PaymentRequirements. */
export interface VerifyResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string; // recovered signer when valid
}

/** The `X-PAYMENT-RESPONSE` the server returns after honoring a payment. */
export interface SettlementResponse {
  success: boolean;
  settled: boolean; // false in honest verify-only mode
  mode: "verified-only" | "settled";
  network: string;
  payer?: string;
  authorizedAmount: string; // atomic units the payer authorized
  note?: string;
}
