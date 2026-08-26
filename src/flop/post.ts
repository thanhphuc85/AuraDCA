// CLI: sign one message with YOUR DID key and (optionally) post it to a Technocore
// room, then save the returned seq. Run it yourself — the private key is read from
// your env and never leaves this process:
//
//   # Inspect the signed envelope WITHOUT sending anything (no network):
//   FLOP_DID_PRIVATE_KEY=<hex32> npm run flop-post -- --dry-run "gm technocore"
//
//   # Actually post (requires all three: flag + base URL + key):
//   TECHNOCORE_POST_ENABLED=true TECHNOCORE_BASE_URL=https://technocore.chat \
//   TECHNOCORE_ROOM=technocore FLOP_DID_PRIVATE_KEY=<hex32> \
//   npm run flop-post -- "gm technocore"
//
// Honest scope: signing is real; the exact Technocore POST path / response shape
// isn't published, so confirm TECHNOCORE_BASE_URL and adjust parsePostResponse if
// the room returns the seq under a different field. Nothing is sent in --dry-run.

import "dotenv/config";
import { loadSignerFromEnv } from "./signer.js";
import {
  buildSignedMessage,
  postSignedMessage,
  saveSeq,
  seqStorePath,
  technocoreRoom,
} from "./technocore.js";
import { randomBytes } from "node:crypto";

function parseArgs(argv: string[]): { dryRun: boolean; text: string } {
  const dryRun = argv.includes("--dry-run");
  const text = argv.filter((a) => a !== "--dry-run").join(" ").trim() || (process.env.TECHNOCORE_MESSAGE ?? "").trim();
  return { dryRun, text };
}

async function main() {
  const { dryRun, text } = parseArgs(process.argv.slice(2));
  if (!text) {
    console.error('No message text. Usage: npm run flop-post -- [--dry-run] "your message"');
    process.exit(1);
  }

  if (dryRun) {
    // Local sign-and-print: proves the envelope + signature without any network.
    const signer = loadSignerFromEnv();
    if (!signer) {
      console.error("--dry-run needs FLOP_DID_PRIVATE_KEY set (a 32-byte Ed25519 seed as hex/base64).");
      process.exit(1);
    }
    const room = technocoreRoom();
    const msg = buildSignedMessage(
      { room, text, ts: Math.floor(Date.now() / 1000), nonce: `0x${randomBytes(16).toString("hex")}` },
      signer,
    );
    console.log("— Technocore signed message (DRY RUN · not sent) —");
    console.log("did  :", signer.did);
    console.log("room :", room);
    console.log(JSON.stringify(msg, null, 2));
    console.log("\nNothing was posted. Set TECHNOCORE_POST_ENABLED=true and TECHNOCORE_BASE_URL to send.");
    return;
  }

  const result = await postSignedMessage({ text });
  console.log("— Technocore post —");
  console.log("outcome:", result.outcome, "·", result.reason);

  if (result.outcome !== "posted") {
    // A skip/error is a normal, recorded outcome — surface it and exit non-zero so
    // a wrapping script can tell it didn't post, without a stack trace.
    process.exitCode = 1;
    return;
  }

  console.log(`posted : r/${result.room} · seq ${result.seq ?? "(none returned)"} · did ${result.did}`);
  if (result.seq !== undefined) {
    const all = await saveSeq({
      seq: result.seq,
      room: result.room!,
      did: result.did!,
      ts: result.ts!,
      text,
      messageId: result.messageId,
    });
    console.log(`saved  : seq ${result.seq} → ${seqStorePath()} (${all.length} record${all.length === 1 ? "" : "s"})`);
  } else {
    console.log("note   : the room accepted the post but returned no seq — check parsePostResponse against the real body.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
