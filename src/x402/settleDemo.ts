import { settleBriefViaGateway, facilitatorUrl } from "./settle.js";
import { logger } from "../logger.js";

// Isolated "flip it live" tester for on-chain x402 settlement.
//
//   X402_PAYER_PRIVATE_KEY=0x... \
//   X402_BRIEF_URL=https://<your-deploy>/api/x402-brief \
//   X402_DEPOSIT_USDC=1 \
//   npm run x402-settle
//
// Pays ONE brief through Circle Gateway and prints the settlement tx hash. Moves
// real testnet USDC (a one-time gasful deposit if the Gateway balance is low,
// then a gasless pay). It never touches DCA money/state — it only exercises the
// settle path so you can confirm it works before enabling it in the cron.

async function main(): Promise<void> {
  const pk = process.env.X402_PAYER_PRIVATE_KEY?.trim();
  const url = process.env.X402_BRIEF_URL?.trim();
  if (!pk) {
    logger.error("Set X402_PAYER_PRIVATE_KEY (a dedicated testnet key with a Gateway deposit).");
    process.exitCode = 1;
    return;
  }
  if (!url) {
    logger.error("Set X402_BRIEF_URL to your deployed Gateway endpoint, e.g. https://<deploy>/api/x402-brief");
    process.exitCode = 1;
    return;
  }

  logger.info(`x402 settle test → ${url}`);
  logger.info(`Facilitator: ${facilitatorUrl()}`);
  const deposit = process.env.X402_DEPOSIT_USDC?.trim();
  if (deposit) logger.info(`Will top up the Gateway balance to ≥ ${deposit} USDC before paying if needed.`);

  const res = await settleBriefViaGateway({ privateKey: pk, url, depositUsdc: deposit });
  logger.info(`✅ SETTLED ${res.amountUsdcAtomic} atomic USDC via Circle Gateway`);
  logger.info(`   payer:      ${res.payer}`);
  logger.info(`   network:    ${res.network}`);
  logger.info(`   transferId: ${res.transferId} (status: ${res.status})`);
  if (res.txHash) {
    logger.info(`   tx:         ${res.txHash}`);
    logger.info(`   explorer:   ${res.explorerUrl}`);
  } else {
    logger.info(`   tx:         pending — Gateway is still batching this payment on-chain.`);
    logger.info(`   Re-check:   https://gateway-api-testnet.circle.com/v1/x402/transfers/${res.transferId}`);
    logger.info(`               (the dashboard auto-resolves the on-chain tx once the batch settles)`);
  }
}

main().catch((err) => {
  logger.error(`x402 settle test failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
