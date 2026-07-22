import { loadConfig, ConfigError } from "./config.js";
import { runDailyDca } from "./run.js";
import { appendEntry } from "./history/store.js";
import { createWallet } from "./wallet.js";
import { attestLedgerState } from "./attest/attestor.js";
import { logger } from "./logger.js";
import { notifyAll } from "./notify.js";

const LEDGER_PATH = "data/ledger.json";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logger.error("Configuration error", err);
    if (err instanceof ConfigError) {
      const entry = {
        date: new Date().toISOString().slice(0, 10),
        timestamp: new Date().toISOString(),
        status: "error_config" as const,
        tokenOut: process.env.TOKEN_OUT ?? "cirBTC",
        message: err.message,
      };
      await appendEntry(entry).catch((writeErr) => logger.error("Failed to write history entry", writeErr));
      await notifyAll(entry).catch(() => {});
    }
    process.exitCode = 1;
    return;
  }

  logger.info(`Starting daily DCA run (dryRun=${config.dryRun}, tokenOut=${config.tokenOut})`);

  const outcome = await runDailyDca(config);
  logger.info(`Run finished with status: ${outcome.entry.status}`, outcome.entry.message);

  // On-chain audit anchor: hash the ledger we just committed and record it in the
  // AuraAttestation contract. Best-effort and gated — inert unless a contract is
  // configured and ATTESTATION_ENABLED=true — so it can never affect the run's
  // outcome or exit code.
  if (config.attestationEnabled && config.attestationContract) {
    try {
      const wallet = await createWallet(config.circleApiKey, config.circleEntitySecret, config.walletId);
      const res = await attestLedgerState({
        wallet,
        contractAddress: config.attestationContract,
        enabled: true,
        ledgerPath: LEDGER_PATH,
        ref: outcome.entry.timestamp,
      });
      if (!res.attested) logger.warn(`On-chain attestation not recorded: ${res.skipped ?? "unknown"}`);
    } catch (err) {
      logger.error("On-chain attestation step failed (non-fatal)", err);
    }
  }

  if (outcome.isFatal) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  logger.error("Unexpected top-level error", err);
  const entry = {
    date: new Date().toISOString().slice(0, 10),
    timestamp: new Date().toISOString(),
    status: "error_unexpected" as const,
    tokenOut: process.env.TOKEN_OUT ?? "cirBTC",
    message: err instanceof Error ? err.message : String(err),
  };
  await appendEntry(entry).catch((writeErr) => logger.error("Failed to write history entry", writeErr));
  await notifyAll(entry).catch(() => {});
  process.exitCode = 1;
});
