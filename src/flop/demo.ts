// Offline demo of the FLOP faucet + auto-spend cycle — no keys, no network.
//
//   npm run flop-demo
//
// It flips the gates on IN-PROCESS, injects a fake DID signer and a fake faucet
// (so nothing is signed for real and nothing is sent anywhere), and prints the
// claim result + the spend RECOMMENDATION. This demonstrates the control flow the
// real integration will follow once FLOP publishes the DID auth scheme + endpoint.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runFaucetCycle } from "./index.js";
import { checkBalance, creditToken, spendToken } from "./ledger.js";
import type { ProofChallenge } from "./types.js";

async function main() {
  process.env.FLOP_FAUCET_ENABLED = "true";
  process.env.FLOP_AUTOSPEND_ENABLED = "true";
  process.env.FLOP_AUTOSPEND_MAX_USDC = process.env.FLOP_AUTOSPEND_MAX_USDC ?? "0.10";

  const identity = {
    did: "did:key:z6MkDemoAgentIdentifierExampleOnly",
    address: "0x00Ebbd3aFCCaD08970ED8FdaE591244c8475a0aC",
  };

  // FAKE signer — a real one would produce a DID-JWT / signed challenge per the
  // (not-yet-published) FLOP scheme. This never touches a real key.
  const signProof = async (c: ProofChallenge) => `demo-proof(${c.nonce.slice(0, 10)}…)`;

  // FAKE faucet — pretends the endpoint credited 100 FLOP. No network call.
  const fetchImpl = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ amount: "100", token: "FLOP", txHash: "0xDEMOtxhash000000", explorerUrl: "https://testnet.arcscan.app/tx/0xDEMO" }),
    text: async () => "",
  })) as unknown as typeof fetch;

  const out = await runFaucetCycle("5.00", {
    identity,
    url: "https://faucet.demo.invalid/claim",
    signProof,
    fetchImpl,
  });

  console.log("— FLOP faucet cycle (offline demo) —");
  console.log("claim :", out.faucet.outcome, "·", out.faucet.reason);
  if (out.faucet.amount) console.log("        credited", out.faucet.amount, out.faucet.token, "· tx", out.faucet.txHash);
  console.log("spend :", out.plan ? `${out.plan.proceed ? "PROPOSE" : "hold"} ${out.plan.amountUsdc} USDC — ${out.plan.reason}` : "(auto-spend disabled)");

  // --- FLOP token ledger (simulation mode) — the "token manager" half ---
  // Record the faucet credit, then simulate spending FLOP for an inference call.
  // Uses a throwaway store so the demo stays offline AND side-effect free; the real
  // path writes to data/flop-ledger.json. FLOP_TESTNET_ENABLED is left unset ⇒ the
  // spend is simulated and logs the honest [SIMULATION] line below (never a chain).
  const file = path.join(mkdtempSync(path.join(tmpdir(), "flop-ledger-demo-")), "ledger.json");
  const credited = out.faucet.amount ?? "100";
  await creditToken({ amount: credited, token: out.faucet.token ?? "FLOP", memo: "faucet credit", file });
  console.log("\n— FLOP token ledger (simulation mode) —");
  console.log("mode  :", "simulation (FLOP_TESTNET_ENABLED unset) — set it to \"true\" for real testnet transfers");
  console.log("credit:", credited, out.faucet.token ?? "FLOP", "→ balance", await checkBalance(out.faucet.token ?? "FLOP", { file }));
  const spend = await spendToken({ amount: "0.001", memo: "Gemini Inference", token: out.faucet.token ?? "FLOP", file });
  console.log("spend :", spend.outcome, "· balance now", spend.balanceAfter, "· logged the [SIMULATION] line above");

  console.log("\nHonest scope: signer + faucet are FAKES here. Real claims are inert");
  console.log("until FLOP_FAUCET_ENABLED=true, a real DID signer is wired, and");
  console.log("FLOP_FAUCET_URL points at the published endpoint. The spend is only a");
  console.log("recommendation — clampDecision() remains the sole spend authority. The");
  console.log("ledger spend is simulated until FLOP_TESTNET_ENABLED=true + a real");
  console.log("submitTx signer + FLOP_RPC_URL are wired.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
