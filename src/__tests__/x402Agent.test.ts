import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ethers } from "ethers";
import { payForMarketBriefBestEffort } from "../x402/agent.js";

// A dedicated throwaway key for the tests (Hardhat account #0).
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDR = new ethers.Wallet(PK).address;

const SAVED = { ...process.env };
function resetEnv() {
  delete process.env.X402_ENABLED;
  delete process.env.X402_PAYER_PRIVATE_KEY;
  delete process.env.X402_PAY_TO;
  delete process.env.X402_BRIEF_URL;
  delete process.env.X402_SETTLE_ENABLED;
  delete process.env.X402_DEPOSIT_USDC;
}

describe("payForMarketBriefBestEffort — gated, best-effort run-loop hook", () => {
  beforeEach(resetEnv);
  afterEach(() => {
    resetEnv();
    Object.assign(process.env, SAVED);
  });

  it("is inert (returns null) when X402_ENABLED is not set", async () => {
    process.env.X402_PAYER_PRIVATE_KEY = PK;
    expect(await payForMarketBriefBestEffort()).toBeNull();
  });

  it("returns null when enabled but no payer key is configured", async () => {
    process.env.X402_ENABLED = "true";
    expect(await payForMarketBriefBestEffort()).toBeNull();
  });

  it("returns null (never throws) on an invalid payer key", async () => {
    process.env.X402_ENABLED = "true";
    process.env.X402_PAYER_PRIVATE_KEY = "not-a-key";
    expect(await payForMarketBriefBestEffort()).toBeNull();
  });

  it("signs + verifies in-process when enabled with a valid key (verified-only)", async () => {
    process.env.X402_ENABLED = "true";
    process.env.X402_PAYER_PRIVATE_KEY = PK;
    process.env.X402_PAY_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const receipt = await payForMarketBriefBestEffort();
    expect(receipt).not.toBeNull();
    expect(receipt!.via).toBe("in-process");
    expect(receipt!.settled).toBe(false);
    expect(receipt!.mode).toBe("verified-only");
    expect(receipt!.payer).toBe(ADDR);
    expect(receipt!.payTo).toBe(process.env.X402_PAY_TO);
    expect(receipt!.amountUsdcAtomic).toBe("1000"); // default 0.001 USDC
  });

  it("falls back to the agent address as payTo when X402_PAY_TO is unset", async () => {
    process.env.X402_ENABLED = "true";
    process.env.X402_PAYER_PRIVATE_KEY = PK;
    const receipt = await payForMarketBriefBestEffort();
    expect(receipt).not.toBeNull();
    expect(receipt!.payTo).toBe("0x00Ebbd3aFCCaD08970ED8FdaE591244c8475a0aC");
  });

  it("SETTLES on-chain (tx hash) when X402_SETTLE_ENABLED + a brief URL are set", async () => {
    process.env.X402_ENABLED = "true";
    process.env.X402_PAYER_PRIVATE_KEY = PK;
    process.env.X402_SETTLE_ENABLED = "true";
    process.env.X402_BRIEF_URL = "https://brief.example/api/x402-brief";
    const receipt = await payForMarketBriefBestEffort({
      settleClientFactory: async () => ({
        address: ADDR,
        async getBalances() { return { gateway: { available: 0n, formattedAvailable: "0" } }; },
        async deposit() { return { depositTxHash: "0xdep" }; },
        async pay() { return { amount: 1000n, formattedAmount: "0.001", transaction: "0xSETTLED", status: 200 }; },
      }),
    });
    expect(receipt).not.toBeNull();
    expect(receipt!.settled).toBe(true);
    expect(receipt!.mode).toBe("settled");
    expect(receipt!.via).toBe("http");
    expect(receipt!.txHash).toBe("0xSETTLED");
    expect(receipt!.explorerUrl).toBe("https://testnet.arcscan.app/tx/0xSETTLED");
    expect(receipt!.amountUsdcAtomic).toBe("1000");
  });

  it("falls back to verified-only when settlement is enabled but the settle throws", async () => {
    process.env.X402_ENABLED = "true";
    process.env.X402_PAYER_PRIVATE_KEY = PK;
    process.env.X402_PAY_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    process.env.X402_SETTLE_ENABLED = "true";
    process.env.X402_BRIEF_URL = "https://brief.example/api/x402-brief";
    const receipt = await payForMarketBriefBestEffort({
      settleClientFactory: async () => ({
        address: ADDR,
        async getBalances() { return { gateway: { available: 0n, formattedAvailable: "0" } }; },
        async deposit() { return { depositTxHash: "0xdep" }; },
        async pay() { throw new Error("gateway 500"); },
      }),
    });
    // Settle failed → the run still records a verified-only receipt (best-effort).
    expect(receipt).not.toBeNull();
    expect(receipt!.settled).toBe(false);
    expect(receipt!.mode).toBe("verified-only");
    expect(receipt!.txHash).toBeUndefined();
  });
});
