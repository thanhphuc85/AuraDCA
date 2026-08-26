// FLOP faucet + auto-spend configuration. All flags default OFF, read lazily from
// process.env (never trusted to the LLM) — matching the x402 / attestation gates.

import type { FlopDidIdentity } from "./types.js";

/** Master switch: the faucet claim is inert unless this is exactly "true". */
export function isFaucetEnabled(): boolean {
  return (process.env.FLOP_FAUCET_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Second switch: auto-spend after a claim is inert unless this is "true". */
export function isAutoSpendEnabled(): boolean {
  return (process.env.FLOP_AUTOSPEND_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** The faucet endpoint. Undefined until FLOP publishes it and it's set in env. */
export function faucetUrl(): string | undefined {
  return process.env.FLOP_FAUCET_URL?.trim() || undefined;
}

/** Token symbol the faucet dispenses (defaults to FLOP). */
export function faucetToken(): string {
  return process.env.FLOP_FAUCET_TOKEN?.trim() || "FLOP";
}

/** Cooldown between claims, in ms (default 24h). Prevents hammering the faucet. */
export function faucetCooldownMs(): number {
  const hours = Number.parseFloat((process.env.FLOP_FAUCET_COOLDOWN_HOURS ?? "").trim());
  return Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : 24 * 3_600_000;
}

/**
 * Hard ceiling on any single auto-spend, in whole USDC (default 0.10). This is a
 * belt-and-braces cap on top of the DCA guardrails the spend must still pass —
 * the faucet path can never exceed this even if misconfigured.
 */
export function autoSpendMaxUsdc(): string {
  const raw = (process.env.FLOP_AUTOSPEND_MAX_USDC ?? "").trim();
  return /^\d+(\.\d+)?$/.test(raw) ? raw : "0.10";
}

/**
 * The agent's DID identity, or undefined if not fully configured. FLOP_DID is the
 * decentralized identifier; the address is the wallet the faucet credits. The DID
 * *signing key* (FLOP_DID_PRIVATE_KEY) is read only inside the injected signer,
 * never returned here — keep it out of logs and out of the claim body.
 */
export function loadDidIdentity(): FlopDidIdentity | undefined {
  const did = process.env.FLOP_DID?.trim();
  const address = process.env.FLOP_DID_ADDRESS?.trim();
  if (!did || !address) return undefined;
  return { did, address };
}

/** True once a real DID signing key is present for the injected signer to use. */
export function hasDidSigningKey(): boolean {
  return Boolean(process.env.FLOP_DID_PRIVATE_KEY?.trim());
}
