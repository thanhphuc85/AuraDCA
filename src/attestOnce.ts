import { loadConfig } from "./config.js";
import { createWallet } from "./wallet.js";
import { attestLedgerState } from "./attest/attestor.js";
import { logger } from "./logger.js";

/**
 * Record one on-chain attestation of the current `data/ledger.json`, on demand.
 * Use it to produce a first proof tx right after deploying AuraAttestation,
 * without waiting for a full DCA run. Forces the attestation on regardless of
 * ATTESTATION_ENABLED, but still requires ATTESTATION_CONTRACT to be set.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.attestationContract) {
    logger.error("Set ATTESTATION_CONTRACT to the deployed AuraAttestation address first.");
    process.exitCode = 1;
    return;
  }
  const wallet = await createWallet(config.circleApiKey, config.circleEntitySecret, config.walletId);
  const res = await attestLedgerState({
    wallet,
    contractAddress: config.attestationContract,
    enabled: true,
    ledgerPath: "data/ledger.json",
    ref: new Date().toISOString(),
  });
  logger.info("Attestation result", res);
  if (!res.attested) process.exitCode = 1;
}

main().catch((err) => {
  logger.error("attest-once failed", err);
  process.exitCode = 1;
});
