import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { fetchWithX402 } from "../x402/client.js";
import { buildRequirements } from "../x402/config.js";
import { decodePayment } from "../x402/payment.js";
import type { PaymentRequirements } from "../x402/types.js";

const PAYER = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const SERVICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const NOW = 1_800_000_000;

function req(priceUsdc = "0.001"): PaymentRequirements {
  return buildRequirements({ resource: "/api/x402-brief", description: "brief", priceUsdc, payTo: SERVICE, maxTimeoutSeconds: 120 });
}

/** Minimal fetch Response stand-in: only the bits fetchWithX402 touches. */
function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

describe("fetchWithX402 — free resources pass straight through", () => {
  it("returns the body unpaid when the first response is not 402", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return res(200, { ok: true }); }) as unknown as typeof fetch;
    const out = await fetchWithX402<{ ok: boolean }>("http://x/brief", PAYER, { fetchImpl });
    expect(out.status).toBe(200);
    expect(out.paid).toBe(false);
    expect(out.data.ok).toBe(true);
    expect(calls).toBe(1); // never signs, never retries
  });

  it("does not pay a 402 that carries no accepts[] requirements", async () => {
    const fetchImpl = (async () => res(402, { accepts: [] })) as unknown as typeof fetch;
    const out = await fetchWithX402("http://x/brief", PAYER, { fetchImpl });
    expect(out.status).toBe(402);
    expect(out.paid).toBe(false);
    expect(out.requirements).toBeUndefined();
  });
});

describe("fetchWithX402 — pays a 402 challenge and retries", () => {
  it("signs the first accepts[] entry, sends X-PAYMENT, and reports paid on 200", async () => {
    const requirements = req();
    const seen: Array<RequestInit | undefined> = [];
    let n = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen.push(init);
      n++;
      if (n === 1) return res(402, { accepts: [requirements] });
      // second (paid) call must carry a valid signed X-PAYMENT header
      const header = new Headers(init?.headers).get("X-PAYMENT");
      expect(header).toBeTruthy();
      const decoded = decodePayment(header!);
      expect(decoded).not.toBeNull();
      expect(decoded!.payload.authorization.from).toBe(PAYER.address);
      return res(200, { brief: "hello" });
    }) as unknown as typeof fetch;

    const out = await fetchWithX402<{ brief: string }>("http://x/brief", PAYER, { fetchImpl, nowSec: NOW });
    expect(n).toBe(2);
    expect(out.paid).toBe(true);
    expect(out.data.brief).toBe("hello");
    expect(out.requirements).toEqual(requirements);
  });

  it("parses a base64 X-PAYMENT-RESPONSE settlement header", async () => {
    const requirements = req();
    const settlement = { success: true, txHash: "0xdeadbeef", network: "Arc_Testnet" };
    const encoded = Buffer.from(JSON.stringify(settlement), "utf-8").toString("base64");
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) return res(402, { accepts: [requirements] });
      return res(200, { brief: "ok" }, { "X-PAYMENT-RESPONSE": encoded });
    }) as unknown as typeof fetch;

    const out = await fetchWithX402("http://x/brief", PAYER, { fetchImpl, nowSec: NOW });
    expect(out.settlement).toEqual(settlement);
  });

  it("leaves settlement undefined when the response header is malformed base64", async () => {
    const requirements = req();
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) return res(402, { accepts: [requirements] });
      return res(200, { brief: "ok" }, { "X-PAYMENT-RESPONSE": "%%%not-base64-json%%%" });
    }) as unknown as typeof fetch;

    const out = await fetchWithX402("http://x/brief", PAYER, { fetchImpl, nowSec: NOW });
    expect(out.settlement).toBeUndefined();
    expect(out.paid).toBe(true);
  });

  it("reports paid=false when the retried request is itself rejected", async () => {
    const requirements = req();
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) return res(402, { accepts: [requirements] });
      return res(402, { error: "still unpaid" }); // e.g. server rejected the authorization
    }) as unknown as typeof fetch;

    const out = await fetchWithX402("http://x/brief", PAYER, { fetchImpl, nowSec: NOW });
    expect(out.paid).toBe(false);
    expect(out.status).toBe(402);
    expect(out.requirements).toEqual(requirements);
  });
});
