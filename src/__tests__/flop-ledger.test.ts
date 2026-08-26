import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isTestnetEnabled,
  ledgerMode,
  flopRpcUrl,
  ledgerStorePath,
  isDecimal,
  isPositiveDecimal,
  addDecimal,
  subDecimal,
  cmpDecimal,
  loadLedger,
  checkBalance,
  creditToken,
  spendToken,
  DEFAULT_LEDGER_STORE,
  type SubmitTx,
} from "../flop/index.js";

const SAVED = { ...process.env };
function resetEnv() {
  for (const k of Object.keys(process.env)) if (k.startsWith("FLOP_")) delete process.env[k];
}
beforeEach(resetEnv);
afterEach(() => {
  resetEnv();
  Object.assign(process.env, SAVED);
});

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "flop-ledger-"));
  file = path.join(dir, "ledger.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const captured: string[] = [];
const log = (m: string) => captured.push(m);
beforeEach(() => (captured.length = 0));

describe("ledger — mode + config accessors", () => {
  it("defaults to simulation and flips to testnet on the flag", () => {
    expect(isTestnetEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(ledgerMode({} as NodeJS.ProcessEnv)).toBe("simulation");
    expect(ledgerMode({ FLOP_TESTNET_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe("testnet");
    expect(ledgerMode({ FLOP_TESTNET_ENABLED: "TRUE " } as unknown as NodeJS.ProcessEnv)).toBe("testnet");
    expect(ledgerMode({ FLOP_TESTNET_ENABLED: "yes" } as unknown as NodeJS.ProcessEnv)).toBe("simulation");
  });

  it("reads rpc url and store path from env", () => {
    expect(flopRpcUrl({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(flopRpcUrl({ FLOP_RPC_URL: " https://rpc " } as unknown as NodeJS.ProcessEnv)).toBe("https://rpc");
    expect(ledgerStorePath({} as NodeJS.ProcessEnv)).toBe(DEFAULT_LEDGER_STORE);
    expect(ledgerStorePath({ FLOP_LEDGER_STORE: "/tmp/x.json" } as unknown as NodeJS.ProcessEnv)).toBe("/tmp/x.json");
  });
});

describe("ledger — decimal helpers (exact)", () => {
  it("validates decimals", () => {
    expect(isDecimal("0")).toBe(true);
    expect(isDecimal("0.001")).toBe(true);
    expect(isDecimal("-1")).toBe(false);
    expect(isDecimal("1e3")).toBe(false);
    expect(isPositiveDecimal("0")).toBe(false);
    expect(isPositiveDecimal("0.000")).toBe(false);
    expect(isPositiveDecimal("0.001")).toBe(true);
  });

  it("adds/subtracts without float drift", () => {
    expect(addDecimal("0.1", "0.2")).toBe("0.3"); // the classic float trap
    expect(subDecimal("100", "0.001")).toBe("99.999");
    expect(subDecimal("0.001", "1")).toBe("0"); // clamped at zero, never negative
  });

  it("compares", () => {
    expect(cmpDecimal("1", "2")).toBe(-1);
    expect(cmpDecimal("2", "2")).toBe(0);
    expect(cmpDecimal("2.5", "2.4")).toBe(1);
  });
});

describe("ledger — credit", () => {
  it("credits a positive amount and accumulates", async () => {
    const a = await creditToken({ amount: "100", file });
    expect(a.ok).toBe(true);
    expect(a.balanceAfter).toBe("100");
    const b = await creditToken({ amount: "0.5", file });
    expect(b.balanceAfter).toBe("100.5");
    expect(await checkBalance("FLOP", { file })).toBe("100.5");
  });

  it("rejects a non-positive/invalid amount without throwing", async () => {
    const r = await creditToken({ amount: "0", file });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/positive decimal/);
    const bad = await creditToken({ amount: "nope", file });
    expect(bad.ok).toBe(false);
  });

  it("records the mode on each entry", async () => {
    process.env.FLOP_TESTNET_ENABLED = "true";
    await creditToken({ amount: "1", file });
    const state = await loadLedger({ file });
    expect(state.entries[0]?.mode).toBe("testnet");
    expect(state.entries[0]?.kind).toBe("credit");
  });
});

describe("ledger — spend (simulation, default)", () => {
  beforeEach(async () => {
    await creditToken({ amount: "100", file });
  });

  it("debits the mock balance and logs the [SIMULATION] line", async () => {
    const r = await spendToken({ amount: "0.001", memo: "Gemini Inference", file, log });
    expect(r.outcome).toBe("spent_simulated");
    expect(r.balanceAfter).toBe("99.999");
    expect(captured).toContain("[SIMULATION] Spent 0.001 MOCK_FLOP for Gemini Inference");
    expect(await checkBalance("FLOP", { file })).toBe("99.999");
  });

  it("skips insufficient when amount exceeds balance", async () => {
    const r = await spendToken({ amount: "1000", memo: "too much", file, log });
    expect(r.outcome).toBe("skipped_insufficient");
    expect(r.reason).toMatch(/insufficient FLOP/);
    expect(captured).toHaveLength(0); // nothing logged, nothing spent
    expect(await checkBalance("FLOP", { file })).toBe("100");
  });

  it("skips a non-positive/invalid amount as insufficient", async () => {
    expect((await spendToken({ amount: "0", memo: "x", file })).outcome).toBe("skipped_insufficient");
    expect((await spendToken({ amount: "-1", memo: "x", file })).outcome).toBe("skipped_insufficient");
    expect((await spendToken({ amount: "junk", memo: "x", file })).outcome).toBe("skipped_insufficient");
  });
});

describe("ledger — spend (testnet mode)", () => {
  beforeEach(async () => {
    await creditToken({ amount: "100", file }); // seed while still in simulation
    process.env.FLOP_TESTNET_ENABLED = "true";
  });

  it("refuses (unconfigured) when RPC url is missing", async () => {
    const submitTx: SubmitTx = async () => ({ txHash: "0xshouldNotBeCalled" });
    const r = await spendToken({ amount: "1", memo: "x", file, submitTx });
    expect(r.outcome).toBe("skipped_unconfigured");
    expect(r.reason).toMatch(/FLOP_RPC_URL/);
  });

  it("refuses (unconfigured) when no submitTx signer is wired", async () => {
    const r = await spendToken({ amount: "1", memo: "x", file, rpcUrl: "https://rpc" });
    expect(r.outcome).toBe("skipped_unconfigured");
    expect(r.reason).toMatch(/submitTx/);
  });

  it("submits a real transfer and debits the tracked balance", async () => {
    const seen: Array<{ token: string; amount: string; memo: string; rpcUrl: string }> = [];
    const submitTx: SubmitTx = async (tx) => {
      seen.push(tx);
      return { txHash: "0xdeadbeefcafef00d" };
    };
    const r = await spendToken({ amount: "0.001", memo: "Gemini Inference", file, rpcUrl: "https://rpc", submitTx, log });
    expect(r.outcome).toBe("spent_onchain");
    expect(r.txHash).toBe("0xdeadbeefcafef00d");
    expect(r.balanceAfter).toBe("99.999");
    expect(seen).toEqual([{ token: "FLOP", amount: "0.001", memo: "Gemini Inference", rpcUrl: "https://rpc" }]);
    expect(captured[0]).toMatch(/spent 0\.001 FLOP for Gemini Inference \(tx 0xdeadbeefca…\)/);
  });

  it("maps a submit failure to error_submit without throwing or debiting", async () => {
    const submitTx: SubmitTx = async () => {
      throw new Error("rpc down");
    };
    const r = await spendToken({ amount: "1", memo: "x", file, rpcUrl: "https://rpc", submitTx });
    expect(r.outcome).toBe("error_submit");
    expect(r.reason).toMatch(/rpc down/);
    expect(await checkBalance("FLOP", { file })).toBe("100"); // balance untouched
  });
});

describe("ledger — store loading", () => {
  it("loads empty when the store does not exist", async () => {
    expect(await loadLedger({ file })).toEqual({ balances: {}, entries: [] });
    expect(await checkBalance("FLOP", { file })).toBe("0");
  });

  it("rejects a structurally unrecognized store", async () => {
    writeFileSync(file, JSON.stringify([1, 2, 3]));
    await expect(loadLedger({ file })).rejects.toThrow(/unrecognized ledger store/);
  });
});
