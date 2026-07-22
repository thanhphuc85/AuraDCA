import { readFile } from "node:fs/promises";
import { JsonRpcProvider, Contract } from "ethers";
import { ARC_TESTNET_RPC } from "./ledger/constants.js";
import { hashLedgerContent } from "./attest/ledgerHash.js";
import { logger } from "./logger.js";

/**
 * Read-only proof of the on-chain audit anchor: no wallet, no gas. Reads the
 * AuraAttestation contract state over RPC and recomputes the hash of the local
 * `data/ledger.json`, so anyone can independently confirm the on-chain anchor
 * matches the committed ledger.
 */
const ABI = [
  "function writer() view returns (address)",
  "function count() view returns (uint256)",
  "function latestHash() view returns (bytes32)",
  "function latestTimestamp() view returns (uint256)",
];

async function main(): Promise<void> {
  const address = process.env.ATTESTATION_CONTRACT?.trim();
  if (!address) {
    logger.error("Set ATTESTATION_CONTRACT to the deployed AuraAttestation address.");
    process.exitCode = 1;
    return;
  }
  const provider = new JsonRpcProvider(ARC_TESTNET_RPC);
  const c = new Contract(address, ABI, provider);
  const [writer, count, latestHash, latestTs] = await Promise.all([
    c.getFunction("writer").staticCall(),
    c.getFunction("count").staticCall(),
    c.getFunction("latestHash").staticCall(),
    c.getFunction("latestTimestamp").staticCall(),
  ]) as [string, bigint, string, bigint];
  const local = hashLedgerContent(await readFile("data/ledger.json"));
  const match = local.toLowerCase() === String(latestHash).toLowerCase();

  logger.info(`contract         = ${address}`);
  logger.info(`writer (agent)   = ${writer}`);
  logger.info(`attestations     = ${count}`);
  logger.info(`on-chain hash    = ${latestHash}`);
  logger.info(`local ledger hash= ${local}`);
  logger.info(`latestTimestamp  = ${latestTs} (${latestTs > 0n ? new Date(Number(latestTs) * 1000).toISOString() : "never"})`);
  logger.info(
    match
      ? "MATCH — current data/ledger.json matches the on-chain anchor."
      : "No match — data/ledger.json changed since the last attestation (expected between runs; check out the run's commit to reproduce).",
  );
}

main().catch((err) => {
  logger.error("verify-attest failed", err);
  process.exitCode = 1;
});
