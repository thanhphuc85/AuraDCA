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
  txHash: string;
  explorerUrl: string;
  amountUsdcAtomic: string; // atomic units actually settled (USDC, 6dp)
  payer: string;
  network: string; // CAIP-2
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
  const txHash = res.transaction;
  return {
    txHash,
    explorerUrl: `${ARC_TESTNET_EXPLORER}/tx/${txHash}`,
    amountUsdcAtomic: res.amount.toString(),
    payer: gateway.address,
    network: ARC_TESTNET_CAIP2,
  };
}
