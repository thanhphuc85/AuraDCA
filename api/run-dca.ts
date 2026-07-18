import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ethers } from "ethers";

// On-demand DCA endpoint.
//
// Real USDC→cirBTC execution goes through Circle Swap Kit, which loads fine on
// the GitHub Actions runtime (the scheduled cron) but NOT inside Vercel's
// serverless bundler — its rpc-websockets → uuid(ESM) dependency chain throws
// "require() of ES Module" there, and npm overrides can't pin the nested uuid.
// On top of that, Arc Testnet's USDC→cirBTC route has been in an outage, so no
// swap can settle right now regardless.
//
// Rather than crash on the fragile SDK load, this endpoint verifies the user's
// signed intent (EIP-191) and returns an honest, non-crashing response. When
// Arc's route is back, real execution should be wired through the GitHub Actions
// path that already runs Swap Kit successfully.

const MESSAGE_EXPIRY_MS = 5 * 60 * 1000;
const MIN_USDC = 0.01;
const MAX_USDC = 10000;

function parseRunMessage(msg: string): { amount: string; address: string; timestamp: number } | null {
  const lines = msg.split("\n");
  if (!lines[0]?.startsWith("Aura DCA Agent")) return null;
  const get = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length);
  const amount = get("Amount: ");
  const address = get("Address: ");
  const ts = get("Timestamp: ");
  if (!amount || !address || !ts) return null;
  return { amount, address, timestamp: parseInt(ts, 10) };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const { message, signature } = (req.body ?? {}) as { message?: string; signature?: string };
  if (!message || !signature) { res.status(400).json({ error: "Missing message or signature" }); return; }

  const parsed = parseRunMessage(message);
  if (!parsed) { res.status(400).json({ error: "Invalid message format" }); return; }
  const { amount, address, timestamp } = parsed;

  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MESSAGE_EXPIRY_MS) { res.status(400).json({ error: "Message expired. Please try again." }); return; }

  let recovered: string;
  try { recovered = ethers.verifyMessage(message, signature).toLowerCase(); }
  catch { res.status(401).json({ error: "Invalid signature" }); return; }
  if (recovered !== address.toLowerCase()) { res.status(401).json({ error: "Signature does not match address" }); return; }

  const amountNum = parseFloat(amount);
  if (!Number.isFinite(amountNum) || amountNum < MIN_USDC) { res.status(400).json({ error: `Minimum is ${MIN_USDC} USDC` }); return; }
  if (amountNum > MAX_USDC) { res.status(400).json({ error: `Maximum is ${MAX_USDC} USDC` }); return; }

  // Intent is valid and signed, but on-demand settlement isn't available. Report
  // this honestly — no funds are moved, and nothing crashes.
  res.status(200).json({
    unavailable: true,
    amountUsdc: amount,
    message:
      "On-demand DCA can't settle right now: the USDC → cirBTC route on Arc Testnet is in an outage, so a buy won't go through. Your balance was not touched — your scheduled DCA still runs automatically on the schedule you set, and this will work again once the route recovers.",
  });
}
