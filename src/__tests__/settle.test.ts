import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isSettlementEnabled,
  facilitatorUrl,
  settleBriefViaGateway,
  ARC_TESTNET_CAIP2,
  type GatewayPayClient,
} from "../x402/settle.js";

const SAVED = { ...process.env };
function resetEnv() {
  delete process.env.X402_SETTLE_ENABLED;
  delete process.env.X402_FACILITATOR_URL;
}

// A fake Circle Gateway client — records calls, returns a canned settlement.
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
      return { amount: 1000n, formattedAmount: "0.001", transaction: "0xabc123def456", status: 200 };
    },
    ...over,
  };
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

  it("settles a brief and returns the tx hash + explorer link", async () => {
    const client = fakeClient();
    const res = await settleBriefViaGateway({
      privateKey: "0xpk",
      url: "https://brief.example/api/x402-brief",
      clientFactory: async () => client,
    });
    expect(res.txHash).toBe("0xabc123def456");
    expect(res.explorerUrl).toBe("https://testnet.arcscan.app/tx/0xabc123def456");
    expect(res.amountUsdcAtomic).toBe("1000");
    expect(res.payer).toBe(client.address);
    expect(res.network).toBe(ARC_TESTNET_CAIP2);
    expect(client.payCalls).toEqual(["https://brief.example/api/x402-brief"]);
    expect(client.deposits).toEqual([]); // no deposit floor set → no top-up
  });

  it("tops up the Gateway balance when below the deposit floor, then pays", async () => {
    const client = fakeClient({
      async getBalances() {
        return { gateway: { available: 0n, formattedAvailable: "0" } };
      },
    });
    const res = await settleBriefViaGateway({
      privateKey: "0xpk",
      url: "https://brief.example",
      depositUsdc: "1",
      clientFactory: async () => client,
    });
    expect(client.deposits).toEqual(["1"]); // topped up before paying
    expect(res.txHash).toBe("0xabc123def456");
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
    });
    expect(res.txHash).toBe("0xabc123def456");
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
});
