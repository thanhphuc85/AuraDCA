import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import {
  buildAuthorization,
  signPayment,
  verifyPayment,
  encodePayment,
  decodePayment,
  usdcToAtomic,
} from "../x402/payment.js";
import { buildRequirements } from "../x402/config.js";
import type { PaymentRequirements } from "../x402/types.js";

// Two distinct well-known dev keys/addresses: acct #0 pays, acct #1 is the service.
const PAYER = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const SERVICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const NOW = 1_800_000_000; // fixed clock for deterministic validity

function reqFor(priceUsdc = "0.001"): PaymentRequirements {
  return buildRequirements({
    resource: "/api/x402-brief",
    description: "test brief",
    priceUsdc,
    payTo: SERVICE,
    maxTimeoutSeconds: 120,
  });
}

describe("usdcToAtomic — string-only money math", () => {
  it("converts whole and fractional USDC to 6-dp atomic units", () => {
    expect(usdcToAtomic("1")).toBe("1000000");
    expect(usdcToAtomic("0.001")).toBe("1000");
    expect(usdcToAtomic("0.000001")).toBe("1");
    expect(usdcToAtomic("12.345678")).toBe("12345678");
  });
  it("truncates beyond 6 dp rather than rounding a money amount", () => {
    expect(usdcToAtomic("0.0000009")).toBe("0");
    expect(usdcToAtomic("1.2345678")).toBe("1234567");
  });
});

describe("x402 exact-scheme sign → verify round trip", () => {
  it("a correctly signed authorization verifies and recovers the payer", async () => {
    const req = reqFor();
    const payment = await signPayment(PAYER, req, { nowSec: NOW });
    const result = verifyPayment(payment, req, { nowSec: NOW });
    expect(result.isValid).toBe(true);
    expect(result.payer).toBe(PAYER.address);
  });

  it("survives base64 encode/decode of the X-PAYMENT header", async () => {
    const req = reqFor();
    const payment = await signPayment(PAYER, req, { nowSec: NOW });
    const decoded = decodePayment(encodePayment(payment));
    expect(decoded).not.toBeNull();
    expect(verifyPayment(decoded!, req, { nowSec: NOW }).isValid).toBe(true);
  });

  it("over-paying (value ≥ required) is accepted", async () => {
    const req = reqFor("0.001");
    const payment = await signPayment(PAYER, req, { nowSec: NOW });
    // Verify against a CHEAPER requirement — the authorization still covers it.
    const cheaper = reqFor("0.0005");
    expect(verifyPayment(payment, cheaper, { nowSec: NOW }).isValid).toBe(true);
  });
});

describe("x402 verify rejects tampered or insufficient payments", () => {
  it("rejects an amount below what the server demands", async () => {
    const cheap = await signPayment(PAYER, reqFor("0.0005"), { nowSec: NOW });
    const result = verifyPayment(cheap, reqFor("0.001"), { nowSec: NOW });
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("insufficient_amount");
  });

  it("rejects a payment to the wrong recipient", async () => {
    const req = reqFor();
    const payment = await signPayment(PAYER, req, { nowSec: NOW });
    const otherService = { ...req, payTo: PAYER.address }; // valid, but not who was signed for
    expect(verifyPayment(payment, otherService, { nowSec: NOW }).invalidReason).toBe("wrong_recipient");
  });

  it("rejects an expired authorization", async () => {
    const req = reqFor();
    const payment = await signPayment(PAYER, req, { nowSec: NOW });
    // Verify well after validBefore (now + timeout + slack).
    const later = NOW + 10_000;
    expect(verifyPayment(payment, req, { nowSec: later }).invalidReason).toBe("authorization_expired");
  });

  it("rejects a tampered amount (signature no longer matches)", async () => {
    const req = reqFor();
    const payment = await signPayment(PAYER, req, { nowSec: NOW });
    payment.payload.authorization.value = usdcToAtomic("999"); // forge a bigger value
    const result = verifyPayment(payment, req, { nowSec: NOW });
    expect(result.isValid).toBe(false);
    // The forged value breaks the signature recovery → signer no longer matches.
    expect(["signer_mismatch", "bad_signature"]).toContain(result.invalidReason);
  });

  it("rejects a network mismatch", async () => {
    const req = reqFor();
    const payment = await signPayment(PAYER, req, { nowSec: NOW });
    payment.network = "ethereum";
    expect(verifyPayment(payment, req, { nowSec: NOW }).invalidReason).toBe("network_mismatch");
  });

  it("rejects a malformed base64 header", () => {
    expect(decodePayment("not%%%base64json")).toBeNull();
  });
});

describe("buildAuthorization — validity window", () => {
  it("is valid at signing time and expires after the timeout", () => {
    const req = reqFor();
    const auth = buildAuthorization(PAYER.address, req, { nowSec: NOW });
    expect(Number(auth.validAfter)).toBeLessThanOrEqual(NOW);
    expect(Number(auth.validBefore)).toBe(NOW + req.maxTimeoutSeconds);
    expect(auth.to).toBe(SERVICE);
    expect(auth.value).toBe(req.maxAmountRequired);
  });
});
