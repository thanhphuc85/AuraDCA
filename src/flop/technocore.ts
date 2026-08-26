// Technocore.chat signed-message poster — the "post one signed tin into a room and
// keep its seq" half. Same ethos as the faucet: additive, gated OFF by default,
// never throws, and refuses to hit the network unless it is enabled AND fully
// configured with a real DID signer + an explicit base URL. It never posts to a
// guessed endpoint, and the private key stays inside the signer (see signer.ts).
//
// Honest scope: Ed25519 signing and the did:key are real. Technocore has not
// published the exact POST path / response shape, so those two are configurable
// seams (TECHNOCORE_BASE_URL + parsePostResponse) rather than guesses baked in.
// Until you set the flag, the URL, and a key, postSignedMessage() only ever
// returns a `skipped_*` outcome and sends nothing.

import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { logger } from "../logger.js";
import { canonicalize, loadSignerFromEnv, type DidSigner } from "./signer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Default on-disk store for the seqs of messages this agent has posted. */
export const DEFAULT_SEQ_STORE = path.resolve(__dirname, "../../data/technocore-seq.json");

// --- config (all lazy from env; the master flag defaults the whole thing OFF) ---

/** Master switch: postSignedMessage() is inert unless this is exactly "true". */
export function isPostEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.TECHNOCORE_POST_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Explicit base URL, e.g. https://technocore.chat. Unset ⇒ skipped_unconfigured. */
export function technocoreBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.TECHNOCORE_BASE_URL?.trim() || undefined;
}

/** Target room — "technocore", NOT "lobby", by default. Override via env. */
export function technocoreRoom(env: NodeJS.ProcessEnv = process.env): string {
  return env.TECHNOCORE_ROOM?.trim() || "technocore";
}

/** Path of the seq store; override via env for tests or alternate locations. */
export function seqStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.TECHNOCORE_SEQ_STORE?.trim() || DEFAULT_SEQ_STORE;
}

/** Build the POST target for a room: `${base}/r/${room}`, mirroring the read URL. */
export function postUrl(baseUrl: string, room: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/r/${encodeURIComponent(room)}`;
}

// --- the signed message envelope (pure) -----------------------------------------

export interface SignedMessage {
  room: string;
  text: string;
  did: string;
  /** Unix seconds. */
  ts: number;
  /** 0x-prefixed random nonce (anti-replay). */
  nonce: string;
  algorithm: "Ed25519";
  /** base64url Ed25519 signature over canonicalize({did,nonce,room,text,ts}). */
  signature: string;
}

export interface BuildSignedMessageInput {
  room: string;
  text: string;
  ts: number;
  nonce: string;
}

/**
 * Pure: assemble + sign the message envelope. The signed bytes are the canonical
 * (compact, key-sorted) JSON of the payload WITHOUT the signature — so any holder
 * of the did:key can re-canonicalize and verify. No I/O, no env, no clock.
 */
export function buildSignedMessage(input: BuildSignedMessageInput, signer: DidSigner): SignedMessage {
  const payload = { did: signer.did, nonce: input.nonce, room: input.room, text: input.text, ts: input.ts };
  const signature = signer.sign(new TextEncoder().encode(canonicalize(payload)));
  return { ...payload, algorithm: signer.algorithm, signature };
}

/** Pull the assigned sequence number (and any id) out of a post response body. */
export function parsePostResponse(body: unknown): { seq?: number; messageId?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const nested = (b.message ?? b.data ?? {}) as Record<string, unknown>;
  const rawSeq = b.seq ?? nested.seq;
  const seq =
    typeof rawSeq === "number" ? rawSeq : typeof rawSeq === "string" && /^\d+$/.test(rawSeq) ? Number(rawSeq) : undefined;
  const rawId = b.id ?? b.messageId ?? nested.id;
  const messageId = typeof rawId === "string" ? rawId : typeof rawId === "number" ? String(rawId) : undefined;
  return { seq, messageId };
}

// --- posting (gated, never throws) ----------------------------------------------

export type PostOutcome =
  | "posted"
  | "skipped_disabled" // TECHNOCORE_POST_ENABLED is not "true"
  | "skipped_unconfigured" // enabled, but base URL / signer / text missing or key invalid
  | "error_http" // non-2xx / unreachable
  | "error_rejected"; // 401 / 403 — signature or identity rejected

export interface PostResult {
  outcome: PostOutcome;
  reason: string;
  seq?: number;
  room?: string;
  did?: string;
  ts?: number;
  nonce?: string;
  messageId?: string;
}

export interface PostSignedMessageOpts {
  text: string;
  room?: string;
  /** Injected signer; otherwise resolved from env (FLOP_DID_PRIVATE_KEY). */
  signer?: DidSigner;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  nonce?: () => string;
  env?: NodeJS.ProcessEnv;
}

/** Resolve a signer without throwing: returns either the signer or a skip reason. */
function resolveSigner(opts: PostSignedMessageOpts, env: NodeJS.ProcessEnv): { signer?: DidSigner; reason?: string } {
  if (opts.signer) return { signer: opts.signer };
  try {
    const signer = loadSignerFromEnv(env);
    if (!signer) return { reason: "no DID signer: FLOP_DID_PRIVATE_KEY is unset" };
    return { signer };
  } catch (err) {
    return { reason: `DID signer unavailable: ${(err as Error).message}` };
  }
}

/**
 * Post one signed message to a Technocore room. Gating order (each a recorded skip):
 *   1. disabled       — TECHNOCORE_POST_ENABLED != "true"
 *   2. unconfigured   — base URL / signer / non-empty text missing (or key invalid)
 *   3. POST + parse   — real, signed submission; extracts the assigned seq
 * Never throws: transport and rejection failures become `error_*` results, exactly
 * like the faucet claim path, so a cron caller can record the outcome and move on.
 */
export async function postSignedMessage(opts: PostSignedMessageOpts): Promise<PostResult> {
  const env = opts.env ?? process.env;
  if (!isPostEnabled(env)) {
    return { outcome: "skipped_disabled", reason: "TECHNOCORE_POST_ENABLED is not true" };
  }

  const baseUrl = opts.baseUrl ?? technocoreBaseUrl(env);
  if (!baseUrl) {
    return { outcome: "skipped_unconfigured", reason: "TECHNOCORE_BASE_URL is unset — refusing to POST to a guessed endpoint" };
  }
  const text = opts.text?.trim();
  if (!text) {
    return { outcome: "skipped_unconfigured", reason: "message text is empty" };
  }
  const { signer, reason } = resolveSigner(opts, env);
  if (!signer) {
    return { outcome: "skipped_unconfigured", reason: reason! };
  }

  const room = opts.room ?? technocoreRoom(env);
  const ts = Math.floor((opts.now ?? Date.now)() / 1000);
  const nonce = (opts.nonce ?? (() => `0x${randomBytes(16).toString("hex")}`))();
  const message = buildSignedMessage({ room, text, ts, nonce }, signer);

  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(postUrl(baseUrl, room), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const outcome = res.status === 401 || res.status === 403 ? "error_rejected" : "error_http";
      return { outcome, reason: `technocore responded ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`, room, did: signer.did, ts, nonce };
    }
    const json = await res.json().catch(() => ({}));
    const { seq, messageId } = parsePostResponse(json);
    logger.info(`Technocore: posted to r/${room}${seq !== undefined ? ` (seq ${seq})` : ""} as ${signer.did.slice(0, 16)}…`);
    return { outcome: "posted", reason: "message accepted by the room", seq, room, did: signer.did, ts, nonce, messageId };
  } catch (err) {
    return { outcome: "error_http", reason: `technocore unreachable: ${(err as Error).message}`, room, did: signer.did, ts, nonce };
  }
}

// --- seq persistence -------------------------------------------------------------

export interface SeqRecord {
  seq: number;
  room: string;
  did: string;
  ts: number;
  text: string;
  messageId?: string;
  savedAt: string;
}

async function readSeqFile(file: string): Promise<SeqRecord[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Refusing to load an unrecognized seq store at ${file} (expected a JSON array)`);
  }
  return parsed as SeqRecord[];
}

/** Load all saved seq records (empty array if the store does not exist yet). */
export async function loadSeqs(opts: { env?: NodeJS.ProcessEnv; file?: string } = {}): Promise<SeqRecord[]> {
  return readSeqFile(opts.file ?? seqStorePath(opts.env ?? process.env));
}

/**
 * Append one posted message's seq to the store and return the full list. Idempotent
 * on (room, seq): re-saving the same seq updates the record in place rather than
 * duplicating it. Requires a numeric seq — call only for a `posted` result.
 */
export async function saveSeq(
  record: Omit<SeqRecord, "savedAt"> & { savedAt?: string },
  opts: { env?: NodeJS.ProcessEnv; file?: string } = {},
): Promise<SeqRecord[]> {
  if (!Number.isFinite(record.seq)) {
    throw new Error("saveSeq requires a numeric seq (only a posted message has one)");
  }
  const file = opts.file ?? seqStorePath(opts.env ?? process.env);
  const entry: SeqRecord = { ...record, savedAt: record.savedAt ?? new Date().toISOString() };
  const all = await readSeqFile(file);
  const idx = all.findIndex((r) => r.room === entry.room && r.seq === entry.seq);
  if (idx >= 0) all[idx] = entry;
  else all.push(entry);
  await writeFile(file, `${JSON.stringify(all, null, 2)}\n`, "utf-8");
  return all;
}
