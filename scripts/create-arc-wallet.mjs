// One-off setup helper: creates the Circle Developer-Controlled Wallet on Arc
// Testnet that the daily bot (src/) signs with, and prints its id + address.
// Put the printed WALLET_ID in your .env / GitHub secrets, and fund the
// printed address from faucet.circle.com before running the bot.
//
// Usage (reads from .env, or pass inline):
//   npm run create-wallet                    # Arc Testnet wallet (default)
//   npm run create-wallet -- --mainnet       # Arc MAINNET wallet (blockchain "ARC")
//   CIRCLE_API_KEY=... CIRCLE_ENTITY_SECRET=... node scripts/create-arc-wallet.mjs
//
// The network is Arc Testnet unless --mainnet is passed (or ARC_CIRCLE_BLOCKCHAIN=ARC
// is set). Creating a wallet moves no funds — it only provisions the address.
// MAINNET note: use your Circle PRODUCTION api key + entity secret (not sandbox).
//
// CIRCLE_API_KEY: from https://console.circle.com/api-keys
// CIRCLE_ENTITY_SECRET: the hex secret you generated + registered in the
//   Circle Console when you set up Developer-Controlled Wallets. If you
//   haven't generated one yet, run:
//     node -e "console.log(require('@circle-fin/developer-controlled-wallets').generateEntitySecret())"
//   then register it via the Circle Console UI (or registerEntitySecretCiphertext)
//   before running this script.

import "dotenv/config";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

if (!apiKey || !entitySecret) {
  console.error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET environment variable.");
  process.exit(1);
}

// Network: --mainnet (or ARC_CIRCLE_BLOCKCHAIN=ARC) selects Arc mainnet; else testnet.
// "ARC" / "ARC-TESTNET" are Circle Developer-Controlled-Wallet blockchain ids.
const blockchain = process.argv.slice(2).includes("--mainnet")
  ? "ARC"
  : (process.env.ARC_CIRCLE_BLOCKCHAIN || "ARC-TESTNET").trim();
const isMainnet = blockchain === "ARC";

console.log(`Creating a Circle DCW wallet on: ${blockchain}${isMainnet ? "  ⚠️  MAINNET (real funds)" : ""}`);

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

const walletSetResponse = await client.createWalletSet({
  name: `auradca-${isMainnet ? "mainnet" : "testnet"}-${new Date().toISOString().slice(0, 10)}`,
});
const walletSetId = walletSetResponse.data?.walletSet?.id;
if (!walletSetId) {
  throw new Error("Failed to create wallet set: no id returned");
}

const walletsResponse = await client.createWallets({
  blockchains: [blockchain],
  count: 1,
  walletSetId,
});

const wallet = walletsResponse.data?.wallets?.[0];
if (!wallet) {
  throw new Error("Failed to create wallet: no wallet returned");
}

console.log(`Network:       ${blockchain}${isMainnet ? " (MAINNET)" : " (Testnet)"}`);
console.log(`Wallet Set ID: ${walletSetId}`);
console.log(`Wallet ID:     ${wallet.id}`);
console.log(`Wallet Address: ${wallet.address}`);
console.log(`\nPut this in .env:  WALLET_ID=${wallet.id}`);
if (isMainnet) {
  console.log(`\n⚠️  MAINNET wallet — no faucet. Fund ${wallet.address} with REAL USDC`);
  console.log(`   (bridge/CCTP from another chain, or via your Circle point of contact).`);
  console.log(`   Then prove one tx:  npm run prove-swap -- --mainnet`);
} else {
  console.log(`\nGo to https://faucet.circle.com, select Arc Testnet, and fund ${wallet.address}`);
}
