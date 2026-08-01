import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isSettlementEnabled,
  facilitatorUrl,
  settleBriefViaGateway,
  settleSmartFeeViaGateway,
  resolveGatewayTransfer,
  ARC_TESTNET_CAIP2,
  type GatewayPayClient,
} from "../x402/settle.js";

const SAVED = { ...process.env };
function resetEnv() {
  delete process.env.X402_SETTLE_ENABLED;
  delete process.env.X402_FACILITATOR_URL;
}

// A fake Circle Gateway client — records calls, returns a canned transfer id.
function fakeClient(over: Partial<GatewayPayClient> = {}): GatewayPayClient & {
  deposits: string[];
  payCalls: string[];
} {
  const deposits: string[] = [];
  const payCalls: string[] = [];
  return {
    deposits,
    payCalls,
    address: "0x00Ebbd3aFCCaD08970ED8FdaE591244c8475a0aC",
    async getBalances() {
      return { gateway: { available: 0n, formattedAvailable: "0" } };
    },
    async deposit(amount: string) {
      deposits.push(amount);
      return { depositTxHash: "0xdeposit" };
    },
    async pay(url: string) {
      payCalls.push(url);
      // Gateway returns a transfer id (UUID-like), NOT an on-chain hash.
      return { amount: 1000n, formattedAmount: "0.001", transaction: "transfer-uuid-1", status: 200 };
    },
    ...over,
  };
}

// A fake fetch that returns a canned Gateway transfer record.
function fetchReturning(rec: { status?: string; txHash?: string | null }): typeof fetch {
  return (async () => ({ ok: true, json: async () => rec })) as unknown as typeof fetch;
}

describe("x402 settlement — Circle Gateway rail", () => {
  beforeEach(resetEnv);
  afterEach(() => {
    resetEnv();
    Object.assign(process.env, SAVED);
  });

  it("isSettlementEnabled gates strictly on 'true'", () => {
    expect(isSettlementEnabled()).toBe(false);
    process.env.X402_SETTLE_ENABLED = "false";
    expect(isSettlementEnabled()).toBe(false);
    process.env.X402_SETTLE_ENABLED = "TRUE";
    expect(isSettlementEnabled()).toBe(true);
    process.env.X402_SETTLE_ENABLED = " true ";
    expect(isSettlementEnabled()).toBe(true);
  });

  it("facilitatorUrl defaults to the testnet Gateway, overridable by env", () => {
    expect(facilitatorUrl()).toBe("https://gateway-api-testnet.circle.com");
    process.env.X402_FACILITATOR_URL = "https://example.test";
    expect(facilitatorUrl()).toBe("https://example.test");
  });

  it("settles a brief and resolves the on-chain tx hash + explorer link", async () => {
    const client = fakeClient();
    const res = await settleBriefViaGateway({
      privateKey: "0xpk",
      url: "https://brief.example/api/x402-brief",
      clientFactory: async () => client,
      resolveFetch: fetchReturning({ status: "confirmed", txHash: "0xabc123def456" }),
    });
    expect(res.transferId).toBe("transfer-uuid-1");
    expect(res.status).toBe("confirmed");
    expect(res.txHash).toBe("0xabc123def456");
    expect(res.explorerUrl).toBe("https://testnet.arcscan.app/tx/0xabc123def456");
    expect(res.amountUsdcAtomic).toBe("1000");
    expect(res.payer).toBe(client.address);
    expect(res.network).toBe(ARC_TESTNET_CAIP2);
    expect(client.payCalls).toEqual(["https://brief.example/api/x402-brief"]);
    expect(client.deposits).toEqual([]); // no deposit floor set → no top-up
  });

  it("returns the transfer id with tx pending when the batch has not settled yet", async () => {
    const res = await settleBriefViaGateway({
      privateKey: "0xpk",
      url: "https://brief.example",
      clientFactory: async () => fakeClient(),
      resolveFetch: fetchReturning({ status: "received", txHash: null }),
      resolveTries: 1,
      resolveDelayMs: 0,
    });
    expect(res.transferId).toBe("transfer-uuid-1");
    expect(res.status).toBe("received");
    expect(res.txHash).toBeUndefined();
    expect(res.explorerUrl).toBeUndefined();
  });

  it("tops up the Gateway balance when below the deposit floor, then pays", async () => {
    const client = fakeClient();
    await settleBriefViaGateway({
      privateKey: "0xpk",
      url: "https://brief.example",
      depositUsdc: "1",
      clientFactory: async () => client,
      resolveFetch: fetchReturning({ status: "received", txHash: null }),
      resolveTries: 1,
      resolveDelayMs: 0,
    });
    expect(client.deposits).toEqual(["1"]); // topped up before paying
  });

  it("does NOT top up when the Gateway balance already covers the floor", async () => {
    const client = fakeClient({
      async getBalances() {
        return { gateway: { available: 5_000_000n, formattedAvailable: "5" } };
      },
    });
    await settleBriefViaGateway({
      privateKey: "0xpk",
      url: "https://brief.example",
      depositUsdc: "1",
      clientFactory: async () => client,
      resolveFetch: fetchReturning({ status: "received", txHash: null }),
      resolveTries: 1,
      resolveDelayMs: 0,
    });
    expect(client.deposits).toEqual([]);
  });

  it("still pays (gasless) when a pre-pay top-up throws — deposit is best-effort", async () => {
    const client = fakeClient({
      async getBalances() {
        throw new Error("rpc down");
      },
    });
    const res = await settleBriefViaGateway({
      privateKey: "0xpk",
      url: "https://brief.example",
      depositUsdc: "1",
      clientFactory: async () => client,
      resolveFetch: fetchReturning({ status: "received", txHash: null }),
      resolveTries: 1,
      resolveDelayMs: 0,
    });
    expect(res.transferId).toBe("transfer-uuid-1");
    expect(client.payCalls.length).toBe(1);
  });

  it("propagates a pay() failure to the caller (agent decides fallback)", async () => {
    const client = fakeClient({
      async pay() {
        throw new Error("settlement rejected");
      },
    });
    await expect(
      settleBriefViaGateway({ privateKey: "0xpk", url: "https://brief.example", clientFactory: async () => client }),
    ).rejects.toThrow("settlement rejected");
  });

  it("resolveGatewayTransfer returns the on-chain hash once present", async () => {
    const r = await resolveGatewayTransfer("transfer-uuid-1", {
      fetchImpl: fetchReturning({ status: "completed", txHash: "0xfeed" }),
      tries: 3,
      delayMs: 0,
    });
    expect(r).toEqual({ status: "completed", txHash: "0xfeed" });
  });

  it("resolveGatewayTransfer reports last status with null hash when still batching", async () => {
    const r = await resolveGatewayTransfer("transfer-uuid-1", {
      fetchImpl: fetchReturning({ status: "batched", txHash: null }),
      tries: 2,
      delayMs: 0,
    });
    expect(r).toEqual({ status: "batched", txHash: null });
  });
});

describe("settleSmartFeeViaGateway — the fee's Nanopayment settler", () => {
  beforeEach(resetEnv);
  afterEach(() => {
    resetEnv();
    Object.assign(process.env, SAVED);
  });

  it("appends the fee amount as ?amount= and settles on-chain", async () => {
    const client = fakeClient();
    const res = await settleSmartFeeViaGateway({
      privateKey: "0xpk",
      url: "https://aura-dca.xyz/api/x402-smart-fee",
      amountUsdc: "0.020000",
      clientFactory: async () => client,
      resolveFetch: fetchReturning({ status: "confirmed", txHash: "0xfee123" }),
    });
    expect(client.payCalls).toEqual(["https://aura-dca.xyz/api/x402-smart-fee?amount=0.020000"]);
    expect(res.txHash).toBe("0xfee123");
    expect(res.transferId).toBe("transfer-uuid-1");
    expect(res.network).toBe(ARC_TESTNET_CAIP2);
  });

  it("uses & as the separator when the URL already has a query string", async () => {
    const client = fakeClient();
    await settleSmartFeeViaGateway({
      privateKey: "0xpk",
      url: "https://fee.example/x402-smart-fee?v=1",
      amountUsdc: "0.010000",
      clientFactory: async () => client,
      resolveFetch: fetchReturning({ status: "received", txHash: null }),
      resolveTries: 1,
      resolveDelayMs: 0,
    });
    expect(client.payCalls).toEqual(["https://fee.example/x402-smart-fee?v=1&amount=0.010000"]);
  });

  it("propagates a settlement failure so the run keeps the ledger-only fee", async () => {
    const client = fakeClient({
      async pay() {
        throw new Error("gateway rejected");
      },
    });
    await expect(
      settleSmartFeeViaGateway({
        privateKey: "0xpk",
        url: "https://fee.example",
        amountUsdc: "0.01",
        clientFactory: async () => client,
      }),
    ).rejects.toThrow("gateway rejected");
  });
});
