import { describe, it, expect } from "vitest";
import { requestWithdrawal, processPendingWithdrawals } from "../ledger/withdraw.js";
import { getOrCreateUser } from "../ledger/store.js";
import { ARC_EURC_CONTRACT, ARC_USDC_CONTRACT } from "../ledger/constants.js";
import type { Ledger } from "../types.js";
import type { Wallet } from "../wallet.js";

function emptyLedger(): Ledger {
  return { version: 1, lastScannedBlock: 0, users: {}, deposits: [], distributions: [], withdrawals: [] };
}

type Sent = { tokenAddress: string; destinationAddress: string; amount: string };
function mockWallet(sent: Sent[]): Wallet {
  return {
    address: "0xagent00000000000000000000000000000000abcd" as `0x${string}`,
    async getUsdcTokenBalance() { return "0"; },
    async sendTokens(p) { sent.push(p); return { txHash: "0xdeadbeef" }; },
    async executeContract() { return {}; },
  };
}

describe("requestWithdrawal — generalized to any DCA token (EURC)", () => {
  it("deducts from tokenBalances[EURC] at 6dp and queues a pending request", () => {
    const ledger = emptyLedger();
    const u = getOrCreateUser(ledger, "0xabc0000000000000000000000000000000000001", "2026-01-01T00:00:00.000Z");
    u.tokenBalances = { EURC: "5.000000" };

    const req = requestWithdrawal(ledger, u.address, "EURC", "2");

    expect(req.status).toBe("pending");
    expect(req.token).toBe("EURC");
    expect(u.tokenBalances!.EURC).toBe("3.000000");
    expect(ledger.withdrawals).toHaveLength(1);
  });

  it("rejects withdrawing more EURC than held", () => {
    const ledger = emptyLedger();
    const u = getOrCreateUser(ledger, "0xabc0000000000000000000000000000000000002");
    u.tokenBalances = { EURC: "1.0" };
    expect(() => requestWithdrawal(ledger, u.address, "EURC", "5")).toThrow(/Insufficient EURC/);
  });
});

describe("processPendingWithdrawals — routes each token to its own contract", () => {
  it("sends EURC via the EURC contract and credits totalWithdrawn.EURC", async () => {
    const ledger = emptyLedger();
    const u = getOrCreateUser(ledger, "0xabc0000000000000000000000000000000000003");
    u.tokenBalances = { EURC: "5.000000" };
    requestWithdrawal(ledger, u.address, "EURC", "2");

    const sent: Sent[] = [];
    const n = await processPendingWithdrawals(ledger, mockWallet(sent));

    expect(n).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.tokenAddress).toBe(ARC_EURC_CONTRACT);
    expect(sent[0]!.destinationAddress).toBe(u.address);
    expect(ledger.withdrawals[0]!.status).toBe("completed");
    expect(u.totalWithdrawn?.EURC).toBe("2.000000");
  });

  it("still routes USDC to the USDC contract + legacy totalWithdrawnUsdc (regression)", async () => {
    const ledger = emptyLedger();
    const u = getOrCreateUser(ledger, "0xabc0000000000000000000000000000000000004");
    u.usdcBalance = "10";
    requestWithdrawal(ledger, u.address, "USDC", "4");

    const sent: Sent[] = [];
    await processPendingWithdrawals(ledger, mockWallet(sent));

    expect(sent[0]!.tokenAddress).toBe(ARC_USDC_CONTRACT);
    expect(u.usdcBalance).toBe("6.000000");
    expect(u.totalWithdrawnUsdc).toBe("4.000000");
  });
});
