// FLOP testnet faucet claim — the DID-authenticated "top up my testnet balance"
// half. Everything network- or spec-dependent is injected, so the gating,
// cooldown, request assembly and response parsing are all pure and unit-tested.
//
// Honest scope: when enabled but no real DID signer is wired, the claim returns
// `skipped_unconfigured` INSTEAD of POSTing a fabricated proof to a live faucet.
// The real DID scheme (did-jwt / signed challenge) drops into the injected
// `signProof` with zero changes to this control flow.

import { randomBytes } from "node:crypto";
import { logger } from "../logger.js";
import {
  faucetCooldownMs,
  faucetToken,
  faucetUrl,
  hasDidSigningKey,
  isFaucetEnabled,
  loadDidIdentity,
} from "./config.js";
import type { FaucetClaimRequest, FaucetResult, FlopDidIdentity, ProofChallenge } from "./types.js";

/** Signs a DID proof over the challenge. Spec-dependent — injected, never guessed. */
export type ProofSigner = (challenge: ProofChallenge) => Promise<string>;

export interface ClaimFaucetOpts {
  fetchImpl?: typeof fetch;
  /** The DID proof signer. Absent ⇒ claim is treated as unconfigured (no POST). */
  signProof?: ProofSigner;
  /** Clock injection for deterministic cooldown tests. */
  now?: () => number;
  /** Unix ms of the last successful claim, for cooldown (caller persists this). */
  lastClaimAt?: number;
  /** Overrides for tests; otherwise resolved from env. */
  identity?: FlopDidIdentity;
  url?: string;
}

/** Pure: assemble the faucet claim body from an identity + a signed proof. */
export function buildClaimRequest(
  identity: FlopDidIdentity,
  challenge: ProofChallenge,
  proof: string,
): FaucetClaimRequest {
  return {
    did: identity.did,
    address: identity.address,
    proof,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
  };
}

/** Pure: normalize whatever the faucet returns into a claimed FaucetResult. */
export function parseFaucetResponse(body: unknown, token: string): FaucetResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const txHash = typeof b.txHash === "string" ? b.txHash : undefined;
  return {
    outcome: "claimed",
    reason: "faucet credited the agent wallet",
    token: typeof b.token === "string" ? b.token : token,
    amount: typeof b.amount === "string" ? b.amount : typeof b.amount === "number" ? String(b.amount) : undefined,
    txHash,
    explorerUrl: typeof b.explorerUrl === "string" ? b.explorerUrl : undefined,
    claimedAt: new Date().toISOString(),
  };
}

/**
 * Attempt a single faucet claim. Gating order (each an explicit, recorded skip):
 *   1. disabled           — FLOP_FAUCET_ENABLED != true
 *   2. unconfigured       — url / identity / DID signer missing
 *   3. cooldown           — last claim still inside the window
 *   4. POST + parse       — real claim
 *
 * Never throws: transport / rejection failures become `error_*` results so the
 * caller (a cron step) can record and move on, exactly like the DCA path.
 */
export async function claimFaucet(opts: ClaimFaucetOpts = {}): Promise<FaucetResult> {
  if (!isFaucetEnabled()) {
    return { outcome: "skipped_disabled", reason: "FLOP_FAUCET_ENABLED is not true" };
  }

  const url = opts.url ?? faucetUrl();
  const identity = opts.identity ?? loadDidIdentity();
  // A signer is required to produce the DID proof. Absent the real scheme, we
  // must NOT invent one and POST it to a live faucet — so the caller injects it.
  const signer = opts.signProof;

  if (!url || !identity) {
    return {
      outcome: "skipped_unconfigured",
      reason: !url ? "FLOP_FAUCET_URL is unset" : "FLOP_DID / FLOP_DID_ADDRESS are unset",
    };
  }
  if (!signer) {
    const keyHint = hasDidSigningKey()
      ? "FLOP_DID_PRIVATE_KEY is set, but the DID proof signer is not wired yet"
      : "no DID proof signer wired and FLOP_DID_PRIVATE_KEY is unset";
    return {
      outcome: "skipped_unconfigured",
      reason: `${keyHint} — see TODO(spec) in flop/faucet.ts once FLOP publishes the DID auth scheme`,
    };
  }

  const now = opts.now ?? Date.now;
  const cooldown = faucetCooldownMs();
  if (opts.lastClaimAt !== undefined && now() - opts.lastClaimAt < cooldown) {
    const waitMin = Math.ceil((cooldown - (now() - opts.lastClaimAt)) / 60_000);
    return { outcome: "skipped_cooldown", reason: `last claim was recent; ~${waitMin} min until eligible` };
  }

  const challenge: ProofChallenge = {
    did: identity.did,
    address: identity.address,
    issuedAt: Math.floor(now() / 1000),
    nonce: `0x${randomBytes(16).toString("hex")}`,
  };

  let proof: string;
  try {
    proof = await signer(challenge);
  } catch (err) {
    return { outcome: "error_rejected", reason: `DID proof signing failed: ${(err as Error).message}` };
  }

  const body = buildClaimRequest(identity, challenge, proof);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const outcome = res.status === 401 || res.status === 403 ? "error_rejected" : "error_http";
      return { outcome, reason: `faucet responded ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}` };
    }
    const json = await res.json().catch(() => ({}));
    const result = parseFaucetResponse(json, faucetToken());
    logger.info(`FLOP faucet: claimed${result.amount ? ` ${result.amount} ${result.token}` : ""}${result.txHash ? ` (tx ${result.txHash.slice(0, 12)}…)` : ""}`);
    return result;
  } catch (err) {
    return { outcome: "error_http", reason: `faucet unreachable: ${(err as Error).message}` };
  }
}
