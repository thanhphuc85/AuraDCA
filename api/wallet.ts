import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createRequire } from "node:module";

// The Circle SDK (and its ESM-only Solana deps) breaks when Vercel's esbuild
// bundles it into the function. Loading it through createRequire keeps it
// external — @vercel/nft still ships it in node_modules, but esbuild does not
// bundle it. Same pattern as api/withdraw.ts.
const nodeRequire = createRequire(import.meta.url);

// Where user deposits land. Server-fixed so a client can never redirect a
// deposit challenge to an arbitrary address. Env override for other deployments.
const AGENT_ADDRESS = (process.env.AGENT_WALLET_ADDRESS || "0x00Ebbd3aFCCaD08970ED8FdaE591244c8475a0aC").trim();
const USDC_CONTRACT = "0x3600000000000000000000000000000000000000"; // USDC on Arc Testnet, 6 decimals
const ARC_BLOCKCHAIN = "ARC-TESTNET";

// Lazily construct the user-controlled-wallets client so a missing key only
// fails the actions that actually need it (not the public `config` probe).
let _client: any = null;
function client(): any {
  if (_client) return _client;
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error("CIRCLE_API_KEY is not configured on the server.");
  const { initiateUserControlledWalletsClient } = nodeRequire("@circle-fin/user-controlled-wallets");
  _client = initiateUserControlledWalletsClient({ apiKey });
  return _client;
}

function circleErrorCode(e: any): string {
  return String(e?.response?.data?.code ?? e?.code ?? "");
}

/**
 * User-Controlled Wallet endpoints for the "Sign in with Google → get a Circle
 * wallet on Arc" onboarding (Phase 1). One action-based function to stay within
 * Vercel's serverless-function budget. The heavy lifting (key custody, the
 * challenge UI) happens in Circle's Web SDK on the client; this backend only
 * mints session tokens and creates challenges with the server-held API key.
 *
 * Flow: client getDeviceId() → `socialToken` → client performLogin(Google) →
 * `initWallet` (challengeId) → client execute(challengeId) → `listWallets`.
 * Deposit: `depositChallenge` → client execute(challengeId) → poll `txStatus`.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const body = (req.body || {}) as Record<string, any>;
  const action = String(body.action || "");

  try {
    switch (action) {
      // Public, safe to expose: the frontend needs appId + googleClientId to
      // initialize the Web SDK. `configured` gates whether the real Circle path
      // is live or the UI should stay on its existing fallback.
      case "config": {
        res.status(200).json({
          appId: process.env.CIRCLE_APP_ID || null,
          googleClientId: process.env.GOOGLE_CLIENT_ID || null,
          agentAddress: AGENT_ADDRESS,
          configured: !!(process.env.CIRCLE_APP_ID && process.env.GOOGLE_CLIENT_ID && process.env.CIRCLE_API_KEY),
        });
        return;
      }

      // Exchange a client deviceId for the social-login device token pair.
      case "socialToken": {
        const deviceId = String(body.deviceId || "");
        if (!deviceId) { res.status(400).json({ error: "deviceId required" }); return; }
        const r = await client().createDeviceTokenForSocialLogin({ deviceId });
        res.status(200).json(r.data); // { deviceToken, deviceEncryptionKey }
        return;
      }

      // Create the user's wallet on Arc. Returns a challengeId the client must
      // execute() to finish provisioning. A repeat login for an existing user
      // returns 155106 — not an error, just "already has a wallet".
      case "initWallet": {
        const userToken = String(body.userToken || "");
        if (!userToken) { res.status(400).json({ error: "userToken required" }); return; }
        try {
          const r = await client().createUserPinWithWallets({
            userToken,
            blockchains: [ARC_BLOCKCHAIN],
            accountType: "EOA",
          });
          res.status(200).json({ challengeId: r.data.challengeId, alreadyExists: false });
        } catch (e: any) {
          if (circleErrorCode(e) === "155106") { res.status(200).json({ challengeId: null, alreadyExists: true }); return; }
          throw e;
        }
        return;
      }

      case "listWallets": {
        const userToken = String(body.userToken || "");
        if (!userToken) { res.status(400).json({ error: "userToken required" }); return; }
        const r = await client().listWallets({ userToken });
        res.status(200).json({ wallets: r.data?.wallets || [] });
        return;
      }

      // Build an ERC-20 USDC transfer challenge from the user's wallet to the
      // agent treasury. destinationAddress is server-fixed to AGENT_ADDRESS.
      case "depositChallenge": {
        const userToken = String(body.userToken || "");
        const walletId = String(body.walletId || "");
        const amount = String(body.amount || "");
        const n = Number(amount);
        if (!userToken || !walletId) { res.status(400).json({ error: "userToken and walletId required" }); return; }
        if (!(n > 0) || n > 100000) { res.status(400).json({ error: "invalid amount" }); return; }
        const r = await client().createTransaction({
          userToken,
          walletId,
          destinationAddress: AGENT_ADDRESS,
          amounts: [amount],
          tokenAddress: USDC_CONTRACT,
          blockchain: ARC_BLOCKCHAIN,
          fee: { type: "level", config: { feeLevel: "MEDIUM" } },
        });
        res.status(200).json({ challengeId: r.data.challengeId, transactionId: r.data.id });
        return;
      }

      // Poll a transaction to a terminal state (COMPLETE / FAILED / DENIED / CANCELLED).
      case "txStatus": {
        const userToken = String(body.userToken || "");
        const id = String(body.id || "");
        if (!userToken || !id) { res.status(400).json({ error: "userToken and id required" }); return; }
        const r = await client().getTransaction({ userToken, id });
        res.status(200).json(r.data);
        return;
      }

      default:
        res.status(400).json({ error: "unknown action" });
        return;
    }
  } catch (e: any) {
    const code = circleErrorCode(e);
    res.status(500).json({ error: e?.message || String(e), code: code || undefined });
  }
}
