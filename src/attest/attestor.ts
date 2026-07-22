import { readFile } from "node:fs/promises";
import { Interface } from "ethers";
import { hashLedgerContent } from "./ledgerHash.js";
import type { Wallet } from "../wallet.js";
import { logger } from "../logger.js";

const ATTEST_ABI = ["function attest(bytes32 ledgerHash, string ref)"];

export interface AttestResult {
  attested: boolean;
  hash?: string;
  txId?: string;
  skipped?: "disabled" | "no_contract" | "no_ledger" | "tx_failed";
}

/**
 * Anchor the committed ledger state on-chain by hashing `data/ledger.json` and
 * calling `AuraAttestation.attest(hash, ref)` from the agent's Circle wallet.
 *
 * Strictly best-effort: every failure path returns a result rather than throwing,
 * so a missing contract, an RPC hiccup, or a Circle error can never break a DCA
 * run. The attestation records history; it does not gate it.
 */
export async function attestLedgerState(opts: {
  wallet: Wallet;
  contractAddress?: string;
  enabled: boolean;
  ledgerPath: string;
  ref: string;
}): Promise<AttestResult> {
  if (!opts.enabled) return { attested: false, skipped: "disabled" };
  if (!opts.contractAddress) return { attested: false, skipped: "no_contract" };

  let content: Buffer;
  try {
    content = await readFile(opts.ledgerPath);
  } catch (err) {
    logger.warn("On-chain attestation skipped: cannot read ledger", err);
    return { attested: false, skipped: "no_ledger" };
  }

  const hash = hashLedgerContent(new Uint8Array(content));
  const callData = new Interface(ATTEST_ABI).encodeFunctionData("attest", [hash, opts.ref]);

  try {
    const { txId } = await opts.wallet.executeContract({ contractAddress: opts.contractAddress, callData });
    logger.info(`On-chain attestation sent: hash=${hash} ref=${opts.ref} tx=${txId ?? "?"}`);
    return { attested: true, hash, txId };
  } catch (err) {
    logger.warn("On-chain attestation failed (non-fatal)", err);
    return { attested: false, hash, skipped: "tx_failed" };
  }
}
