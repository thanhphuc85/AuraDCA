import type { Ledger, UserAccount, DistributionRecord } from "../types.js";
import { USDC_DECIMALS, CIRBTC_DECIMALS, DEFAULT_DCA_TOKEN } from "./constants.js";
import { logger } from "../logger.js";

export interface UserSpend {
  address: string;
  spend: number; // USDC this user's schedule wants to spend this run
  tokenOut: string; // the token this user DCAs into (symbol); default DEFAULT_DCA_TOKEN
  sizeMultiplier?: number; // smart-mode dynamic-sizing factor applied this run (1 = ordinary)
}

/**
 * Group scheduled spends by their target token. Each group is settled as ONE
 * pooled swap (USDC → that token) and distributed pro-rata within the group, so
 * users who pick different tokens are never mixed into the same swap.
 */
export function groupSpendsByToken(spends: UserSpend[]): Map<string, UserSpend[]> {
  const groups = new Map<string, UserSpend[]>();
  for (const s of spends) {
    const key = s.tokenOut || DEFAULT_DCA_TOKEN;
    const g = groups.get(key);
    if (g) g.push(s); else groups.set(key, [s]);
  }
  return groups;
}

export interface ScheduleResult {
  spends: UserSpend[];
  totalUsdc: number;
}

// Optional live market context, used to gate "smart"-mode users. drawdownPct is
// the current cirBTC drawdown from its recent high (0–1); fearGreedIndex is the
// 0–100 Fear & Greed reading (null when unavailable).
export interface MarketContext {
  drawdownPct?: number;
  fearGreedIndex?: number | null;
  // The agent's chosen sizing signal for this run, as a deviation from neutral
  // (0 = ordinary DCA; +1 ≈ "buy double at sensitivity 1"). When set, smart-mode
  // sizing uses THIS instead of the deterministic dip+F&G formula — but each
  // user's sensitivity and max-multiplier still bound the result. Absent = fall
  // back to smartMarketDeviation(). deviation = (agent base multiplier) − 1.
  sizeDeviation?: number;
}

// Cap per-user elapsed time so a long outage doesn't trigger a huge catch-up buy.
const MAX_CATCHUP_DAYS = 2;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD
}
// UTC Monday (as YYYY-MM-DD) of the week containing `ms`.
function utcWeekStart(ms: number): string {
  const d = new Date(ms);
  const dow = d.getUTCDay(); // 0=Sun
  const diff = (dow + 6) % 7; // days since Monday
  return utcDate(ms - diff * DAY_MS);
}

// Remaining cap after the rolling window's spend so far (with window rollover).
function remainingCap(capStr: string | undefined, spentStr: string | undefined, windowKey: string | undefined, currentKey: string): number {
  const cap = Number.parseFloat(capStr ?? "0");
  if (!(cap > 0)) return Infinity; // no cap configured
  const spent = windowKey === currentKey ? Number.parseFloat(spentStr ?? "0") : 0;
  return Math.max(0, cap - spent);
}

// Is a rich-schedule user due to run at `now`? Every cadence is anchored to UTC:
// "hours" fires on an `every`-hour grid from the epoch, "daily"/"days" on an
// `every`-day grid from the epoch (a UTC midnight), and "weekly" on the chosen
// UTC weekday, at most once per UTC day.
function isDueNow(user: UserAccount, now: number): boolean {
  const lastMs = new Date(user.lastChargedAt ?? user.firstSeen).getTime();
  switch (user.dcaFrequency) {
    case "hours": {
      const every = Math.max(1, Math.min(24, Math.floor(user.dcaEveryHours ?? 24)));
      // UTC-anchored grid: partition time into `every`-hour buckets measured from
      // the Unix epoch (itself 00:00 UTC) and fire once per bucket. For divisors
      // of 24 the buckets line up with the UTC clock every day (every 6h →
      // 00/06/12/18 UTC); for odd intervals (5h, 7h…) the spacing stays a uniform
      // `every` hours across midnight instead of resetting to a stubby final slot.
      // Comparing buckets (not an exact-hour modulo) means a missed cron hour
      // still fires late within the same bucket, and never twice.
      const bucket = (ms: number) => Math.floor(ms / HOUR_MS / every);
      return bucket(now) > bucket(lastMs);
    }
    case "days":
    case "daily":
    default: {
      // Same idea as "hours", one level up: partition into `every`-day buckets
      // from the Unix epoch (a UTC midnight) and fire once per bucket, on the
      // first cron tick of the new UTC day (00:00 UTC, or later that day if the
      // 00:00 tick was missed). daily → every=1 (once per UTC day); every N days
      // keeps a uniform N-day spacing anchored to midnight, never resetting at a
      // month/year boundary.
      const every = user.dcaFrequency === "days"
        ? Math.max(1, Math.floor(user.dcaEveryDays ?? 1))
        : 1;
      const bucket = (ms: number) => Math.floor(ms / DAY_MS / every);
      return bucket(now) > bucket(lastMs);
    }
    case "weekly": {
      const days = Array.isArray(user.dcaWeekdays) ? user.dcaWeekdays : [];
      const today = new Date(now).getUTCDay();
      if (days.indexOf(today) < 0) return false;
      return utcDate(lastMs) !== utcDate(now); // at most once per UTC day
    }
  }
}

// Does a "smart"-mode user's market condition pass this run?
function smartConditionMet(user: UserAccount, market: MarketContext): boolean {
  if (user.dcaSmartMinDipPct != null && user.dcaSmartMinDipPct > 0) {
    const dip = (market.drawdownPct ?? 0) * 100;
    if (dip < user.dcaSmartMinDipPct) return false;
  }
  if (user.dcaSmartFearBelow != null && user.dcaSmartFearBelow > 0) {
    const fg = market.fearGreedIndex;
    if (fg == null || fg >= user.dcaSmartFearBelow) return false;
  }
  return true;
}

// --- Smart-mode dynamic sizing ---
// Turns the binary "buy / skip" gate into a continuous knob: when a smart user
// does buy, the amount scales with how cheap the market looks. Driven by real,
// external signals (Fear & Greed from the market analyst; cirBTC drawdown when a
// live price exists), bounded to a safe range — and the caller still clamps the
// result by the user's daily/weekly caps, wallet balance, and clampDecision, so
// the multiplier can never breach a hard limit.
const SMART_DIP_REF = 0.10;   // a 10% drawdown contributes +1.0 to the deviation
const SMART_DIP_CAP = 2.0;    // …capped so an extreme dip alone can't exceed +2.0
const SMART_FEAR_WEIGHT = 1.0; // extreme fear (0) → +1.0, extreme greed (100) → −1.0
export const SMART_MIN_MULT = 0.5;   // hard floor — never buy less than half the base
export const SMART_DEFAULT_MAX_MULT = 3.0; // default ceiling if the user sets none
export const SMART_DEFAULT_SENSITIVITY = 1.0;

// Per-user tuning of the smart-sizing curve.
export interface SmartSizingOpts {
  sensitivity?: number; // scales how hard the market read moves the buy (default 1)
  maxMult?: number;     // ceiling on the multiplier (default SMART_DEFAULT_MAX_MULT)
}

/**
 * How much a smart-mode buy scales this run, in [SMART_MIN_MULT, maxMult].
 * Buy MORE in dips and fear, LESS in froth; a neutral or unknown market returns
 * exactly 1.0 (ordinary DCA), so missing data can only be safe. `sensitivity`
 * and `maxMult` let a user dial the aggressiveness; defaults reproduce the
 * original fixed [0.5, 3.0] curve.
 */
export function smartSizeMultiplier(market: MarketContext, opts: SmartSizingOpts = {}): number {
  return applySmartMultiplier(smartMarketDeviation(market), opts);
}

/**
 * The deterministic market deviation from a neutral read: how far dip + Fear &
 * Greed push sizing away from 1.0, before any per-user tuning. 0 = neutral or
 * unknown market. This is the fallback signal used when the agent doesn't propose
 * one, and the reference the agent's own read is bounded against.
 */
export function smartMarketDeviation(market: MarketContext): number {
  let dev = 0;
  const dd = market.drawdownPct ?? 0;
  if (dd > 0) dev += Math.min(SMART_DIP_CAP, dd / SMART_DIP_REF);
  const fg = market.fearGreedIndex;
  if (fg != null && Number.isFinite(fg)) dev += ((50 - fg) / 50) * SMART_FEAR_WEIGHT;
  return dev;
}

/**
 * Turn a market deviation (from the formula OR the agent's own read) into a
 * bounded per-user multiplier: 1 + sensitivity·deviation, clamped to
 * [SMART_MIN_MULT, maxMult]. This is the hard envelope — no deviation, however
 * large or from wherever, can push a buy outside it. A non-finite deviation is
 * treated as neutral (1.0), so a bad signal can only be safe.
 */
export function applySmartMultiplier(deviation: number, opts: SmartSizingOpts = {}): number {
  const sensitivity = opts.sensitivity != null && opts.sensitivity > 0 ? opts.sensitivity : SMART_DEFAULT_SENSITIVITY;
  const maxMult = opts.maxMult != null && opts.maxMult >= 1 ? opts.maxMult : SMART_DEFAULT_MAX_MULT;
  const dev = Number.isFinite(deviation) ? deviation : 0;
  return Math.max(SMART_MIN_MULT, Math.min(maxMult, 1 + sensitivity * dev));
}

/**
 * Deterministic per-user recurring DCA. Each active user contributes a spend
 * this run; the agent swaps the SUM. Two models coexist:
 *   • Rich schedule (dcaFrequency set): spend a fixed dcaAmountPerRun whenever
 *     the user's cadence is due, gated by smart conditions and daily/weekly caps.
 *     Every cadence is anchored to UTC (see isDueNow): "hours"/"daily"/"days"
 *     fire on an epoch-based grid (a UTC midnight), so intervals land on the UTC
 *     clock rather than drifting from each user's first run; "weekly" fires on
 *     the chosen UTC weekday.
 *   • Legacy (no dcaFrequency): rate/day × elapsed at the fixed 07/13/19 UTC
 *     slots, honoring dcaRunsPerDay.
 */
export function computeScheduledSpends(ledger: Ledger, nowIso: string, market: MarketContext = {}, defaultToken: string = DEFAULT_DCA_TOKEN): ScheduleResult {
  const now = new Date(nowIso).getTime();
  const utcHour = new Date(nowIso).getUTCHours();
  const legacySlot = utcHour < 12 ? 0 : utcHour < 18 ? 1 : 2;
  const isLegacySlotHour = utcHour === 7 || utcHour === 13 || utcHour === 19;
  const dayKey = utcDate(now);
  const weekKey = utcWeekStart(now);
  const spends: UserSpend[] = [];
  let total = 0;

  for (const user of Object.values(ledger.users)) {
    if (user.dcaPaused) continue;
    if (user.dcaMode === "manual") continue; // manual users only buy on demand
    const balance = Number.parseFloat(user.usdcBalance ?? "0");
    if (!(balance > 0)) continue;

    let spend = 0;
    let sizeMultiplier = 1;

    if (user.dcaFrequency) {
      // --- Rich schedule ---
      if (!isDueNow(user, now)) continue;
      if (user.dcaMode === "smart" && !smartConditionMet(user, market)) continue;
      let amount = Number.parseFloat(user.dcaAmountPerRun ?? "0");
      if (!(amount > 0)) continue;
      // Smart mode scales the buy by how cheap the market looks (dip + fear),
      // bounded — then the caps below still clamp the result.
      if (user.dcaMode === "smart") {
        // Prefer the agent's chosen sizing signal for this run; fall back to the
        // deterministic dip+F&G formula. Either way the per-user bounds apply.
        const opts = { sensitivity: user.dcaSmartSensitivity, maxMult: user.dcaSmartMaxMult };
        sizeMultiplier = market.sizeDeviation != null
          ? applySmartMultiplier(market.sizeDeviation, opts)
          : smartSizeMultiplier(market, opts);
        amount *= sizeMultiplier;
      }
      // Honor daily + weekly caps.
      amount = Math.min(
        amount,
        remainingCap(user.dcaDailyCapUsdc, user.dcaSpentDayUsdc, user.dcaSpentDayDate, dayKey),
        remainingCap(user.dcaWeeklyCapUsdc, user.dcaSpentWeekUsdc, user.dcaSpentWeekStart, weekKey),
      );
      spend = Number.parseFloat(Math.min(amount, balance).toFixed(USDC_DECIMALS));
    } else {
      // --- Legacy rate/day model at fixed slots ---
      if (!isLegacySlotHour) continue;
      const runsPerDay = user.dcaRunsPerDay === 1 || user.dcaRunsPerDay === 2 ? user.dcaRunsPerDay : 3;
      if (runsPerDay === 1 && legacySlot !== 0) continue;
      if (runsPerDay === 2 && legacySlot === 1) continue;
      const rate = Number.parseFloat(user.dcaRatePerDay ?? "0");
      if (!(rate > 0)) continue;
      const lastMs = new Date(user.lastChargedAt ?? user.firstSeen).getTime();
      let elapsedDays = (now - lastMs) / DAY_MS;
      if (!(elapsedDays > 0)) continue;
      elapsedDays = Math.min(elapsedDays, MAX_CATCHUP_DAYS);
      spend = Number.parseFloat(Math.min(rate * elapsedDays, balance).toFixed(USDC_DECIMALS));
    }

    if (spend > 0) {
      const entry: UserSpend = { address: user.address, spend, tokenOut: user.dcaTokenOut || defaultToken };
      if (user.dcaMode === "smart") entry.sizeMultiplier = sizeMultiplier; // smart-mode annotation only
      spends.push(entry);
      total += spend;
    }
  }

  return { spends, totalUsdc: Number.parseFloat(total.toFixed(USDC_DECIMALS)) };
}

/**
 * Partition a run's scheduled spends by how they settle. A LIVE spend settles a
 * real USDC→token swap and so is subject to the wallet balance / reserve /
 * daily-cap guardrails; a SIMULATED spend is an honest paper fill that touches no
 * real USDC and must NOT be gated or throttled by the wallet. `isSimulated`
 * decides per token symbol (typically: the token has no live route AND a price is
 * available this run). Returns the two USDC totals, each rounded to USDC_DECIMALS.
 */
export function splitScheduledBySettlement(
  spends: UserSpend[],
  isSimulated: (token: string) => boolean,
): { liveTotal: number; simTotal: number } {
  let live = 0;
  let sim = 0;
  for (const s of spends) {
    if (isSimulated(s.tokenOut)) sim += s.spend;
    else live += s.spend;
  }
  return {
    liveTotal: Number.parseFloat(live.toFixed(USDC_DECIMALS)),
    simTotal: Number.parseFloat(sim.toFixed(USDC_DECIMALS)),
  };
}

/**
 * Sum of the daily budgets of every user who could legitimately DCA today
 * (funded, not paused, not manual). Because each user is already bounded by
 * their own daily cap, this sum is the largest total that can legitimately be
 * spent in one day. Used to auto-scale the global daily ceiling with the active
 * user base, so a growing crowd is never diluted pro-rata by a static number,
 * while an absolute env ceiling still hard-caps runaway spend. Falls back to the
 * legacy per-day rate when a user has no explicit daily cap.
 */
export function activeDailyBudgetTotal(ledger: Ledger): number {
  let total = 0;
  for (const user of Object.values(ledger.users)) {
    if (user.dcaPaused) continue;
    if (user.dcaMode === "manual") continue;
    if (!(Number.parseFloat(user.usdcBalance ?? "0") > 0)) continue;
    const cap = Number.parseFloat(user.dcaDailyCapUsdc ?? "");
    if (Number.isFinite(cap) && cap > 0) {
      total += cap;
      continue;
    }
    const rate = Number.parseFloat(user.dcaRatePerDay ?? "");
    if (Number.isFinite(rate) && rate > 0) total += rate;
  }
  return Number.parseFloat(total.toFixed(USDC_DECIMALS));
}

// Rough expected number of DCA runs per UTC day for a user, used only to size a
// nominal daily budget when the user set no explicit daily cap. Mirrors the
// cadence math in isDueNow/the dashboard; a fractional value (e.g. every-3-days →
// 1/3) is fine because it only scales a fallback estimate.
function estimateRunsPerDay(user: UserAccount): number {
  switch (user.dcaFrequency) {
    case "hours":
      return 24 / Math.max(1, Math.min(24, Math.floor(user.dcaEveryHours ?? 24)));
    case "days":
      return 1 / Math.max(1, Math.floor(user.dcaEveryDays ?? 1));
    case "weekly":
      return (Array.isArray(user.dcaWeekdays) ? user.dcaWeekdays.length : 0) / 7;
    case "daily":
      return 1;
    default:
      // Legacy rate model fires at fixed slots; dcaRunsPerDay ∈ {1,2,3}.
      return user.dcaRunsPerDay === 1 || user.dcaRunsPerDay === 2 ? user.dcaRunsPerDay : 3;
  }
}

/**
 * Aggregate daily paper (simulated) budget: the largest total that funded, active,
 * non-manual users who DCA into a SIMULATED-route token could legitimately paper-
 * fill in one UTC day. This is the paper-side mirror of activeDailyBudgetTotal —
 * used to bound the run's simulated spend the same way clampDecision bounds the
 * live spend, since paper fills bypass the wallet/reserve/campaign clamp by design.
 * A user with an explicit daily cap contributes that cap; otherwise their nominal
 * daily spend (per-run × runs/day, or the legacy rate), WIDENED by their smart-mode
 * max multiplier so this aggregate bound never neuters an individual's smart
 * upsizing — only the crowd-wide paper pace is capped. Returns 0 when no such user
 * exists, which the caller treats as "no ceiling" (unchanged behaviour).
 */
export function simDailyBudgetTotal(
  ledger: Ledger,
  isSimulated: (token: string) => boolean,
  defaultToken: string = DEFAULT_DCA_TOKEN,
): number {
  let total = 0;
  for (const user of Object.values(ledger.users)) {
    if (user.dcaPaused) continue;
    if (user.dcaMode === "manual") continue;
    if (!(Number.parseFloat(user.usdcBalance ?? "0") > 0)) continue;
    if (!isSimulated(user.dcaTokenOut || defaultToken)) continue;

    const cap = Number.parseFloat(user.dcaDailyCapUsdc ?? "");
    if (Number.isFinite(cap) && cap > 0) {
      total += cap;
      continue;
    }
    // No explicit cap: derive a nominal daily budget from the schedule.
    let nominalDaily = 0;
    if (user.dcaFrequency) {
      const perRun = Number.parseFloat(user.dcaAmountPerRun ?? "");
      if (Number.isFinite(perRun) && perRun > 0) nominalDaily = perRun * estimateRunsPerDay(user);
    } else {
      const rate = Number.parseFloat(user.dcaRatePerDay ?? "");
      if (Number.isFinite(rate) && rate > 0) nominalDaily = rate;
    }
    if (!(nominalDaily > 0)) continue;
    const maxMult = user.dcaMode === "smart"
      ? (user.dcaSmartMaxMult != null && user.dcaSmartMaxMult >= 1 ? user.dcaSmartMaxMult : SMART_DEFAULT_MAX_MULT)
      : 1;
    total += nominalDaily * maxMult;
  }
  return Number.parseFloat(total.toFixed(USDC_DECIMALS));
}

/**
 * Honest PAPER settlement for a token whose real Arc route is offline (cirBTC).
 * Mirrors applyScheduledDistribution's per-user bookkeeping, but touches ONLY the
 * separate sim* fields: it never swaps, never debits real USDC, never credits a
 * real token balance. Each user is credited the token they WOULD have received at
 * the live market price (`priceUsd`, USD per 1 token), and their hypothetical
 * spend is tracked in simUsdcSpent. lastChargedAt and the daily/weekly spend
 * windows still advance, so the UTC-bucket schedule stays idempotent (one paper
 * fill per bucket) and per-user caps apply to the simulation exactly as they
 * would to a real DCA. Returns the group totals for the run message.
 */
export function applySimulatedDistribution(
  ledger: Ledger,
  spends: UserSpend[],
  executedUsdc: string,
  priceUsd: number,
  runTimestamp: string,
  tokenSymbol: string = DEFAULT_DCA_TOKEN,
  tokenDecimals: number = CIRBTC_DECIMALS,
): { received: number; usdc: number } | null {
  const scheduledTotal = spends.reduce((s, x) => s + x.spend, 0);
  const executed = Number.parseFloat(executedUsdc);
  if (scheduledTotal <= 0 || executed <= 0 || !(priceUsd > 0)) return null;

  const nowMs = new Date(runTimestamp).getTime();
  const dayKey = utcDate(nowMs);
  const weekKey = utcWeekStart(nowMs);
  let sumTok = 0;

  for (const { address, spend } of spends) {
    const user = ledger.users[address];
    if (!user) continue;
    const fraction = spend / scheduledTotal;
    const usdcShare = Number.parseFloat((fraction * executed).toFixed(USDC_DECIMALS));
    const tokShare = Number.parseFloat((usdcShare / priceUsd).toFixed(tokenDecimals));
    sumTok += tokShare;
    // Paper position only — real usdcBalance / cirBtcBalance are deliberately
    // left untouched so the dashboard's real numbers keep matching on-chain state.
    user.simCirBtcBalance = (Number.parseFloat(user.simCirBtcBalance ?? "0") + tokShare).toFixed(tokenDecimals);
    user.simUsdcSpent = (Number.parseFloat(user.simUsdcSpent ?? "0") + usdcShare).toFixed(USDC_DECIMALS);
    // Advance the schedule cursor + spend windows exactly like the real path, so
    // the every-N-hours bucket fires a paper fill at most once per bucket and the
    // user's daily/weekly caps bound the simulation too.
    const daySpent = user.dcaSpentDayDate === dayKey ? parseFloat(user.dcaSpentDayUsdc ?? "0") : 0;
    user.dcaSpentDayUsdc = (daySpent + usdcShare).toFixed(USDC_DECIMALS);
    user.dcaSpentDayDate = dayKey;
    const weekSpent = user.dcaSpentWeekStart === weekKey ? parseFloat(user.dcaSpentWeekUsdc ?? "0") : 0;
    user.dcaSpentWeekUsdc = (weekSpent + usdcShare).toFixed(USDC_DECIMALS);
    user.dcaSpentWeekStart = weekKey;
    user.lastChargedAt = runTimestamp;
    user.lastActivity = runTimestamp;
  }

  const received = Number.parseFloat((executed / priceUsd).toFixed(tokenDecimals));
  logger.info(`Simulated (paper) fill: ${executedUsdc} USDC -> ${received} ${tokenSymbol} at $${priceUsd.toFixed(2)} across ${spends.length} user(s)`);
  return { received, usdc: executed };
}

/**
 * Attribute an executed swap back to the per-user schedule for ONE token group:
 * each user gets the received token in proportion to their scheduled spend, and
 * their USDC is debited by the amount actually executed (scaled down if a
 * guardrail capped the group total below schedule). `tokenSymbol`/`tokenDecimals`
 * default to cirBTC, so existing single-token callers are unchanged.
 */
export function applyScheduledDistribution(
  ledger: Ledger,
  spends: UserSpend[],
  executedUsdc: string,
  tokenReceived: string,
  runTimestamp: string,
  tokenSymbol: string = DEFAULT_DCA_TOKEN,
  tokenDecimals: number = CIRBTC_DECIMALS,
): DistributionRecord | null {
  const scheduledTotal = spends.reduce((s, x) => s + x.spend, 0);
  const executed = Number.parseFloat(executedUsdc);
  const received = Number.parseFloat(tokenReceived);
  if (scheduledTotal <= 0 || executed <= 0 || received <= 0) return null;

  const scale = Math.min(1, executed / scheduledTotal); // guardrail may cap total below schedule

  const allocations: DistributionRecord["allocations"] = [];
  let sumUsdc = 0;
  let sumTok = 0;

  for (const { address, spend } of spends) {
    const user = ledger.users[address];
    if (!user) continue;
    const fraction = spend / scheduledTotal;
    const usdcShare = Number.parseFloat((spend * scale).toFixed(USDC_DECIMALS));
    const tokShare = Number.parseFloat((fraction * received).toFixed(tokenDecimals));
    allocations.push({
      address,
      usdcShare: usdcShare.toFixed(USDC_DECIMALS),
      cirBtcShare: tokShare.toFixed(tokenDecimals), // received-token share (field kept for back-compat)
      poolFraction: fraction.toFixed(8),
    });
    sumUsdc += usdcShare;
    sumTok += tokShare;
  }

  // Assign the rounding remainder to the largest contributor so the books close
  // EXACTLY. The remainder is signed: per-share rounding can push the sum a hair
  // above OR below the executed/received totals, and both directions must be
  // absorbed (an earlier version only handled the positive side, leaving a
  // sub-micro over-debit when rounding overshot). Sub-token magnitude, clamped
  // so a share can never go negative.
  if (allocations.length > 0) {
    const largest = allocations.reduce((max, a) => (parseFloat(a.poolFraction) > parseFloat(max.poolFraction) ? a : max));
    largest.usdcShare = Math.max(0, parseFloat(largest.usdcShare) + (executed - sumUsdc)).toFixed(USDC_DECIMALS);
    largest.cirBtcShare = Math.max(0, parseFloat(largest.cirBtcShare) + (received - sumTok)).toFixed(tokenDecimals);
  }

  const isCirBtc = tokenSymbol === "cirBTC";
  const nowMs = new Date(runTimestamp).getTime();
  const dayKey = utcDate(nowMs);
  const weekKey = utcWeekStart(nowMs);
  for (const alloc of allocations) {
    const user = ledger.users[alloc.address];
    if (!user) continue;
    const share = parseFloat(alloc.usdcShare);
    const tok = parseFloat(alloc.cirBtcShare);
    user.usdcBalance = Math.max(0, parseFloat(user.usdcBalance) - share).toFixed(USDC_DECIMALS);
    // Credit the per-token holding; mirror cirBtcBalance so older readers keep
    // working. Seed a missing cirBTC entry from the legacy cirBtcBalance field.
    const balances = (user.tokenBalances ??= {});
    const prior = parseFloat(balances[tokenSymbol] ?? (isCirBtc ? user.cirBtcBalance : "0"));
    balances[tokenSymbol] = (prior + tok).toFixed(tokenDecimals);
    if (isCirBtc) user.cirBtcBalance = balances[tokenSymbol]!;
    user.totalSwapped = (parseFloat(user.totalSwapped) + share).toFixed(USDC_DECIMALS);
    // Roll the daily/weekly spend windows forward, resetting when they lapse.
    const daySpent = user.dcaSpentDayDate === dayKey ? parseFloat(user.dcaSpentDayUsdc ?? "0") : 0;
    user.dcaSpentDayUsdc = (daySpent + share).toFixed(USDC_DECIMALS);
    user.dcaSpentDayDate = dayKey;
    const weekSpent = user.dcaSpentWeekStart === weekKey ? parseFloat(user.dcaSpentWeekUsdc ?? "0") : 0;
    user.dcaSpentWeekUsdc = (weekSpent + share).toFixed(USDC_DECIMALS);
    user.dcaSpentWeekStart = weekKey;
    user.lastChargedAt = runTimestamp;
    user.lastActivity = runTimestamp;
  }

  const record: DistributionRecord = {
    runTimestamp,
    tokenOut: tokenSymbol,
    totalUsdcSwapped: executedUsdc,
    totalCirBtcReceived: tokenReceived, // received-token total (field kept for back-compat)
    allocations,
    timestamp: new Date().toISOString(),
  };
  ledger.distributions.push(record);
  logger.info(`Distribution: ${executedUsdc} USDC / ${tokenReceived} ${tokenSymbol} across ${allocations.length} user(s)`);
  return record;
}
