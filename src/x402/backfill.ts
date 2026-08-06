// x402 settlement backfill — resolve batched Gateway transfers to on-chain hashes.
//
// Circle Gateway BATCHES x402 settlements, so at run time a paid brief (or a
// settled smart fee) only has a `transferId` and status "received" — the real
// on-chain `txHash` lands minutes later, after the run has already committed its
// history entry. The live dashboard resolves those hashes client-side, but the
// committed `data/history.json` audit trail stays stuck at "received" with no
// hash, so anyone reading the ledger directly can't see the settlement tx.
//
// This script walks history.json, resolves every still-pending x402/smartFee
// transfer via the public Gateway endpoint (GET /v1/x402/transfers/{id} —
// unauthenticated, CORS-open), and writes back `txHash`, `explorerUrl`, and the
// final `settleStatus`. It is idempotent (only touches receipts that aren't
// `completed` with a hash yet) and read-only against Circle, so it's safe to run
// on a schedule from the cron. Pass `--dry` to preview without writing.
//
//   npm run x402-backfill          # resolve + write back + report
//   npm run x402-backfill -- --dry # report only, no file write

import { writeFile } from "node:fs/promises";
import { ARC_TESTNET_EXPLORER } from "../config.js";
import { logger } from "../logger.js";
import { readHistory, HISTORY_FILE_PATH } from "../history/store.js";
import { resolveGatewayTransfer } from "./settle.js";

/** A settleable receipt shape shared by the `x402` and `smartFee` blocks. */
interface SettleReceipt {
  transferId?: string;
  settleStatus?: string;
  txHash?: string;
  explorerUrl?: string;
}

/** Needs resolving if it settled through Gateway but has no final on-chain hash. */
function isPending(r: SettleReceipt | undefined): r is SettleReceipt & { transferId: string } {
  return !!r?.transferId && (!r.txHash || r.settleStatus !== "completed");
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry");
  const history = await readHistory();

  // Collect every pending receipt across both x402 slots, tagged for logging.
  const pending: { label: string; receipt: SettleReceipt & { transferId: string } }[] = [];
  for (const entry of history) {
    const date = entry.date ?? "?";
    const x402 = (entry as { x402?: SettleReceipt }).x402;
    const smartFee = (entry as { smartFee?: SettleReceipt }).smartFee;
    if (isPending(x402)) pending.push({ label: `${date} brief`, receipt: x402 });
    if (isPending(smartFee)) pending.push({ label: `${date} smartFee`, receipt: smartFee });
  }

  if (pending.length === 0) {
    logger.info("x402 backfill: nothing pending — every settled transfer already has an on-chain hash.");
    return;
  }

  logger.info(`x402 backfill: ${pending.length} pending transfer(s) to resolve${dryRun ? " (dry run)" : ""}.`);

  let resolved = 0;
  let stillBatching = 0;
  let failed = 0;

  // Bounded concurrency — polite to the facilitator, fast enough for a few hundred.
  const POOL = 8;
  for (let i = 0; i < pending.length; i += POOL) {
    const chunk = pending.slice(i, i + POOL);
    await Promise.all(
      chunk.map(async ({ label, receipt }) => {
        // Single-shot: these transfers are old, so no need to poll — one GET is enough.
        const status = await resolveGatewayTransfer(receipt.transferId, { tries: 1 });
        if (!status) {
          failed += 1;
          logger.warn(`  ✗ ${label} (${receipt.transferId.slice(0, 8)}…): unreachable`);
          return;
        }
        receipt.settleStatus = status.status;
        if (status.txHash) {
          receipt.txHash = status.txHash;
          receipt.explorerUrl = `${ARC_TESTNET_EXPLORER}/tx/${status.txHash}`;
          resolved += 1;
          logger.info(`  ✓ ${label}: ${status.status} → ${status.txHash.slice(0, 12)}…`);
        } else {
          stillBatching += 1;
          logger.info(`  … ${label}: ${status.status} (no hash yet — still batching)`);
        }
      }),
    );
  }

  logger.info(`x402 backfill: ${resolved} newly hashed, ${stillBatching} still batching, ${failed} unreachable.`);

  if (dryRun) {
    logger.info("x402 backfill: --dry set, not writing history.json.");
    return;
  }
  if (resolved === 0) {
    logger.info("x402 backfill: no new hashes — leaving history.json unchanged.");
    return;
  }

  // Write back in the exact format history/store.ts uses (2-space, trailing newline).
  await writeFile(HISTORY_FILE_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf-8");
  logger.info(`x402 backfill: wrote ${resolved} on-chain hash(es) into ${HISTORY_FILE_PATH}.`);
}

main().catch((err) => {
  logger.error(`x402 backfill failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
