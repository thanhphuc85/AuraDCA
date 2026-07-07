// One-off helper: prints the current USDC balance for WALLET_ID (from .env).
//
// Usage: node scripts/check-balance.mjs

import "dotenv/config";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
const walletId = process.env.WALLET_ID;

if (!apiKey || !entitySecret || !walletId) {
  console.error("Missing CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, or WALLET_ID environment variable.");
  process.exit(1);
}

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

const walletResponse = await client.getWallet({ id: walletId });
const address = walletResponse.data?.wallet?.address;

const balanceResponse = await client.getWalletTokenBalance({ id: walletId });
const balances = balanceResponse.data?.tokenBalances ?? [];

console.log(`Wallet: ${address}`);
if (balances.length === 0) {
  console.log("No token balances yet.");
} else {
  for (const b of balances) {
    console.log(`${b.token.symbol ?? b.token.name}: ${b.amount}`);
  }
}
