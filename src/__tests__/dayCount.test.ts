import { describe, it, expect } from "vitest";
import { dayCount } from "../history/store.js";
import type { HistoryEntry } from "../types.js";

const run = (date: string): HistoryEntry => ({ date, timestamp: date + "T00:00:00.000Z", status: "error_swap_failed" } as HistoryEntry);

describe("dayCount — distinct campaign days, not runs", () => {
  it("counts a day once no matter how many times the cron fired that day", () => {
    // The bug this replaces: `history.length + 1` counted runs, so three runs on
    // one day read as three days. At an hourly cron that drifts 24x per real day.
    const sameDay = [run("2026-07-09"), run("2026-07-09"), run("2026-07-09")];
    expect(dayCount(sameDay, "2026-07-09")).toBe(1);
  });

  it("counts distinct dates, including today", () => {
    const h = [run("2026-07-07"), run("2026-07-08"), run("2026-07-08")];
    expect(dayCount(h, "2026-07-09")).toBe(3); // 07, 08, 09
    expect(dayCount(h, "2026-07-08")).toBe(2); // today already ran
  });

  it("is 1 on a fresh campaign", () => {
    expect(dayCount([], "2026-07-07")).toBe(1);
    expect(dayCount([])).toBe(1);
  });

  it("matches reality on the real outage history (~10 days, not 27 runs)", () => {
    // Regression guard for the figure the agent reasons about: 24 runs across 9
    // dates must read as 9 days, not 24.
    const dates = ["2026-07-08","2026-07-09","2026-07-10","2026-07-11","2026-07-12","2026-07-13","2026-07-14","2026-07-15","2026-07-16"];
    const h = dates.flatMap((d) => [run(d), run(d), run(d)]); // 3 runs/day = 27 entries
    expect(h.length).toBe(27);
    expect(dayCount(h, "2026-07-16")).toBe(9);
  });
});
