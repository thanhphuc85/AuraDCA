import type { HistoryEntry } from "../types.js";

export interface PriceSnapshot {
  date: string;
  impliedPrice: number; // USDC per cirBTC
  usdcIn: number;
  btcOut: number;
}

export interface PriceAnalysis {
  currentPrice: number | null;
  priceHistory: PriceSnapshot[];
  change24h: number | null;
  change7d: number | null;
  highestPrice: number | null;
  lowestPrice: number | null;
  drawdownFromHigh: number | null;
  dipSignal: "none" | "mild" | "moderate" | "strong";
  dipMultiplier: number;
  recommendation: string;
}

export interface DipConfig {
  mildThreshold: number;     // e.g. 0.05 = 5% drop
  moderateThreshold: number; // e.g. 0.10 = 10% drop
  strongThreshold: number;   // e.g. 0.20 = 20% drop
  mildMultiplier: number;    // e.g. 1.2x
  moderateMultiplier: number; // e.g. 1.5x
  strongMultiplier: number;  // e.g. 2.0x
}

const DEFAULT_DIP_CONFIG: DipConfig = {
  mildThreshold: 0.05,
  moderateThreshold: 0.10,
  strongThreshold: 0.20,
  mildMultiplier: 1.2,
  moderateMultiplier: 1.5,
  strongMultiplier: 2.0,
};

export function extractPriceHistory(history: HistoryEntry[]): PriceSnapshot[] {
  const snapshots: PriceSnapshot[] = [];
  for (const entry of history) {
    if (entry.status !== "success" && entry.status !== "dry_run") continue;
    const usdcIn = parseFloat(entry.clampedAmountUsdc ?? "0");
    const btcOut = parseFloat(entry.amountOut ?? "0");
    if (usdcIn <= 0 || btcOut <= 0) continue;
    snapshots.push({
      date: entry.date,
      impliedPrice: usdcIn / btcOut,
      usdcIn,
      btcOut,
    });
  }
  return snapshots;
}

function percentChange(from: number, to: number): number {
  if (from === 0) return 0;
  return (to - from) / from;
}

export function analyzePrices(
  history: HistoryEntry[],
  dipConfig: DipConfig = DEFAULT_DIP_CONFIG,
): PriceAnalysis {
  const snapshots = extractPriceHistory(history);

  if (snapshots.length === 0) {
    return {
      currentPrice: null,
      priceHistory: [],
      change24h: null,
      change7d: null,
      highestPrice: null,
      lowestPrice: null,
      drawdownFromHigh: null,
      dipSignal: "none",
      dipMultiplier: 1.0,
      recommendation: "No swap data available yet — use base DCA amount.",
    };
  }

  const current = snapshots[snapshots.length - 1]!;
  const prices = snapshots.map((s) => s.impliedPrice);
  const highest = Math.max(...prices);
  const lowest = Math.min(...prices);
  const drawdown = percentChange(highest, current.impliedPrice);

  // 24h change: compare with most recent prior entry
  const prev = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : undefined;
  const change24h = prev
    ? percentChange(prev.impliedPrice, current.impliedPrice)
    : null;

  // 7d change: find entry closest to 7 days ago
  const sevenDaysAgo = new Date(current.date);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDayStr = sevenDaysAgo.toISOString().slice(0, 10);
  const weekAgo = snapshots.filter((s) => s.date <= sevenDayStr);
  const lastWeekEntry = weekAgo.length > 0 ? weekAgo[weekAgo.length - 1] : undefined;
  const change7d = lastWeekEntry
    ? percentChange(lastWeekEntry.impliedPrice, current.impliedPrice)
    : null;

  // Dip detection based on drawdown from all-time high
  const absDrawdown = Math.abs(drawdown);
  let dipSignal: PriceAnalysis["dipSignal"] = "none";
  let dipMultiplier = 1.0;
  let recommendation: string;

  if (absDrawdown >= dipConfig.strongThreshold) {
    dipSignal = "strong";
    dipMultiplier = dipConfig.strongMultiplier;
    recommendation = `Strong dip detected (${(absDrawdown * 100).toFixed(1)}% from high). Recommend ${dipConfig.strongMultiplier}x base amount.`;
  } else if (absDrawdown >= dipConfig.moderateThreshold) {
    dipSignal = "moderate";
    dipMultiplier = dipConfig.moderateMultiplier;
    recommendation = `Moderate dip detected (${(absDrawdown * 100).toFixed(1)}% from high). Recommend ${dipConfig.moderateMultiplier}x base amount.`;
  } else if (absDrawdown >= dipConfig.mildThreshold) {
    dipSignal = "mild";
    dipMultiplier = dipConfig.mildMultiplier;
    recommendation = `Mild dip detected (${(absDrawdown * 100).toFixed(1)}% from high). Recommend ${dipConfig.mildMultiplier}x base amount.`;
  } else {
    recommendation = "Price is near highs. Use standard base DCA amount.";
  }

  return {
    currentPrice: current.impliedPrice,
    priceHistory: snapshots.slice(-14),
    change24h,
    change7d,
    highestPrice: highest,
    lowestPrice: lowest,
    drawdownFromHigh: drawdown,
    dipSignal,
    dipMultiplier,
    recommendation,
  };
}
