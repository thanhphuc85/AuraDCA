import { withRetry } from "../retry.js";
import { USDC_DECIMALS } from "./constants.js";

/**
 * Non-custodial (allowance) model helpers — Cách B / Grok style.
 *
 * Instead of depositing USDC into a pooled treasury, a user keeps their USDC in
 * their own wallet and grants the agent an ERC-20 allowance (approve). Each run
 * the agent pulls only the scheduled amount via transferFrom. The user can
 * revoke anytime (approve 0). This module holds the READ-ONLY on-chain lookups;
 * the pull (transferFrom) uses Circle's contract execution and lives in the
 * execution layer.
 */

const ALLOWANCE_SELECTOR = "0xdd62ed3e"; // allowance(address owner, address spender)
const BALANCE_SELECTOR = "0x70a08231"; // balanceOf(address)

function pad(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function ethCall(rpcUrl: string, to: string, data: string): Promise<bigint> {
  const result = await withRetry(
    async () => {
      const r = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      });
      if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
      const json = (await r.json()) as { error?: { message: string }; result: string };
      if (json.error) throw new Error(`RPC error: ${json.error.message}`);
      return json.result;
    },
    { maxRetries: 2, label: "eth_call" },
  );
  return BigInt(result || "0x0");
}

export interface OnChainUserState {
  allowanceUsdc: number; // how much the agent may pull
  balanceUsdc: number; // the user's own wallet USDC balance
  spendableUsdc: number; // min(allowance, balance) — the real ceiling per run
}

/**
 * Read a user's USDC allowance to the agent + their wallet balance. The agent can
 * only ever pull min(allowance, balance).
 */
export async function readUserOnChainState(
  rpcUrl: string,
  usdcContract: string,
  user: string,
  agentSpender: string,
): Promise<OnChainUserState> {
  const allowanceData = ALLOWANCE_SELECTOR + pad(user) + pad(agentSpender);
  const balanceData = BALANCE_SELECTOR + pad(user);

  const [allowanceRaw, balanceRaw] = await Promise.all([
    ethCall(rpcUrl, usdcContract, allowanceData),
    ethCall(rpcUrl, usdcContract, balanceData),
  ]);

  const allowanceUsdc = Number(allowanceRaw) / 10 ** USDC_DECIMALS;
  const balanceUsdc = Number(balanceRaw) / 10 ** USDC_DECIMALS;
  return {
    allowanceUsdc,
    balanceUsdc,
    spendableUsdc: Math.min(allowanceUsdc, balanceUsdc),
  };
}
