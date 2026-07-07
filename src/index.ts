import { loadConfig, ConfigError } from "./config.js";
import { runDailyDca } from "./run.js";
import { appendEntry } from "./history/store.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logger.error("Configuration error", err);
    if (err instanceof ConfigError) {
      await appendEntry({
        date: new Date().toISOString().slice(0, 10),
        timestamp: new Date().toISOString(),
        status: "error_config",
        tokenOut: process.env.TOKEN_OUT ?? "cirBTC",
        message: err.message,
      }).catch(() => undefined);
    }
    process.exitCode = 1;
    return;
  }

  logger.info(`Starting daily DCA run (dryRun=${config.dryRun}, tokenOut=${config.tokenOut})`);

  const outcome = await runDailyDca(config);
  logger.info(`Run finished with status: ${outcome.entry.status}`, outcome.entry.message);

  if (outcome.isFatal) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  logger.error("Unexpected top-level error", err);
  await appendEntry({
    date: new Date().toISOString().slice(0, 10),
    timestamp: new Date().toISOString(),
    status: "error_unexpected",
    tokenOut: process.env.TOKEN_OUT ?? "cirBTC",
    message: err instanceof Error ? err.message : String(err),
  }).catch(() => undefined);
  process.exitCode = 1;
});
