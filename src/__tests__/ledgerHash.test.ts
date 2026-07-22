import { describe, it, expect } from "vitest";
import { hashLedgerContent } from "../attest/ledgerHash.js";

describe("hashLedgerContent (on-chain audit anchor)", () => {
  it("is deterministic for identical content", () => {
    expect(hashLedgerContent('{"version":1}')).toBe(hashLedgerContent('{"version":1}'));
  });

  it("returns a 0x-prefixed 32-byte hash", () => {
    expect(hashLedgerContent("hello")).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changes when content changes", () => {
    expect(hashLedgerContent('{"a":1}')).not.toBe(hashLedgerContent('{"a":2}'));
  });

  it("hashes a string and its equivalent bytes identically", () => {
    const s = '{"version":1,"users":{}}';
    expect(hashLedgerContent(s)).toBe(hashLedgerContent(new TextEncoder().encode(s)));
  });

  it("is exactly keccak256 of the utf8 bytes — the verification contract third parties rely on", () => {
    // keccak256("") is a well-known constant; locking it guarantees anyone can
    // reproduce latestHash as keccak256(bytes of data/ledger.json).
    expect(hashLedgerContent("")).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });
});
