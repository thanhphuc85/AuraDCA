import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Ledger, UserAccount } from "../types.js";
import { DEFAULT_DCA_HORIZON_DAYS } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LEDGER_FILE_PATH = path.resolve(__dirname, "../../data/ledger.json");

function emptyLedger(): Ledger {
  return { version: 1, lastScannedBlock: 0, users: {}, deposits: [], distributions: [], withdrawals: [] };
}

export function normalizeAddress(addr: string): string {
  return addr.toLowerCase();
}

export async function readLedger(): Promise<Ledger> {
  try {
    const raw = await readFile(LEDGER_FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.version === 1 ? (parsed as Ledger) : emptyLedger();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyLedger();
    throw err;
  }
}

export async function writeLedger(ledger: Ledger): Promise<void> {
  await writeFile(LEDGER_FILE_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
}

function emptyUser(address: string, now: string): UserAccount {
  return {
    address,
    usdcBalance: "0",
    cirBtcBalance: "0",
    totalDeposited: "0",
    totalSwapped: "0",
    totalWithdrawnCirBtc: "0",
    totalWithdrawnUsdc: "0",
    firstSeen: now,
    lastActivity: now,
    dcaRatePerDay: "0",
    dcaRateIsCustom: false,
    dcaPaused: false,
  };
}

export function getOrCreateUser(ledger: Ledger, address: string, now?: string): UserAccount {
  const key = normalizeAddress(address);
  if (!ledger.users[key]) {
    ledger.users[key] = emptyUser(key, now ?? new Date().toISOString());
  }
  return ledger.users[key];
}

/**
 * Recompute a user's auto DCA rate = current USDC balance / horizon, UNLESS the
 * user has set a custom rate. Call after a deposit changes their balance.
 */
export function refreshAutoDcaRate(user: UserAccount, horizonDays = DEFAULT_DCA_HORIZON_DAYS): void {
  if (user.dcaRateIsCustom) return;
  const balance = Number.parseFloat(user.usdcBalance || "0");
  const rate = horizonDays > 0 ? balance / horizonDays : 0;
  user.dcaRatePerDay = rate.toFixed(6);
}

/**
 * Back-fill a default rate for users whose rate was never set — i.e. accounts
 * that existed before per-user DCA shipped (dcaRatePerDay === undefined). Runs
 * once per such user; leaves custom and already-initialized rates untouched.
 */
export function ensureDefaultRates(ledger: Ledger, horizonDays = DEFAULT_DCA_HORIZON_DAYS): number {
  let filled = 0;
  for (const user of Object.values(ledger.users)) {
    if (user.dcaRatePerDay === undefined && !user.dcaRateIsCustom) {
      refreshAutoDcaRate(user, horizonDays);
      if (user.dcaPaused === undefined) user.dcaPaused = false;
      filled++;
    }
  }
  return filled;
}
