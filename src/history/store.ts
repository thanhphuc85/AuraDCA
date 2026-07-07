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

export function dayCount(history: HistoryEntry[]): number {
  return history.length + 1;
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
