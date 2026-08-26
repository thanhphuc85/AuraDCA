// Real Ed25519 DID signer for the Technocore.chat scheme observed in the wild:
// writes are Ed25519 signatures bound to a `did:key:z6Mk…` identifier. Unlike the
// faucet's injected `signProof` (whose exact challenge shape FLOP hasn't published),
// the *signing primitive* here is fully specified — Ed25519 over canonical bytes —
// so it is implemented for real and unit-tested against a fixed vector.
//
// Honest scope: this file only turns a private seed you supply into (a) its
// `did:key`, and (b) a function that signs bytes. It performs NO network I/O and
// never logs, returns, or embeds the raw seed. The one still-unpublished seam —
// how Technocore canonicalizes the message before signing — is isolated in
// `canonicalize()` so it can be swapped without touching key handling.

import { createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Multicodec varint prefix for an Ed25519 public key (0xed → varint [0xed,0x01]). */
const ED25519_PUB_MULTICODEC = Uint8Array.of(0xed, 0x01);
/** Fixed PKCS#8 DER header that wraps a raw 32-byte Ed25519 seed for node:crypto. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** base58btc (Bitcoin alphabet) encode — the multibase body of a `did:key`. */
export function base58btcEncode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let k = digits.length - 1; k >= 0; k--) out += BASE58_ALPHABET[digits[k]!];
  return out;
}

/** Derive `did:key:z6Mk…` from a raw 32-byte Ed25519 public key. */
export function didKeyFromEd25519PublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, got ${publicKey.length}`);
  }
  const prefixed = new Uint8Array(ED25519_PUB_MULTICODEC.length + publicKey.length);
  prefixed.set(ED25519_PUB_MULTICODEC, 0);
  prefixed.set(publicKey, ED25519_PUB_MULTICODEC.length);
  return `did:key:z${base58btcEncode(prefixed)}`;
}

/** Import a raw 32-byte Ed25519 seed and derive its key object + raw public key. */
export function ed25519KeyFromSeed(seed: Uint8Array): { privateKey: KeyObject; publicKey: Uint8Array } {
  if (seed.length !== 32) {
    throw new Error(`Ed25519 seed must be 32 bytes, got ${seed.length}`);
  }
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  // The raw 32-byte public key is the trailing 32 bytes of the SPKI DER export.
  // (Cast: @types/node 26 dropped KeyObject from createPublicKey's input union,
  // though node accepts a private KeyObject to derive its public key at runtime.)
  const spki = createPublicKey(privateKey as unknown as Buffer).export({ format: "der", type: "spki" }) as Buffer;
  return { privateKey, publicKey: Uint8Array.from(spki.subarray(spki.length - 32)) };
}

/**
 * Parse seed material from an env string into a raw 32-byte Ed25519 seed. Accepts:
 *   - 64 hex chars (optionally 0x-prefixed) → the 32-byte seed;
 *   - 128 hex chars → a 64-byte libsodium secret key, of which the first 32 = seed;
 *   - base64 / base64url of 32 or 64 bytes (64 → first 32).
 * Throws on anything else rather than silently truncating unknown material.
 */
export function parseSeedMaterial(raw: string): Uint8Array {
  const s = raw.trim();
  const hex = s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
  if (/^[0-9a-fA-F]+$/.test(hex) && (hex.length === 64 || hex.length === 128)) {
    return Uint8Array.from(Buffer.from(hex.slice(0, 64), "hex"));
  }
  // Fall back to base64 / base64url (Buffer's base64 decoder accepts both).
  if (/^[A-Za-z0-9_\-+/]+={0,2}$/.test(s)) {
    const buf = Buffer.from(s, "base64");
    if (buf.length === 32 || buf.length === 64) return Uint8Array.from(buf.subarray(0, 32));
  }
  throw new Error("FLOP_DID_PRIVATE_KEY must be a 32-byte Ed25519 seed as hex (64 chars) or base64");
}

/** Recursively key-sort a JSON value so equal objects serialize to identical bytes. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Canonical JSON: compact, recursively key-sorted. These are the exact bytes signed
 * and re-signed by a verifier. Technocore's precise canonicalization isn't published,
 * so this is the single seam to adjust if the wire form turns out to differ — key
 * handling and the signature primitive stay put.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** A DID-bound message signer. `sign` returns a base64url signature over `bytes`. */
export interface DidSigner {
  readonly did: string;
  readonly algorithm: "Ed25519";
  sign(bytes: Uint8Array): string;
}

/** Build an Ed25519 `DidSigner` from a raw 32-byte seed. */
export function createEd25519Signer(seed: Uint8Array): DidSigner {
  const { privateKey, publicKey } = ed25519KeyFromSeed(seed);
  const did = didKeyFromEd25519PublicKey(publicKey);
  return {
    did,
    algorithm: "Ed25519",
    sign: (bytes) => Buffer.from(sign(null, Buffer.from(bytes), privateKey)).toString("base64url"),
  };
}

/**
 * Load the signer from env (FLOP_DID_PRIVATE_KEY). Returns undefined when no key is
 * set. If FLOP_DID is also set, it must match the did:key derived from the seed —
 * a mismatch throws, so a misconfigured identity can never sign under the wrong DID.
 * The raw seed is confined to this call; only the resulting signer escapes.
 */
export function loadSignerFromEnv(env: NodeJS.ProcessEnv = process.env): DidSigner | undefined {
  const raw = env.FLOP_DID_PRIVATE_KEY?.trim();
  if (!raw) return undefined;
  const signer = createEd25519Signer(parseSeedMaterial(raw));
  const declared = env.FLOP_DID?.trim();
  if (declared && declared !== signer.did) {
    throw new Error(
      `FLOP_DID (${declared}) does not match the did:key derived from FLOP_DID_PRIVATE_KEY (${signer.did})`,
    );
  }
  return signer;
}
