// Mock FLOP token ledger — the "token manager" half of the FLOP scaffold. Holds a
// per-token balance, records credits (faucet top-ups) and spends (e.g. paying FLOP
// for an inference call), and persists to a JSON store exactly like the seq store.
//
// Same ethos as the faucet + poster: additive, gated, honest, never throws.
//   - A single mode switch, FLOP_TESTNET_ENABLED, picks the behavior:
//       simulation (default) — debit a MOCK balance and log
//                              `[SIMULATION] Spent 0.001 MOCK_FLOP for <memo>`;
//                              nothing touches a chain.
//       testnet              — submit a REAL transfer, but only through an injected
//                              `submitTx` seam + an explicit FLOP_RPC_URL. Absent
//                              either, an enabled spend returns skipped_unconfigured
//                              and sends nothing — it never fabricates a tx hash.
//   - When FLOP opens the testnet faucet you flip ONE flag (FLOP_TESTNET_ENABLED)
//     and wire `submitTx` against the real RPC; the core accounting logic here is
//     unchanged. That is the whole point of keeping the seam injected.
//
// Decimal math goes through viem's parseUnits/formatUnits (already a dependency) so
// token balances are exact integers under the hood — no float drift on 0.001-sized
// spends.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatUnits, parseUnits } from "viem";
import { logger } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Default on-disk store for the agent's mock/testnet FLOP balances + history. */
export const DEFAULT_LEDGER_STORE = path.resolve(__dirname, "../../data/flop-ledger.json");

/** The token symbol spent/credited by default. */
export const DEFAULT_TOKEN = "FLOP";

/** Internal fixed-point scale for exact decimal arithmetic (18 dp, well past FLOP). */
const SCALE = 18;

// --- mode + config (all lazy from env; the master flag defaults to SIMULATION) ---

export type LedgerMode = "simulation" | "testnet";

/** True only when FLOP_TESTNET_ENABLED is exactly "true" — otherwise simulation. */
export function isTestnetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.FLOP_TESTNET_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** The active ledger mode: "testnet" iff the flag is on, else "simulation". */
export function ledgerMode(env: NodeJS.ProcessEnv = process.env): LedgerMode {
  return isTestnetEnabled(env) ? "testnet" : "simulation";
}

/** Explicit testnet RPC URL. Unset ⇒ an enabled testnet spend is unconfigured. */
export function flopRpcUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.FLOP_RPC_URL?.trim() || undefined;
}

/** Path of the ledger store; override via env for tests or alternate locations. */
export function ledgerStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.FLOP_LEDGER_STORE?.trim() || DEFAULT_LEDGER_STORE;
}

// --- pure decimal helpers (exact, via viem fixed-point) ---------------------------

/** True for a non-negative decimal string like "0", "100", "0.001" (no sign/exp). */
export function isDecimal(s: string): boolean {
  return /^\d+(\.\d+)?$/.test(s.trim());
}

/** True for a strictly-positive decimal string (a spend/credit must move value). */
export function isPositiveDecimal(s: string): boolean {
  return isDecimal(s) && parseUnits(s.trim() as `${number}`, SCALE) > 0n;
}

/** Exact a + b for two non-negative decimal strings. */
export function addDecimal(a: string, b: string): string {
  return formatUnits(parseUnits(a as `${number}`, SCALE) + parseUnits(b as `${number}`, SCALE), SCALE);
}

/** Exact a - b (never below zero) for two non-negative decimal strings. */
export function subDecimal(a: string, b: string): string {
  const diff = parseUnits(a as `${number}`, SCALE) - parseUnits(b as `${number}`, SCALE);
  return formatUnits(diff < 0n ? 0n : diff, SCALE);
}

/** -1 / 0 / 1 comparing two non-negative decimal strings. */
export function cmpDecimal(a: string, b: string): -1 | 0 | 1 {
  const x = parseUnits(a as `${number}`, SCALE);
  const y = parseUnits(b as `${number}`, SCALE);
  return x < y ? -1 : x > y ? 1 : 0;
}

// --- persisted state --------------------------------------------------------------

export interface LedgerEntry {
  kind: "credit" | "spend";
  token: string;
  /** Decimal string amount moved. */
  amount: string;
  memo: string;
  mode: LedgerMode;
  /** Decimal string balance for `token` AFTER this entry was applied. */
  balanceAfter: string;
  /** ISO timestamp. */
  ts: string;
  /** Present only for an on-chain testnet spend. */
  txHash?: string;
}

export interface LedgerState {
  /** token symbol → decimal-string balance. */
  balances: Record<string, string>;
  entries: LedgerEntry[];
}

function emptyState(): LedgerState {
  return { balances: {}, entries: [] };
}

async function readLedgerFile(file: string): Promise<LedgerState> {
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw err;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as LedgerState).balances !== "object" ||
    !Array.isArray((parsed as LedgerState).entries)
  ) {
    throw new Error(`Refusing to load an unrecognized ledger store at ${file} (expected { balances, entries })`);
  }
  return parsed as LedgerState;
}

async function writeLedgerFile(file: string, state: LedgerState): Promise<void> {
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

/** Load the whole ledger state (empty when the store does not exist yet). */
export async function loadLedger(opts: { env?: NodeJS.ProcessEnv; file?: string } = {}): Promise<LedgerState> {
  return readLedgerFile(opts.file ?? ledgerStorePath(opts.env ?? process.env));
}

/** Current balance of `token` (default FLOP) as a decimal string ("0" if none). */
export async function checkBalance(
  token: string = DEFAULT_TOKEN,
  opts: { env?: NodeJS.ProcessEnv; file?: string } = {},
): Promise<string> {
  const state = await loadLedger(opts);
  return state.balances[token] ?? "0";
}

// --- credit (faucet top-up) -------------------------------------------------------

export interface CreditTokenOpts {
  amount: string;
  memo?: string;
  token?: string;
  env?: NodeJS.ProcessEnv;
  file?: string;
  now?: () => number;
}

export interface CreditResult {
  ok: boolean;
  reason: string;
  token: string;
  amount: string;
  mode: LedgerMode;
  balanceAfter?: string;
}

/**
 * Credit `amount` of a token into the ledger (used to record a faucet top-up).
 * Pure accounting — no network in either mode. Rejects a non-positive amount
 * without throwing. Idempotency is the caller's job (credit once per claim).
 */
export async function creditToken(opts: CreditTokenOpts): Promise<CreditResult> {
  const env = opts.env ?? process.env;
  const token = opts.token?.trim() || DEFAULT_TOKEN;
  const mode = ledgerMode(env);
  const amount = opts.amount?.trim();
  if (!amount || !isPositiveDecimal(amount)) {
    return { ok: false, reason: `credit amount must be a positive decimal (got ${opts.amount ?? "undefined"})`, token, amount: "0", mode };
  }

  const file = opts.file ?? ledgerStorePath(env);
  const state = await readLedgerFile(file);
  const balanceAfter = addDecimal(state.balances[token] ?? "0", amount);
  state.balances[token] = balanceAfter;
  state.entries.push({
    kind: "credit",
    token,
    amount,
    memo: opts.memo?.trim() || "faucet credit",
    mode,
    balanceAfter,
    ts: new Date((opts.now ?? Date.now)()).toISOString(),
  });
  await writeLedgerFile(file, state);
  return { ok: true, reason: "credited", token, amount, mode, balanceAfter };
}

// --- spend (the gated action) -----------------------------------------------------

export type SpendOutcome =
  | "spent_simulated" // simulation mode: mock balance debited + [SIMULATION] logged
  | "spent_onchain" // testnet mode: real transfer submitted via injected submitTx
  | "skipped_insufficient" // balance < amount (or a non-positive/invalid amount)
  | "skipped_unconfigured" // testnet mode, but FLOP_RPC_URL / submitTx not wired
  | "error_submit"; // testnet mode: submitTx threw

export interface SpendResult {
  outcome: SpendOutcome;
  reason: string;
  token: string;
  amount: string;
  memo: string;
  mode: LedgerMode;
  /** Present on a successful spend. */
  balanceAfter?: string;
  /** Present only on a successful on-chain testnet spend. */
  txHash?: string;
}

/** Submits a real testnet transfer. Spec/chain-dependent — injected, never guessed. */
export type SubmitTx = (tx: { token: string; amount: string; memo: string; rpcUrl: string }) => Promise<{ txHash: string }>;

export interface SpendTokenOpts {
  amount: string;
  memo: string;
  token?: string;
  env?: NodeJS.ProcessEnv;
  file?: string;
  /** Testnet seam: submits the real transfer. Absent ⇒ testnet spend is unconfigured. */
  submitTx?: SubmitTx;
  /** Overrides FLOP_RPC_URL for the testnet path (tests). */
  rpcUrl?: string;
  now?: () => number;
  /** Log sink (defaults to logger.info) — injected so tests can capture the line. */
  log?: (msg: string) => void;
}

/**
 * Spend `amount` of a token with a `memo`. Flow (each a recorded, non-throwing result):
 *   1. insufficient — amount is non-positive/invalid, or exceeds the balance;
 *   2. simulation   — debit the MOCK balance, append the entry, and log
 *                     `[SIMULATION] Spent <amount> MOCK_<TOKEN> for <memo>`;
 *   3. testnet      — require FLOP_RPC_URL + an injected submitTx (else unconfigured),
 *                     submit the real transfer, then debit the tracked balance.
 * Never throws: a submit failure becomes `error_submit`, exactly like the faucet path.
 */
export async function spendToken(opts: SpendTokenOpts): Promise<SpendResult> {
  const env = opts.env ?? process.env;
  const token = opts.token?.trim() || DEFAULT_TOKEN;
  const memo = opts.memo?.trim() || "spend";
  const mode = ledgerMode(env);
  const amount = opts.amount?.trim() ?? "";
  const base = { token, amount: isDecimal(amount) ? amount : "0", memo, mode } as const;

  if (!amount || !isPositiveDecimal(amount)) {
    return { ...base, outcome: "skipped_insufficient", reason: `spend amount must be a positive decimal (got ${opts.amount ?? "undefined"})` };
  }

  const file = opts.file ?? ledgerStorePath(env);
  const state = await readLedgerFile(file);
  const balance = state.balances[token] ?? "0";
  if (cmpDecimal(balance, amount) < 0) {
    return { ...base, outcome: "skipped_insufficient", reason: `insufficient ${token}: balance ${balance} < ${amount}` };
  }

  const log = opts.log ?? ((m: string) => logger.info(m));

  // --- testnet mode: real transfer through the injected seam only ---
  if (mode === "testnet") {
    const rpcUrl = opts.rpcUrl ?? flopRpcUrl(env);
    if (!rpcUrl || !opts.submitTx) {
      return {
        ...base,
        outcome: "skipped_unconfigured",
        reason: !rpcUrl
          ? "FLOP_TESTNET_ENABLED=true but FLOP_RPC_URL is unset — refusing to submit to a guessed RPC"
          : "FLOP_TESTNET_ENABLED=true but no submitTx signer is wired — refusing to fabricate a tx",
      };
    }
    let txHash: string;
    try {
      ({ txHash } = await opts.submitTx({ token, amount, memo, rpcUrl }));
    } catch (err) {
      return { ...base, outcome: "error_submit", reason: `testnet transfer failed: ${(err as Error).message}` };
    }
    const balanceAfter = subDecimal(balance, amount);
    state.balances[token] = balanceAfter;
    state.entries.push({ kind: "spend", token, amount, memo, mode, balanceAfter, ts: new Date((opts.now ?? Date.now)()).toISOString(), txHash });
    await writeLedgerFile(file, state);
    log(`FLOP ledger: spent ${amount} ${token} for ${memo} (tx ${txHash.slice(0, 12)}…)`);
    return { ...base, outcome: "spent_onchain", reason: "on-chain transfer submitted", balanceAfter, txHash };
  }

  // --- simulation mode (default): mock debit + the honest [SIMULATION] log line ---
  const balanceAfter = subDecimal(balance, amount);
  state.balances[token] = balanceAfter;
  state.entries.push({ kind: "spend", token, amount, memo, mode, balanceAfter, ts: new Date((opts.now ?? Date.now)()).toISOString() });
  await writeLedgerFile(file, state);
  log(`[SIMULATION] Spent ${amount} MOCK_${token} for ${memo}`);
  return { ...base, outcome: "spent_simulated", reason: "simulated spend (no chain touched)", balanceAfter };
}
