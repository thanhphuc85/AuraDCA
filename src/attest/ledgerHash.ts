import { keccak256, toUtf8Bytes } from "ethers";

/**
 * keccak256 (0x-prefixed) over the exact bytes of the committed ledger.
 *
 * We hash the *raw file content* rather than a re-serialized object on purpose:
 * it makes third-party verification a one-liner — `keccak256(data/ledger.json)`
 * at the run's git commit must equal the on-chain `latestHash`. No canonical
 * form to agree on, no field ordering to reconcile; the public file IS the
 * preimage. See `AuraAttestation.sol` and `contracts/README.md`.
 */
export function hashLedgerContent(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? toUtf8Bytes(content) : content;
  return keccak256(bytes);
}
