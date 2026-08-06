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
  settledTo?: string; // on-chain recipient (smartFee only — differs from ledger payTo)
}

/**
 * Needs resolving if it settled through Gateway but is missing either the final
 * on-chain hash or (for smart-fee receipts) the on-chain recipient. `wantSettledTo`
 * keeps brief receipts — whose `payTo` already matches the tx — from being reopened.
 */
function isPending(
  r: SettleReceipt | undefined,
  wantSettledTo = false,
): r is SettleReceipt & { transferId: string } {
  if (!r?.transferId) return false;
  const noHash = !r.txHash || r.settleStatus !== "completed";
  const noRecipient = wantSettledTo && !r.settledTo;
  return noHash || noRecipient;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry");
  const history = await readHistory();

  // Collect every pending receipt across both x402 slots, tagged for logging.
  // Smart-fee receipts also want `settledTo` (the on-chain recipient), which the
  // brief doesn't need since its `payTo` already equals the tx recipient.
  const pending: { label: string; isSmartFee: boolean; receipt: SettleReceipt & { transferId: string } }[] = [];
  for (const entry of history) {
    const date = entry.date ?? "?";
    const x402 = (entry as { x402?: SettleReceipt }).x402;
    const smartFee = (entry as { smartFee?: SettleReceipt }).smartFee;
    if (isPending(x402)) pending.push({ label: `${date} brief`, isSmartFee: false, receipt: x402 });
    if (isPending(smartFee, true)) pending.push({ label: `${date} smartFee`, isSmartFee: true, receipt: smartFee });
  }

  if (pending.length === 0) {
    logger.info("x402 backfill: nothing pending — every settled transfer already has an on-chain hash.");
    return;
  }

  logger.info(`x402 backfill: ${pending.length} pending transfer(s) to resolve${dryRun ? " (dry run)" : ""}.`);

  let resolved = 0;
  let recipients = 0;
  let stillBatching = 0;
  let failed = 0;

  // Bounded concurrency — polite to the facilitator, fast enough for a few hundred.
  const POOL = 8;
  for (let i = 0; i < pending.length; i += POOL) {
    const chunk = pending.slice(i, i + POOL);
    await Promise.all(
      chunk.map(async ({ label, isSmartFee, receipt }) => {
        // Single-shot: these transfers are old, so no need to poll — one GET is enough.
        const status = await resolveGatewayTransfer(receipt.transferId, { tries: 1 });
        if (!status) {
          failed += 1;
          logger.warn(`  ✗ ${label} (${receipt.transferId.slice(0, 8)}…): unreachable`);
          return;
        }
        receipt.settleStatus = status.status;
        // Record the true on-chain recipient on smart-fee receipts, whose `payTo`
        // (the ledger treasury) differs from the settlement's on-chain destination.
        if (isSmartFee && status.toAddress && receipt.settledTo !== status.toAddress) {
          receipt.settledTo = status.toAddress;
          recipients += 1;
        }
        if (status.txHash) {
          if (receipt.txHash !== status.txHash) resolved += 1;
          receipt.txHash = status.txHash;
          receipt.explorerUrl = `${ARC_TESTNET_EXPLORER}/tx/${status.txHash}`;
          logger.info(`  ✓ ${label}: ${status.status} → ${status.txHash.slice(0, 12)}…`);
        } else {
          stillBatching += 1;
          logger.info(`  … ${label}: ${status.status} (no hash yet — still batching)`);
        }
      }),
    );
  }

  logger.info(`x402 backfill: ${resolved} newly hashed, ${recipients} recipient(s) recorded, ${stillBatching} still batching, ${failed} unreachable.`);

  if (dryRun) {
    logger.info("x402 backfill: --dry set, not writing history.json.");
    return;
  }
  if (resolved === 0 && recipients === 0) {
    logger.info("x402 backfill: nothing new — leaving history.json unchanged.");
    return;
  }

  // Write back in the exact format history/store.ts uses (2-space, trailing newline).
  await writeFile(HISTORY_FILE_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf-8");
  logger.info(`x402 backfill: wrote ${resolved} hash(es) + ${recipients} recipient(s) into ${HISTORY_FILE_PATH}.`);
}

main().catch((err) => {
  logger.error(`x402 backfill failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
