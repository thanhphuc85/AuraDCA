import { describe, it, expect } from "vitest";
import { computeScheduledSpends } from "../ledger/schedule.js";
import type { Ledger, UserAccount } from "../types.js";

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

const NOW = "2026-06-15T10:00:00.000Z"; // a Monday, 10:00 UTC (not a legacy slot hour)

describe("computeScheduledSpends — rich schedule", () => {
  it("manual users are never scheduled", () => {
    const l = mkLedger([mkUser("0xa", { dcaMode: "manual", dcaFrequency: "hours", dcaEveryHours: 1, dcaAmountPerRun: "1.000000", lastChargedAt: "2026-01-01T00:00:00.000Z" })]);
    expect(computeScheduledSpends(l, NOW).spends).toHaveLength(0);
  });

  it("paused users are never scheduled", () => {
    const l = mkLedger([mkUser("0xa", { dcaPaused: true, dcaFrequency: "hours", dcaEveryHours: 1, dcaAmountPerRun: "1.000000" })]);
    expect(computeScheduledSpends(l, NOW).spends).toHaveLength(0);
  });

  it("every-N-hours: due when elapsed ≥ interval, spends amountPerRun", () => {
    const l = mkLedger([mkUser("0xa", { dcaFrequency: "hours", dcaEveryHours: 6, dcaAmountPerRun: "2.500000", lastChargedAt: "2026-06-15T03:00:00.000Z" })]);
    const r = computeScheduledSpends(l, NOW); // 7h elapsed ≥ 6
    expect(r.spends).toEqual([{ address: "0xa", spend: 2.5 }]);
  });

  it("every-N-hours: NOT due when elapsed < interval", () => {
    const l = mkLedger([mkUser("0xa", { dcaFrequency: "hours", dcaEveryHours: 6, dcaAmountPerRun: "2.5", lastChargedAt: "2026-06-15T07:00:00.000Z" })]);
    expect(computeScheduledSpends(l, NOW).spends).toHaveLength(0); // only 3h elapsed
  });

  it("weekly: runs only on chosen UTC weekday, once/day", () => {
    // NOW is Monday (getUTCDay()===1).
    const due = mkLedger([mkUser("0xa", { dcaFrequency: "weekly", dcaWeekdays: [1], dcaAmountPerRun: "5", lastChargedAt: "2026-06-08T10:00:00.000Z" })]);
    expect(computeScheduledSpends(due, NOW).spends).toHaveLength(1);
    const notToday = mkLedger([mkUser("0xb", { dcaFrequency: "weekly", dcaWeekdays: [3], dcaAmountPerRun: "5", lastChargedAt: "2026-06-08T10:00:00.000Z" })]);
    expect(computeScheduledSpends(notToday, NOW).spends).toHaveLength(0);
    const alreadyToday = mkLedger([mkUser("0xc", { dcaFrequency: "weekly", dcaWeekdays: [1], dcaAmountPerRun: "5", lastChargedAt: "2026-06-15T02:00:00.000Z" })]);
    expect(computeScheduledSpends(alreadyToday, NOW).spends).toHaveLength(0);
  });

  it("daily cap clamps the per-run amount", () => {
    const l = mkLedger([mkUser("0xa", {
      dcaFrequency: "hours", dcaEveryHours: 1, dcaAmountPerRun: "10", dcaDailyCapUsdc: "12",
      dcaSpentDayUsdc: "8", dcaSpentDayDate: "2026-06-15", lastChargedAt: "2026-06-15T08:00:00.000Z",
    })]);
    // remaining cap = 12 - 8 = 4 → spend clamped to 4
    expect(computeScheduledSpends(l, NOW).spends).toEqual([{ address: "0xa", spend: 4 }]);
  });

  it("daily cap already reached → skipped", () => {
    const l = mkLedger([mkUser("0xa", {
      dcaFrequency: "hours", dcaEveryHours: 1, dcaAmountPerRun: "10", dcaDailyCapUsdc: "12",
      dcaSpentDayUsdc: "12", dcaSpentDayDate: "2026-06-15", lastChargedAt: "2026-06-15T08:00:00.000Z",
    })]);
    expect(computeScheduledSpends(l, NOW).spends).toHaveLength(0);
  });

  it("smart mode: gated on dip threshold", () => {
    const u = { dcaFrequency: "hours" as const, dcaEveryHours: 1, dcaAmountPerRun: "3", dcaMode: "smart" as const, dcaSmartMinDipPct: 5, lastChargedAt: "2026-06-15T08:00:00.000Z" };
    const l = mkLedger([mkUser("0xa", u)]);
    expect(computeScheduledSpends(l, NOW, { drawdownPct: 0.03 }).spends).toHaveLength(0); // 3% < 5%
    expect(computeScheduledSpends(l, NOW, { drawdownPct: 0.07 }).spends).toHaveLength(1); // 7% ≥ 5%
  });

  it("smart mode: gated on Fear & Greed below threshold", () => {
    const u = { dcaFrequency: "hours" as const, dcaEveryHours: 1, dcaAmountPerRun: "3", dcaMode: "smart" as const, dcaSmartFearBelow: 30, lastChargedAt: "2026-06-15T08:00:00.000Z" };
    const l = mkLedger([mkUser("0xa", u)]);
    expect(computeScheduledSpends(l, NOW, { fearGreedIndex: 45 }).spends).toHaveLength(0);
    expect(computeScheduledSpends(l, NOW, { fearGreedIndex: 20 }).spends).toHaveLength(1);
    expect(computeScheduledSpends(l, NOW, { fearGreedIndex: null }).spends).toHaveLength(0);
  });
});

describe("computeScheduledSpends — legacy model still works", () => {
  it("legacy rate/day only fires at 07/13/19 UTC slot hours", () => {
    const u = mkUser("0xa", { dcaRatePerDay: "3.000000", lastChargedAt: "2026-06-14T13:00:00.000Z" });
    const l = mkLedger([u]);
    // 10:00 is not a slot hour → nothing
    expect(computeScheduledSpends(l, "2026-06-15T10:00:00.000Z").spends).toHaveLength(0);
    // 13:00 is a slot hour → fires
    expect(computeScheduledSpends(l, "2026-06-15T13:00:00.000Z").spends).toHaveLength(1);
  });
});
