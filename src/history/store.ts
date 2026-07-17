import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { HistoryEntry } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const HISTORY_FILE_PATH = path.resolve(__dirname, "../../data/history.json");

const SUCCESS_STATUSES = new Set(["success", "dry_run"]);

export async function readHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(HISTORY_FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function appendEntry(entry: HistoryEntry): Promise<void> {
  const history = await readHistory();
  history.push(entry);
  await writeFile(HISTORY_FILE_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf-8");
}

export function recentHistory(history: HistoryEntry[], limit = 8): HistoryEntry[] {
  return history.slice(-limit);
}

/**
 * How many distinct days this campaign has been running, counting today.
 *
 * This value is handed to Claude as `dayCount` and it reasons about pacing with
 * it, so it has to mean what it says. It previously returned `history.length + 1`
 * — the RUN count — which was already wrong at 3 runs/day (the agent believed it
 * was on "day 21" after a week) and became badly wrong once the cron went hourly,
 * where it would advance 24 "days" per real day.
 */
export function dayCount(history: HistoryEntry[], today?: string): number {
  const days = new Set(history.map((e) => e.date).filter(Boolean));
  if (today) days.add(today);
  return Math.max(1, days.size);
}

export function alreadySpentToday(history: HistoryEntry[], date: string): string {
  const total = history
    .filter((e) => e.date === date && SUCCESS_STATUSES.has(e.status))
    .reduce((sum, e) => sum + Number.parseFloat(e.clampedAmountUsdc ?? "0"), 0);
  return total.toFixed(6);
}

export function totalSpent(history: HistoryEntry[]): string {
  const total = history
    .filter((e) => SUCCESS_STATUSES.has(e.status))
    .reduce((sum, e) => sum + Number.parseFloat(e.clampedAmountUsdc ?? "0"), 0);
  return total.toFixed(6);
}

export function remainingCampaignBudget(history: HistoryEntry[], campaignTotalBudgetUsdc?: string): string | undefined {
  if (!campaignTotalBudgetUsdc) return undefined;
  const remaining = Number.parseFloat(campaignTotalBudgetUsdc) - Number.parseFloat(totalSpent(history));
  return Math.max(0, remaining).toFixed(6);
}
