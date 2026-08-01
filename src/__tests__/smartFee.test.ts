import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chargeSmartExecutionFee, isSmartFeeEnabled, smartFeePerFillUsdc, DEFAULT_SMART_FEE_USDC } from "../x402/smartFee.js";
import { ARC_AGENT_ADDRESS } from "../ledger/constants.js";
import type { Ledger, UserAccount } from "../types.js";
import type { UserSpend } from "../ledger/schedule.js";

function mkUser(addr: string, over: Partial<UserAccount> = {}): UserAccount {
  return {
    address: addr,
    usdcBalance: "100.000000",
    cirBtcBalance: "0",
    totalDeposited: "100.000000",
    totalSwapped: "0",
    totalWithdrawnCirBtc: "0",
    totalWithdrawnUsdc: "0",
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastActivity: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}
function mkLedger(users: UserAccount[]): Ledger {
  return {
    version: 1,
    lastScannedBlock: 0,
    users: Object.fromEntries(users.map((u) => [u.address, u])),
    deposits: [],
    distributions: [],
    withdrawals: [],
  } as unknown as Ledger;
}
// A smart spend carries sizeMultiplier; an ordinary (auto) spend does not.
const smart = (address: string, spend = 5): UserSpend => ({ address, spend, tokenOut: "EURC", sizeMultiplier: 1.5 });
const auto = (address: string, spend = 5): UserSpend => ({ address, spend, tokenOut: "EURC" });

const NOW = "2026-06-15T10:00:00.000Z";
const SAVED = { ...process.env };
function resetEnv() {
  delete process.env.X402_SMART_FEE_ENABLED;
  delete process.env.X402_SMART_FEE_USDC;
}

describe("smart execution fee — config helpers", () => {
  beforeEach(resetEnv);
  afterEach(() => { resetEnv(); Object.assign(process.env, SAVED); });

  it("is disabled by default and enabled only by the exact flag", () => {
    expect(isSmartFeeEnabled()).toBe(false);
    process.env.X402_SMART_FEE_ENABLED = "TRUE";
    expect(isSmartFeeEnabled()).toBe(true);
    process.env.X402_SMART_FEE_ENABLED = "1";
    expect(isSmartFeeEnabled()).toBe(false);
  });

  it("falls back to the default fee when unset or invalid", () => {
    expect(smartFeePerFillUsdc()).toBe(DEFAULT_SMART_FEE_USDC);
    process.env.X402_SMART_FEE_USDC = "0";
    expect(smartFeePerFillUsdc()).toBe(DEFAULT_SMART_FEE_USDC);
    process.env.X402_SMART_FEE_USDC = "-5";
    expect(smartFeePerFillUsdc()).toBe(DEFAULT_SMART_FEE_USDC);
    process.env.X402_SMART_FEE_USDC = "0.05";
    expect(smartFeePerFillUsdc()).toBe(0.05);
  });
});

describe("chargeSmartExecutionFee — gated ledger-level debit", () => {
  beforeEach(resetEnv);
  afterEach(() => { resetEnv(); Object.assign(process.env, SAVED); });

  it("is inert (returns null, no debit) when the feature is off", () => {
    const l = mkLedger([mkUser("0xa")]);
    expect(chargeSmartExecutionFee(l, [smart("0xa")], NOW)).toBeNull();
    expect(l.users["0xa"]!.usdcBalance).toBe("100.000000");
  });

  it("charges only smart participants, not auto users", () => {
    process.env.X402_SMART_FEE_ENABLED = "true";
    const l = mkLedger([mkUser("0xa"), mkUser("0xb")]);
    const receipt = chargeSmartExecutionFee(l, [smart("0xa"), auto("0xb")], NOW);
    expect(receipt).not.toBeNull();
    expect(receipt!.payerCount).toBe(1);
    expect(receipt!.totalUsdc).toBe("0.010000");
    expect(receipt!.feeUsdcEach).toBe("0.010000");
    expect(receipt!.payTo).toBe(ARC_AGENT_ADDRESS);
    expect(l.users["0xa"]!.usdcBalance).toBe("99.990000");
    expect(l.users["0xb"]!.usdcBalance).toBe("100.000000"); // auto user untouched
    expect(l.users["0xa"]!.totalSmartFeesPaidUsdc).toBe("0.010000");
  });

  it("charges a smart user only once even across duplicate spends", () => {
    process.env.X402_SMART_FEE_ENABLED = "true";
    const l = mkLedger([mkUser("0xa")]);
    const receipt = chargeSmartExecutionFee(l, [smart("0xa"), smart("0xa")], NOW);
    expect(receipt!.payerCount).toBe(1);
    expect(l.users["0xa"]!.usdcBalance).toBe("99.990000");
  });

  it("returns null when there are no smart payers", () => {
    process.env.X402_SMART_FEE_ENABLED = "true";
    const l = mkLedger([mkUser("0xa")]);
    expect(chargeSmartExecutionFee(l, [auto("0xa")], NOW)).toBeNull();
  });

  it("never over-charges: clamps to the remaining balance, never negative", () => {
    process.env.X402_SMART_FEE_ENABLED = "true";
    process.env.X402_SMART_FEE_USDC = "0.05";
    const l = mkLedger([mkUser("0xa", { usdcBalance: "0.020000" })]);
    const receipt = chargeSmartExecutionFee(l, [smart("0xa")], NOW);
    expect(receipt!.totalUsdc).toBe("0.020000"); // charged only what was there
    expect(l.users["0xa"]!.usdcBalance).toBe("0.000000");
  });

  it("skips a zero-balance payer entirely (no receipt when nobody could pay)", () => {
    process.env.X402_SMART_FEE_ENABLED = "true";
    const l = mkLedger([mkUser("0xa", { usdcBalance: "0" })]);
    expect(chargeSmartExecutionFee(l, [smart("0xa")], NOW)).toBeNull();
    expect(l.users["0xa"]!.usdcBalance).toBe("0"); // untouched — no debit written
    expect(l.users["0xa"]!.totalSmartFeesPaidUsdc).toBeUndefined();
  });

  it("honors a custom fee rate and accumulates across runs", () => {
    process.env.X402_SMART_FEE_ENABLED = "true";
    process.env.X402_SMART_FEE_USDC = "0.02";
    const l = mkLedger([mkUser("0xa")]);
    chargeSmartExecutionFee(l, [smart("0xa")], NOW);
    const r2 = chargeSmartExecutionFee(l, [smart("0xa")], NOW);
    expect(r2!.feeUsdcEach).toBe("0.020000");
    expect(l.users["0xa"]!.usdcBalance).toBe("99.960000");
    expect(l.users["0xa"]!.totalSmartFeesPaidUsdc).toBe("0.040000");
  });
});
