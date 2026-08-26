// FLOP testnet faucet + auto-spend — additive, gated, honest scaffold.
//
// Context: Arc/FLOP announced that testnet faucet tokens will be exposed on
// Technocore.chat, "accessible by agents holding a DID key", and that the $FLOP
// airdrop weights testnet activity. The full spec (faucet endpoint shape + the
// exact DID authentication scheme) is NOT public yet — the announcement says
// details are "coming soon".
//
// So this module is deliberately a SCAFFOLD, mirroring the project's x402 ethos:
//   - Inert by default (FLOP_FAUCET_ENABLED / FLOP_AUTOSPEND_ENABLED = false).
//   - Never touches the live DCA money path (run.ts) — purely additive.
//   - The pure decision logic (gating, cooldown, request assembly, response
//     parsing, spend planning) is real and unit-tested NOW.
//   - The two spec-dependent seams are injected, not guessed: the DID `signProof`
//     signer and the faucet URL. Until a real signer is wired, an enabled claim
//     refuses to POST rather than send a fabricated proof to a real endpoint.
//
// When FLOP publishes the spec, wiring is: implement `signProof` against their
// DID scheme, set FLOP_FAUCET_URL, and (optionally) route planned spend through
// the existing clampDecision() guardrail — which stays the sole spend authority.

/** A decentralized identifier plus the wallet address the faucet should credit. */
export interface FlopDidIdentity {
  /** e.g. "did:key:z6Mk…" or "did:pkh:eip155:5042002:0x…" — scheme TBD by FLOP. */
  did: string;
  /** The wallet the faucet credits (the agent's Arc Testnet address). */
  address: string;
}

/**
 * The challenge a faucet claim is signed over. Exact fields are spec-dependent;
 * this is the honest minimum (who, where, when, anti-replay) a DID-authenticated
 * faucet would bind a proof to. Passed to the injected `signProof`.
 */
export interface ProofChallenge {
  did: string;
  address: string;
  /** Unix seconds — bounds proof validity / replay window. */
  issuedAt: number;
  /** 0x-prefixed random nonce for replay protection. */
  nonce: string;
}

/** The body POSTed to the faucet. `proof` is an opaque DID proof (JWT/JWS/sig). */
export interface FaucetClaimRequest {
  did: string;
  address: string;
  proof: string;
  nonce: string;
  issuedAt: number;
}

export type FaucetOutcome =
  | "claimed"
  | "skipped_disabled" // FLOP_FAUCET_ENABLED is not "true"
  | "skipped_unconfigured" // enabled, but URL / identity / DID signer missing
  | "skipped_cooldown" // last claim is still within the cooldown window
  | "error_http" // faucet returned a non-2xx / unreachable
  | "error_rejected"; // faucet rejected the proof / claim

/** Outcome of one faucet claim attempt. */
export interface FaucetResult {
  outcome: FaucetOutcome;
  reason: string;
  /** Token amount credited (decimal string), when the faucet reports it. */
  amount?: string;
  token?: string;
  txHash?: string;
  explorerUrl?: string;
  /** ISO timestamp of a successful claim — persist this to enforce cooldown. */
  claimedAt?: string;
}

/**
 * A planned auto-spend after a faucet top-up. This is only a RECOMMENDATION —
 * exactly like Claude's output in the DCA pipeline. The caller MUST still pass
 * `amountUsdc` through clampDecision() (the sole spend authority) before any
 * real transfer. `proceed:false` means "do nothing".
 */
export interface FaucetSpendPlan {
  proceed: boolean;
  amountUsdc: string;
  reason: string;
}
