import { describe, it, expect } from "vitest";
import {
  normalizeAddress,
  boundedForWrite,
  getOrCreateUser,
  refreshAutoDcaRate,
  ensureDefaultRates,
} from "../ledger/store.js";
import { DEFAULT_DCA_HORIZON_DAYS } from "../types.js";
import type { Ledger, UserAccount, DistributionRecord } from "../types.js";

function emptyLedger(): Ledger {
  return { version: 1, lastScannedBlock: 0, users: {}, deposits: [], distributions: [], withdrawals: [] };
}

describe("normalizeAddress", () => {
  it("lower-cases so mixed-case checksummed addresses key the same account", () => {
    expect(normalizeAddress("0xAbCdEf0000000000000000000000000000000001"))
      .toBe("0xabcdef0000000000000000000000000000000001");
  });
});

describe("getOrCreateUser", () => {
  it("creates a zeroed account keyed by the normalized address", () => {
    const ledger = emptyLedger();
    const now = "2026-01-01T00:00:00.000Z";
    const user = getOrCreateUser(ledger, "0xABC0000000000000000000000000000000000001", now);
    expect(user.address).toBe("0xabc0000000000000000000000000000000000001");
    expect(user.usdcBalance).toBe("0");
    expect(user.firstSeen).toBe(now);
    expect(user.lastActivity).toBe(now);
    expect(user.dcaPaused).toBe(false);
    expect(ledger.users["0xabc0000000000000000000000000000000000001"]).toBe(user);
  });

  it("is idempotent — a second call returns the SAME object, not a fresh one", () => {
    const ledger = emptyLedger();
    const first = getOrCreateUser(ledger, "0xabc0000000000000000000000000000000000002", "2026-01-01T00:00:00.000Z");
    first.usdcBalance = "5";
    const second = getOrCreateUser(ledger, "0xABC0000000000000000000000000000000000002");
    expect(second).toBe(first);
    expect(second.usdcBalance).toBe("5"); // not reset
  });
});

describe("refreshAutoDcaRate", () => {
  it("sets rate = balance / horizon for auto (non-custom) users", () => {
    const user = { usdcBalance: "30", dcaRateIsCustom: false } as UserAccount;
    refreshAutoDcaRate(user, 30);
    expect(user.dcaRatePerDay).toBe("1.000000");
  });

  it("uses DEFAULT_DCA_HORIZON_DAYS when no horizon is passed", () => {
    const user = { usdcBalance: String(DEFAULT_DCA_HORIZON_DAYS), dcaRateIsCustom: false } as UserAccount;
    refreshAutoDcaRate(user);
    expect(user.dcaRatePerDay).toBe("1.000000");
  });

  it("never overwrites a user's custom rate", () => {
    const user = { usdcBalance: "999", dcaRateIsCustom: true, dcaRatePerDay: "0.250000" } as UserAccount;
    refreshAutoDcaRate(user, 30);
    expect(user.dcaRatePerDay).toBe("0.250000");
  });

  it("guards divide-by-zero: a non-positive horizon yields a 0 rate, not NaN/Infinity", () => {
    const user = { usdcBalance: "30", dcaRateIsCustom: false } as UserAccount;
    refreshAutoDcaRate(user, 0);
    expect(user.dcaRatePerDay).toBe("0.000000");
  });
});

describe("ensureDefaultRates — one-time back-fill for legacy accounts", () => {
  it("fills rate + dcaPaused only for users whose rate was never set", () => {
    const ledger = emptyLedger();
    ledger.users = {
      legacy: { usdcBalance: "30", dcaRateIsCustom: false } as UserAccount, // no dcaRatePerDay
      custom: { usdcBalance: "30", dcaRateIsCustom: true } as UserAccount,   // custom, untouched
      already: { usdcBalance: "30", dcaRateIsCustom: false, dcaRatePerDay: "9" } as UserAccount,
    };
    const filled = ensureDefaultRates(ledger, 30);
    expect(filled).toBe(1);
    expect(ledger.users.legacy!.dcaRatePerDay).toBe("1.000000");
    expect(ledger.users.legacy!.dcaPaused).toBe(false);
    expect(ledger.users.custom!.dcaRatePerDay).toBeUndefined(); // custom rate left alone
    expect(ledger.users.already!.dcaRatePerDay).toBe("9");       // initialized rate left alone
  });
});

describe("boundedForWrite — keeps the on-disk distributions list bounded", () => {
  const dist = (i: number) => ({ id: String(i) } as unknown as DistributionRecord);

  it("returns the ledger untouched when under the cap", () => {
    const ledger = { ...emptyLedger(), distributions: [dist(1), dist(2)] };
    expect(boundedForWrite(ledger, 5)).toBe(ledger); // same reference, no copy
  });

  it("keeps only the most recent `max` records without mutating the input", () => {
    const all = Array.from({ length: 10 }, (_, i) => dist(i));
    const ledger = { ...emptyLedger(), distributions: all };
    const trimmed = boundedForWrite(ledger, 3);
    expect(trimmed).not.toBe(ledger);
    expect(trimmed.distributions.map((d) => (d as unknown as { id: string }).id)).toEqual(["7", "8", "9"]);
    expect(ledger.distributions).toHaveLength(10); // input preserved for in-memory callers
  });
});
