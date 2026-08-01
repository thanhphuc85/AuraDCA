// x402 settlement — the `settle` half a facilitator broadcasts on-chain.
//
// The verify-only slice (payment.ts) signs and cryptographically verifies a USDC
// payment authorization but never moves funds. This module turns settlement ON,
// through Circle Gateway's batched x402 rail (the "Nanopayments" path), so each
// paid brief lands as a real on-chain transfer with a tx hash.
//
// Gated: everything here is inert unless X402_SETTLE_ENABLED=true. The SDK is
// dynamically imported so nothing loads on the verify-only default path. The
// paying wallet must hold a Circle Gateway deposit (gateway.deposit) — the pay
// itself is gasless. See .env.example for the full setup.

import { ARC_TESTNET_EXPLORER } from "../config.js";
import { logger } from "../logger.js";

/** CAIP-2 network id Circle Gateway uses for Arc Testnet. */
export const ARC_TESTNET_CAIP2 = "eip155:5042002";

/** Circle Gateway x402 facilitator for testnet (verify + settle endpoints). */
const DEFAULT_FACILITATOR_URL = "https://gateway-api-testnet.circle.com";

/** Master switch: on-chain settlement is off until this is explicitly "true". */
export function isSettlementEnabled(): boolean {
  return (process.env.X402_SETTLE_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** The Gateway facilitator URL (override with X402_FACILITATOR_URL). */
export function facilitatorUrl(): string {
  return process.env.X402_FACILITATOR_URL?.trim() || DEFAULT_FACILITATOR_URL;
}

export interface GatewaySettleResult {
  transferId: string; // Circle Gateway transfer id (returned immediately by pay)
  status: string; // Gateway transfer status: received | batched | confirmed | completed
  txHash?: string; // on-chain settlement hash — set once the batch lands on-chain
  explorerUrl?: string; // only when txHash is known
  amountUsdcAtomic: string; // atomic units actually settled (USDC, 6dp)
  payer: string;
  network: string; // CAIP-2
}

export interface GatewayTransferStatus {
  status: string;
  txHash: string | null;
}

/**
 * Resolve a Gateway transfer id to its on-chain settlement hash.
 *
 * Gateway batches x402 payments, so `pay()` returns a transfer id immediately
 * while the on-chain tx (and hash) lands a little later. This polls
 * `GET /v1/x402/transfers/{id}` a bounded number of times until `txHash` is
 * populated, returning the latest status either way (null txHash = still
 * batching). `fetchImpl` is injectable for tests.
 */
export async function resolveGatewayTransfer(
  transferId: string,
  opts: { fetchImpl?: typeof fetch; tries?: number; delayMs?: number; baseUrl?: string } = {},
): Promise<GatewayTransferStatus | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? facilitatorUrl();
  const tries = opts.tries ?? 5;
  const delayMs = opts.delayMs ?? 3000;
  const url = `${base}/v1/x402/transfers/${transferId}`;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await doFetch(url, { headers: { "content-type": "application/json" } });
      if (r.ok) {
        const j = (await r.json()) as { status?: string; txHash?: string | null };
        const status = j.status ?? "unknown";
        if (j.txHash) return { status, txHash: j.txHash };
        if (i === tries - 1) return { status, txHash: null };
      }
    } catch {
      /* transient — retry */
    }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, delayMs));
  }
  return null;
}

// Structural subset of @circle-fin/x402-batching GatewayClient we depend on —
// declared here so unit tests can inject a fake without the SDK or a network.
export interface GatewayPayClient {
  readonly address: string;
  getBalances(): Promise<{ gateway: { available: bigint; formattedAvailable: string } }>;
  deposit(amount: string): Promise<{ depositTxHash: string }>;
  pay(
    url: string,
    options?: { method?: "GET" | "POST"; body?: unknown },
  ): Promise<{ amount: bigint; formattedAmount: string; transaction: string; status: number }>;
}

export type GatewayClientFactory = (privateKey: string) => Promise<GatewayPayClient>;

/** Real factory: a Circle Gateway client bound to Arc Testnet + the payer key. */
async function defaultFactory(privateKey: string): Promise<GatewayPayClient> {
  const { GatewayClient } = await import("@circle-fin/x402-batching/client");
  return new GatewayClient({
    chain: "arcTestnet",
    privateKey: privateKey as `0x${string}`,
  }) as unknown as GatewayPayClient;
}

/**
 * Pay for a Gateway-metered x402 resource and SETTLE it on-chain. Returns the
 * settlement tx hash, or throws — the caller decides whether to fall back.
 *
 * If `depositUsdc` is set and the Gateway available balance is below it, tops the
 * balance up first (needs USDC + native gas in the wallet); a failed top-up is
 * non-fatal — we still attempt the (gasless) pay against whatever balance exists.
 */
export async function settleBriefViaGateway(opts: {
  privateKey: string;
  url: string;
  method?: "GET" | "POST";
  depositUsdc?: string;
  clientFactory?: GatewayClientFactory;
  // On-chain hash resolution (Gateway batches, so the hash lands slightly later).
  resolveFetch?: typeof fetch;
  resolveTries?: number;
  resolveDelayMs?: number;
}): Promise<GatewaySettleResult> {
  const factory = opts.clientFactory ?? defaultFactory;
  const gateway = await factory(opts.privateKey);

  const deposit = opts.depositUsdc?.trim();
  if (deposit && Number(deposit) > 0) {
    try {
      const bal = await gateway.getBalances();
      const floorAtomic = BigInt(Math.round(Number(deposit) * 1e6));
      if (bal.gateway.available < floorAtomic) {
        const dep = await gateway.deposit(deposit);
        logger.info(`x402 settle: topped up Gateway balance by ${deposit} USDC (deposit tx ${String(dep.depositTxHash).slice(0, 12)}…)`);
      }
    } catch (err) {
      logger.warn(`x402 settle: pre-pay Gateway top-up skipped (${(err as Error).message})`);
    }
  }

  const res = await gateway.pay(opts.url, { method: opts.method ?? "GET" });
  const transferId = res.transaction;

  // Gateway returns a transfer id immediately; the on-chain hash lands once the
  // batch settles. Best-effort resolve it (bounded) — if it isn't ready yet, the
  // receipt still carries the transfer id so the dashboard can resolve it later.
  let status = "received";
  let txHash: string | undefined;
  const resolved = await resolveGatewayTransfer(transferId, {
    fetchImpl: opts.resolveFetch,
    tries: opts.resolveTries,
    delayMs: opts.resolveDelayMs,
  });
  if (resolved) {
    status = resolved.status;
    if (resolved.txHash) txHash = resolved.txHash;
  }

  return {
    transferId,
    status,
    txHash,
    explorerUrl: txHash ? `${ARC_TESTNET_EXPLORER}/tx/${txHash}` : undefined,
    amountUsdcAtomic: res.amount.toString(),
    payer: gateway.address,
    network: ARC_TESTNET_CAIP2,
  };
}
