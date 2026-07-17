// Sample the EURC/USDC rate on Arc Testnet over time.
//
// Diligence before any FX-rebalancer pivot: the cirBTC mistake was betting the
// thesis on something we never verified actually works. An FX agent only has a
// job if the rate MOVES — if EURC is pinned flat on testnet, there is nothing to
// rebalance against and the idea is dead on arrival. Better to learn that from
// data in an hour than from a demo in two weeks.
//
// Read-only: uses Swap Kit's token-rates service (no wallet, no funds, no swap).
//
// Usage:
//   npm run sample-fx                  # sample every 60s until Ctrl+C
//   npm run sample-fx -- --once        # single reading
//   npm run sample-fx -- --interval 300  # every 5 minutes
//
// Appends to data/fx-samples.json so you can leave it running and analyse later.

import "dotenv/config";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { SwapKit } from "@circle-fin/swap-kit";

const CHAIN = "Arc_Testnet";
const OUT = "data/fx-samples.json";

const args = process.argv.slice(2);
const once = args.includes("--once");
const iIdx = args.indexOf("--interval");
const intervalSec = iIdx >= 0 ? Number.parseInt(args[iIdx + 1] ?? "60", 10) : 60;

const kitKey = process.env.KIT_KEY?.trim();
if (!kitKey) {
  console.error("Missing KIT_KEY in .env — that's all this needs (no wallet, no funds).");
  process.exit(1);
}

const kit = new SwapKit();

async function readRate() {
  // EURC's USD price is the FX rate: USDC is ~$1, so priceUSD(EURC) ≈ EUR/USD.
  const { rates } = await kit.getTokenRates({ chain: CHAIN, tokens: ["EURC", "USDC"], kitKey });
  const chainRates = rates[CHAIN] ?? {};
  const entries = Object.entries(chainRates).map(([addr, r]) => ({
    addr,
    symbol: r.symbol ?? "?",
    priceUSD: Number.parseFloat(r.priceUSD),
    fetchedAt: r.fetchedAt,
  }));
  const eurc = entries.find((e) => /eurc/i.test(e.symbol)) ?? entries[0];
  const usdc = entries.find((e) => /usdc/i.test(e.symbol));
  if (!eurc || !(eurc.priceUSD > 0)) throw new Error("No usable EURC rate returned");
  return {
    ts: new Date().toISOString(),
    eurcUsd: eurc.priceUSD,
    usdcUsd: usdc?.priceUSD ?? null,
    // EURC per 1 USDC — the number an FX rebalancer actually trades on.
    eurcPerUsdc: usdc?.priceUSD > 0 ? usdc.priceUSD / eurc.priceUSD : null,
    fetchedAt: eurc.fetchedAt,
  };
}

async function loadSamples() {
  try { return JSON.parse(await readFile(OUT, "utf-8")); } catch { return []; }
}

const samples = await loadSamples();
console.log(`\nSampling EURC/USDC on ${CHAIN} — ${once ? "single reading" : `every ${intervalSec}s (Ctrl+C to stop)`}`);
console.log(`Existing samples in ${OUT}: ${samples.length}\n`);

function summarise() {
  const rates = samples.map((s) => s.eurcUsd).filter((n) => n > 0);
  if (rates.length < 2) return;
  const min = Math.min(...rates), max = Math.max(...rates);
  const spreadPct = ((max - min) / min) * 100;
  console.log(`\n${"─".repeat(56)}`);
  console.log(`samples : ${rates.length}`);
  console.log(`EURC/USD: min ${min.toFixed(6)}  max ${max.toFixed(6)}`);
  console.log(`movement: ${spreadPct.toFixed(3)}%`);
  console.log("─".repeat(56));
  if (spreadPct < 0.05) {
    console.log("⚠️  Rate is essentially FLAT — an FX rebalancer would have nothing");
    console.log("    to act on. Verify over a longer window before committing.");
  } else {
    console.log("✅ The rate moves — there is real signal for an FX agent to trade.");
  }
  console.log("");
}

async function tick() {
  try {
    const s = await readRate();
    samples.push(s);
    await mkdir("data", { recursive: true });
    await writeFile(OUT, JSON.stringify(samples, null, 2) + "\n");
    const per = s.eurcPerUsdc ? ` | ${s.eurcPerUsdc.toFixed(6)} EURC per USDC` : "";
    console.log(`${s.ts}  EURC=$${s.eurcUsd.toFixed(6)}${per}`);
  } catch (err) {
    console.error(`${new Date().toISOString()}  ✗ ${(err?.message ?? String(err)).slice(0, 120)}`);
  }
}

await tick();

if (once) {
  // Let the process end on its own. Calling process.exit() here trips a libuv
  // assertion on Windows when the SDK's sockets are still closing.
  summarise();
} else {
  const timer = setInterval(tick, Math.max(15, intervalSec) * 1000);
  process.on("SIGINT", () => {
    clearInterval(timer);
    summarise();
    process.exitCode = 0; // no hard exit — same libuv reason as above
  });
}
