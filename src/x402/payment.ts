import { ethers } from "ethers";
import type { Eip3009Authorization, PaymentPayload, PaymentRequirements, VerifyResult } from "./types.js";
import { X402_VERSION } from "./types.js";

// EIP-3009 TransferWithAuthorization — the exact typed-data a USDC facilitator
// settles for the x402 `exact` scheme. We sign and verify the SAME struct, so an
// authorization accepted here would be accepted on-chain unchanged.
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function domainOf(req: PaymentRequirements): ethers.TypedDataDomain {
  return {
    name: req.extra.name,
    version: req.extra.version,
    chainId: req.extra.chainId,
    verifyingContract: req.extra.verifyingContract,
  };
}

/**
 * USDC amount (decimal string, e.g. "0.001") → atomic units string (6 dp). Pure
 * string math so no float ever touches a money amount.
 */
export function usdcToAtomic(amountUsdc: string, decimals = 6): string {
  const [whole, frac = ""] = amountUsdc.trim().split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0")).toString();
}

/**
 * Build an unsigned EIP-3009 authorization that pays exactly `maxAmountRequired`
 * to `payTo`. `nowSec` is injectable for deterministic tests; the authorization
 * is valid from now (minus a small skew) until now + maxTimeoutSeconds.
 */
export function buildAuthorization(
  from: string,
  req: PaymentRequirements,
  opts: { nowSec?: number; nonce?: string; clockSkewSec?: number } = {},
): Eip3009Authorization {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const skew = opts.clockSkewSec ?? 60;
  const nonce = opts.nonce ?? ethers.hexlify(ethers.randomBytes(32));
  return {
    from: ethers.getAddress(from),
    to: ethers.getAddress(req.payTo),
    value: req.maxAmountRequired,
    validAfter: String(now - skew),
    validBefore: String(now + req.maxTimeoutSeconds),
    nonce,
  };
}

/**
 * Sign an authorization into a full PaymentPayload (the decoded `X-PAYMENT`).
 * Any ethers signer works — a local test wallet here; productionizing to the
 * agent's Circle Developer-Controlled Wallet is the documented next step.
 */
export async function signPayment(
  signer: ethers.Signer,
  req: PaymentRequirements,
  opts: { nowSec?: number; nonce?: string } = {},
): Promise<PaymentPayload> {
  const from = await signer.getAddress();
  const authorization = buildAuthorization(from, req, opts);
  const signature = await signer.signTypedData(domainOf(req), TRANSFER_WITH_AUTHORIZATION_TYPES as unknown as Record<string, ethers.TypedDataField[]>, authorization);
  return { x402Version: X402_VERSION, scheme: "exact", network: req.network, payload: { signature, authorization } };
}

/**
 * Verify a PaymentPayload against the requirements WITHOUT settling: recover the
 * EIP-712 signer and check it authorized the exact recipient, at least the
 * required amount, on the right network, within its validity window. This is the
 * `verify` half of an x402 facilitator; `settle` (broadcast) is deliberately not
 * done in this honest-mode slice.
 */
export function verifyPayment(
  payload: PaymentPayload,
  req: PaymentRequirements,
  opts: { nowSec?: number } = {},
): VerifyResult {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const fail = (invalidReason: string): VerifyResult => ({ isValid: false, invalidReason });

  if (payload.x402Version !== X402_VERSION) return fail("unsupported_x402_version");
  if (payload.scheme !== "exact") return fail("unsupported_scheme");
  if (payload.network !== req.network) return fail("network_mismatch");

  const auth = payload.payload?.authorization;
  const sig = payload.payload?.signature;
  if (!auth || !sig) return fail("malformed_payload");

  // Recipient + amount must match what the server demanded.
  let payTo: string, to: string;
  try {
    payTo = ethers.getAddress(req.payTo);
    to = ethers.getAddress(auth.to);
  } catch {
    return fail("bad_address");
  }
  if (to !== payTo) return fail("wrong_recipient");

  let value: bigint, required: bigint;
  try {
    value = BigInt(auth.value);
    required = BigInt(req.maxAmountRequired);
  } catch {
    return fail("bad_amount");
  }
  if (value < required) return fail("insufficient_amount");

  // Validity window.
  const validAfter = Number(auth.validAfter);
  const validBefore = Number(auth.validBefore);
  if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore)) return fail("bad_validity");
  if (now < validAfter) return fail("not_yet_valid");
  if (now >= validBefore) return fail("authorization_expired");

  // Recover the signer and confirm it is the stated payer.
  let recovered: string;
  try {
    recovered = ethers.verifyTypedData(domainOf(req), TRANSFER_WITH_AUTHORIZATION_TYPES as unknown as Record<string, ethers.TypedDataField[]>, auth, sig);
  } catch {
    return fail("bad_signature");
  }
  if (ethers.getAddress(recovered) !== ethers.getAddress(auth.from)) return fail("signer_mismatch");

  return { isValid: true, payer: recovered };
}

/** Encode a PaymentPayload as the base64 `X-PAYMENT` header value. */
export function encodePayment(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

/** Decode a base64 `X-PAYMENT` header value; returns null if it isn't valid. */
export function decodePayment(header: string): PaymentPayload | null {
  try {
    const json = Buffer.from(header, "base64").toString("utf-8");
    const obj = JSON.parse(json);
    if (!obj || obj.scheme !== "exact" || !obj.payload) return null;
    return obj as PaymentPayload;
  } catch {
    return null;
  }
}
