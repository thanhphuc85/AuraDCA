// Probe which USDC → X swap routes actually have liquidity on Arc Testnet.
//
// The cirBTC route has been returning "No route available" for weeks. Swap Kit's
// estimate() quotes a swap WITHOUT executing it, so this asks the router which
// pairs are live — cheaply, with no funds at risk. If another token quotes fine,
// the agent can DCA into that instead by setting TOKEN_OUT (no code change).
//
// Usage:  npm run check-routes            (probes with 0.10 USDC)
//         npm run check-routes -- 1.5     (probe a different size)

import "dotenv/config";
import { SwapKit } from "@circle-fin/swap-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY?.trim();
const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();
const walletId = (process.env.CIRCLE_WALLET_ID || process.env.WALLET_ID)?.trim();
const kitKey = process.env.KIT_KEY?.trim();

const missing = [
  ["CIRCLE_API_KEY", apiKey],
  ["CIRCLE_ENTITY_SECRET", entitySecret],
  ["WALLET_ID / CIRCLE_WALLET_ID", walletId],
  ["KIT_KEY", kitKey],
].filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Missing env: ${missing.join(", ")}. Fill them in .env first.`);
  process.exit(1);
}

const amountIn = process.argv[2] ?? "0.10";
// Swap Kit advertises stablecoins (USDC/USDT/EURC/DAI/PYUSD/USDe), wrapped
// assets (WBTC/WETH/…) and chain natives. Not all exist on Arc Testnet — that's
// exactly what we're probing.
const CANDIDATES = ["cirBTC", "EURC", "USDT", "WBTC", "WETH", "DAI"];

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
const walletRes = await client.getWallet({ id: walletId });
const address = walletRes.data?.wallet?.address;
if (!address) {
  console.error("Could not resolve the agent wallet address from CIRCLE_WALLET_ID.");
  process.exit(1);
}

const adapter = createCircleWalletsAdapter({ apiKey, entitySecret });
const kit = new SwapKit();

console.log(`\nProbing USDC → X routes on Arc_Testnet`);
console.log(`wallet: ${address}`);
console.log(`amountIn: ${amountIn} USDC\n`);

const live = [];
for (const tokenOut of CANDIDATES) {
  try {
    const quote = await kit.estimate({
      from: { adapter, chain: "Arc_Testnet", address },
      tokenIn: "USDC",
      tokenOut,
      amountIn,
      config: { kitKey },
    });
    const out = quote?.estimatedOutput;
    console.log(`✅ USDC → ${tokenOut.padEnd(7)} quote OK` + (out ? `  ≈ ${out.amount} ${out.token}` : ""));
    live.push(tokenOut);
  } catch (err) {
    const msg = (err?.message ?? String(err)).replace(/\s+/g, " ").slice(0, 110);
    console.log(`❌ USDC → ${tokenOut.padEnd(7)} ${msg}`);
  }
}

console.log("");
if (!live.length) {
  console.log("No route quoted for any candidate — the outage isn't cirBTC-specific.");
} else if (live.includes("cirBTC")) {
  console.log("cirBTC is quoting again — the outage looks over; no config change needed.");
} else {
  console.log(`Live route(s): ${live.join(", ")}`);
  console.log(`cirBTC is still down. To DCA into a live asset instead, set TOKEN_OUT=${live[0]}`);
  console.log(`  • GitHub → Settings → Secrets and variables → Actions → Variables → TOKEN_OUT`);
  console.log(`  • (local) add TOKEN_OUT=${live[0]} to .env`);
}
console.log("");
