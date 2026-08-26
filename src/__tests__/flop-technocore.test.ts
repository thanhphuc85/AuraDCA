import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPublicKey, verify } from "node:crypto";
import {
  base58btcEncode,
  didKeyFromEd25519PublicKey,
  ed25519KeyFromSeed,
  parseSeedMaterial,
  canonicalize,
  createEd25519Signer,
  loadSignerFromEnv,
  buildSignedMessage,
  parsePostResponse,
  postSignedMessage,
  postUrl,
  saveSeq,
  loadSeqs,
  type DidSigner,
} from "../flop/index.js";

const SAVED = { ...process.env };
function resetEnv() {
  for (const k of Object.keys(process.env)) if (k.startsWith("FLOP_") || k.startsWith("TECHNOCORE_")) delete process.env[k];
}
beforeEach(resetEnv);
afterEach(() => {
  resetEnv();
  Object.assign(process.env, SAVED);
});

// Locked, independently reproduced vector (see PR notes): a fixed 32-byte seed and
// the did:key + signature it must always produce. Guards the whole crypto pipeline.
const SEED_HEX = "9d61b19deffebc3ef4a0aa0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d";
const EXPECT_DID = "did:key:z6Mkuag6vUUr9fGfgKxgo3EyW4EkvkFc1WuDXLABmCEMCAw8";
const seed = () => Uint8Array.from(Buffer.from(SEED_HEX, "hex"));

describe("Ed25519 signer — did:key + signatures", () => {
  it("base58btc encodes a known W3C did:key vector", () => {
    const pub = Buffer.from("ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf", "hex");
    expect(didKeyFromEd25519PublicKey(pub)).toBe("did:key:z6MkvLrkgkeeWeRwktZGShYPiB5YuPkhN2yi3MqMKZMFMgWr");
    // base58btc of an all-zero buffer is "1" per leading-zero byte (no spurious digit).
    expect(base58btcEncode(Uint8Array.of(0, 0))).toBe("11");
  });

  it("derives the expected did:key from a fixed seed", () => {
    expect(createEd25519Signer(seed()).did).toBe(EXPECT_DID);
  });

  it("produces a verifiable Ed25519 signature over the canonical bytes", () => {
    const signer = createEd25519Signer(seed());
    const canonical = canonicalize({ hello: "technocore", n: 1 });
    const sigB64u = signer.sign(new TextEncoder().encode(canonical));
    const { publicKey } = ed25519KeyFromSeed(seed());
    const pubKeyObj = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey)]),
      format: "der",
      type: "spki",
    });
    const ok = verify(null, Buffer.from(canonical), pubKeyObj, Buffer.from(sigB64u, "base64url"));
    expect(ok).toBe(true);
  });

  it("canonicalize is key-order independent", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it("parseSeedMaterial accepts hex (0x, 64 & 128 chars) and base64", () => {
    expect(parseSeedMaterial(SEED_HEX)).toEqual(seed());
    expect(parseSeedMaterial(`0x${SEED_HEX}`)).toEqual(seed());
    expect(parseSeedMaterial(SEED_HEX + "11".repeat(32))).toEqual(seed()); // 64-byte secret key → first 32
    expect(parseSeedMaterial(Buffer.from(seed()).toString("base64"))).toEqual(seed());
    expect(() => parseSeedMaterial("nope")).toThrow(/32-byte/);
  });
});

describe("loadSignerFromEnv", () => {
  it("returns undefined with no key set", () => {
    expect(loadSignerFromEnv()).toBeUndefined();
  });
  it("loads a signer from FLOP_DID_PRIVATE_KEY", () => {
    process.env.FLOP_DID_PRIVATE_KEY = SEED_HEX;
    expect(loadSignerFromEnv()?.did).toBe(EXPECT_DID);
  });
  it("throws when FLOP_DID contradicts the derived did:key", () => {
    process.env.FLOP_DID_PRIVATE_KEY = SEED_HEX;
    process.env.FLOP_DID = "did:key:z6MkWrongIdentifier";
    expect(() => loadSignerFromEnv()).toThrow(/does not match/);
  });
});

const signer: DidSigner = createEd25519Signer(seed());
const nonce = () => "0xabc";
const now = () => 1_735_689_600_000; // fixed ⇒ ts 1735689600

function fetchOk(body: unknown, calls: Array<{ url: string; init?: RequestInit }> = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => body, text: async () => "" };
  }) as unknown as typeof fetch;
}
function fetchStatus(status: number, text = ""): typeof fetch {
  return (async () => ({ ok: false, status, json: async () => ({}), text: async () => text })) as unknown as typeof fetch;
}

describe("buildSignedMessage (pure)", () => {
  it("assembles a verifiable, room-bound envelope", () => {
    const msg = buildSignedMessage({ room: "technocore", text: "gm", ts: 1735689600, nonce: "0xabc" }, signer);
    expect(msg).toMatchObject({ room: "technocore", text: "gm", did: EXPECT_DID, ts: 1735689600, nonce: "0xabc", algorithm: "Ed25519" });
    // Signature covers canonical payload WITHOUT the signature field.
    const canonical = canonicalize({ did: msg.did, nonce: msg.nonce, room: msg.room, text: msg.text, ts: msg.ts });
    const { publicKey } = ed25519KeyFromSeed(seed());
    const pubKeyObj = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey)]),
      format: "der",
      type: "spki",
    });
    expect(verify(null, Buffer.from(canonical), pubKeyObj, Buffer.from(msg.signature, "base64url"))).toBe(true);
  });
});

describe("parsePostResponse", () => {
  it("reads seq from top level, nested message/data, and string form", () => {
    expect(parsePostResponse({ seq: 42, id: "m1" })).toEqual({ seq: 42, messageId: "m1" });
    expect(parsePostResponse({ message: { seq: 7 } }).seq).toBe(7);
    expect(parsePostResponse({ data: { seq: "9" } }).seq).toBe(9);
    expect(parsePostResponse(null).seq).toBeUndefined();
  });
});

describe("postSignedMessage — gating", () => {
  it("is disabled by default", async () => {
    const r = await postSignedMessage({ text: "gm", signer });
    expect(r.outcome).toBe("skipped_disabled");
  });

  it("skips unconfigured when enabled but base URL missing", async () => {
    process.env.TECHNOCORE_POST_ENABLED = "true";
    const r = await postSignedMessage({ text: "gm", signer });
    expect(r.outcome).toBe("skipped_unconfigured");
    expect(r.reason).toMatch(/TECHNOCORE_BASE_URL/);
  });

  it("skips unconfigured on empty text", async () => {
    process.env.TECHNOCORE_POST_ENABLED = "true";
    const r = await postSignedMessage({ text: "   ", signer, baseUrl: "https://technocore.chat" });
    expect(r.outcome).toBe("skipped_unconfigured");
    expect(r.reason).toMatch(/empty/);
  });

  it("skips unconfigured when no signer is available", async () => {
    process.env.TECHNOCORE_POST_ENABLED = "true";
    const calls: Array<{ url: string }> = [];
    const r = await postSignedMessage({ text: "gm", baseUrl: "https://technocore.chat", fetchImpl: fetchOk({}, calls) });
    expect(r.outcome).toBe("skipped_unconfigured");
    expect(r.reason).toMatch(/FLOP_DID_PRIVATE_KEY/);
    expect(calls).toHaveLength(0); // never hit the network without a key
  });
});

describe("postSignedMessage — post path", () => {
  beforeEach(() => {
    process.env.TECHNOCORE_POST_ENABLED = "true";
  });

  it("posts a signed message to /r/<room> and returns the seq", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const r = await postSignedMessage({
      text: "gm technocore",
      signer,
      baseUrl: "https://technocore.chat",
      room: "technocore",
      now,
      nonce,
      fetchImpl: fetchOk({ seq: 1476344, id: "abc" }, calls),
    });
    expect(r.outcome).toBe("posted");
    expect(r.seq).toBe(1476344);
    expect(r.room).toBe("technocore");
    expect(r.did).toBe(EXPECT_DID);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://technocore.chat/r/technocore"); // room, not lobby
    const sent = JSON.parse(String(calls[0]?.init?.body));
    expect(sent.room).toBe("technocore");
    expect(sent.did).toBe(EXPECT_DID);
    expect(sent.algorithm).toBe("Ed25519");
    expect(typeof sent.signature).toBe("string");
  });

  it("maps 401/403 to error_rejected and other non-2xx to error_http", async () => {
    const rejected = await postSignedMessage({ text: "x", signer, baseUrl: "https://t", fetchImpl: fetchStatus(403, "bad sig") });
    expect(rejected.outcome).toBe("error_rejected");
    const http = await postSignedMessage({ text: "x", signer, baseUrl: "https://t", fetchImpl: fetchStatus(500) });
    expect(http.outcome).toBe("error_http");
  });

  it("surfaces a transport failure as error_http without throwing", async () => {
    const r = await postSignedMessage({
      text: "x",
      signer,
      baseUrl: "https://t",
      fetchImpl: (async () => {
        throw new Error("boom");
      }) as unknown as typeof fetch,
    });
    expect(r.outcome).toBe("error_http");
    expect(r.reason).toMatch(/boom/);
  });

  it("builds the room URL, encoding the room name", () => {
    expect(postUrl("https://technocore.chat/", "techno core")).toBe("https://technocore.chat/r/techno%20core");
  });
});

describe("seq store", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "flop-seq-"));
    file = path.join(dir, "seq.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("loads empty when the store does not exist", async () => {
    expect(await loadSeqs({ file })).toEqual([]);
  });

  it("appends and then upserts on (room, seq)", async () => {
    await saveSeq({ seq: 1, room: "technocore", did: EXPECT_DID, ts: 1, text: "a" }, { file });
    let all = await saveSeq({ seq: 2, room: "technocore", did: EXPECT_DID, ts: 2, text: "b" }, { file });
    expect(all.map((r) => r.seq)).toEqual([1, 2]);
    all = await saveSeq({ seq: 1, room: "technocore", did: EXPECT_DID, ts: 1, text: "a-edited" }, { file });
    expect(all).toHaveLength(2); // upsert, not duplicate
    expect(all.find((r) => r.seq === 1)?.text).toBe("a-edited");
    expect((await loadSeqs({ file }))[0]?.savedAt).toBeDefined();
  });

  it("rejects a non-numeric seq", async () => {
    await expect(saveSeq({ seq: NaN, room: "r", did: "d", ts: 1, text: "x" }, { file })).rejects.toThrow(/numeric seq/);
  });
});
