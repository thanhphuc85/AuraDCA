import type { Ledger, UserAccount, WithdrawalRequest, WithdrawalToken } from "../types.js";
import type { Wallet } from "../wallet.js";
import { normalizeAddress } from "./store.js";
import { USDC_DECIMALS, dcaTokenInfo, tokenContract } from "./constants.js";
import { logger } from "../logger.js";

// USDC is the deposited input (usdcBalance); every DCA target (cirBTC, EURC, …)
// lives in tokenBalances[symbol], with cirBtcBalance kept as the legacy mirror
// for cirBTC so older ledgers and the dashboard keep working unchanged.
function tokenDecimals(token: WithdrawalToken): number {
  return token === "USDC" ? USDC_DECIMALS : dcaTokenInfo(token).decimals;
}

function readBalance(user: UserAccount, token: WithdrawalToken): number {
  if (token === "USDC") return parseFloat(user.usdcBalance ?? "0");
  if (token === "cirBTC") return parseFloat(user.tokenBalances?.cirBTC ?? user.cirBtcBalance ?? "0");
  return parseFloat(user.tokenBalances?.[token] ?? "0");
}

function writeBalance(user: UserAccount, token: WithdrawalToken, value: string): void {
  if (token === "USDC") { user.usdcBalance = value; return; }
  (user.tokenBalances ??= {})[token] = value;
  if (token === "cirBTC") user.cirBtcBalance = value; // keep legacy mirror in sync
}

function creditWithdrawn(user: UserAccount, token: WithdrawalToken, amount: number, decimals: number): void {
  (user.totalWithdrawn ??= {});
  user.totalWithdrawn[token] = (parseFloat(user.totalWithdrawn[token] ?? "0") + amount).toFixed(decimals);
  // Legacy per-token mirrors so older readers / the dashboard keep working.
  if (token === "USDC") user.totalWithdrawnUsdc = (parseFloat(user.totalWithdrawnUsdc ?? "0") + amount).toFixed(USDC_DECIMALS);
  if (token === "cirBTC") user.totalWithdrawnCirBtc = (parseFloat(user.totalWithdrawnCirBtc ?? "0") + amount).toFixed(decimals);
}

export function requestWithdrawal(
  ledger: Ledger,
  address: string,
  token: WithdrawalToken,
  amount: string,
): WithdrawalRequest {
  const key = normalizeAddress(address);
  const user = ledger.users[key];
  if (!user) throw new Error(`No account found for ${address}`);

  const requested = parseFloat(amount);
  if (requested <= 0) throw new Error("Withdrawal amount must be positive");

  const decimals = tokenDecimals(token);
  const available = readBalance(user, token);
  if (requested > available) {
    throw new Error(`Insufficient ${token} balance: requested ${amount}, available ${available}`);
  }

  // Deduct immediately to prevent double-spend.
  writeBalance(user, token, (available - requested).toFixed(decimals));
  user.lastActivity = new Date().toISOString();

  const request: WithdrawalRequest = {
    id: `wd-${Date.now()}-${key.slice(-6)}`,
    address: key,
    token,
    amount,
    status: "pending",
    requestedAt: new Date().toISOString(),
  };
  ledger.withdrawals.push(request);

  logger.info(`Withdrawal request created: ${amount} ${token} for ${key}`);
  return request;
}

export async function processPendingWithdrawals(
  ledger: Ledger,
  wallet: Wallet,
): Promise<number> {
  const pending = ledger.withdrawals.filter((w) => w.status === "pending");
  if (pending.length === 0) return 0;

  let processed = 0;
  for (const req of pending) {
    req.status = "processing";
    try {
      const result = await wallet.sendTokens({
        tokenAddress: tokenContract(req.token),
        destinationAddress: req.address,
        amount: req.amount,
      });
      req.status = "completed";
      req.processedAt = new Date().toISOString();
      req.txHash = result.txHash;
      processed++;

      const user = ledger.users[req.address];
      if (user) creditWithdrawn(user, req.token, parseFloat(req.amount), tokenDecimals(req.token));

      logger.info(`Withdrawal ${req.id} completed: ${req.amount} ${req.token} → ${req.address}`);
    } catch (err) {
      req.status = "failed";
      req.processedAt = new Date().toISOString();
      req.error = err instanceof Error ? err.message : String(err);
      logger.error(`Withdrawal ${req.id} failed`, err);
    }
  }

  return processed;
}
