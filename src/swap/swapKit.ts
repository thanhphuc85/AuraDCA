import { SwapKit } from "@circle-fin/swap-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { ARC_TESTNET_EXPLORER } from "../config.js";

export type SwapErrorCategory =
  | "no_route"
  | "insufficient_balance"
  | "rate_limited"
  | "auth_error"
  | "network_error"
  | "timeout"
  | "unknown";

export class SwapExecutionError extends Error {
  readonly category: SwapErrorCategory;

  constructor(message: string, category: SwapErrorCategory = "unknown", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SwapExecutionError";
    this.category = category;
  }
}

export interface SwapExecutionResult {
  dryRun: boolean;
  txHash?: string;
  explorerUrl?: string;
  amountOut?: string;
}

export interface SwapParamsInput {
  circleApiKey: string;
  circleEntitySecret: string;
  walletAddress: `0x${string}`;
  kitKey?: string;
  tokenOut: string;
  amountUsdc: string;
  dryRun: boolean;
}

function classifyError(err: unknown): SwapErrorCategory {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (msg.includes("no route") || msg.includes("route not found") || msg.includes("not found")) return "no_route";
  if (msg.includes("insufficient") || msg.includes("not enough") || msg.includes("balance")) return "insufficient_balance";
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many")) return "rate_limited";
  if (msg.includes("unauthorized") || msg.includes("403") || msg.includes("401") || msg.includes("invalid api") || msg.includes("invalid key")) return "auth_error";
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("econnaborted")) return "timeout";
  if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("network") || msg.includes("fetch failed") || msg.includes("socket")) return "network_error";
  return "unknown";
}

export async function executeSwap(params: SwapParamsInput): Promise<SwapExecutionResult> {
  if (params.dryRun) {
    return { dryRun: true };
  }

  if (!params.kitKey) {
    throw new SwapExecutionError("KIT_KEY is required to execute a real swap", "auth_error");
  }

  try {
    const adapter = createCircleWalletsAdapter({
      apiKey: params.circleApiKey,
      entitySecret: params.circleEntitySecret,
    });

    const kit = new SwapKit();
    // A swap is NOT idempotent: once kit.swap has broadcast the transaction, a
    // failure that surfaces afterwards (timeout, dropped connection, an
    // unparseable response — all classified network/timeout/unknown) is
    // ambiguous. Retrying would re-broadcast and could execute the swap twice,
    // draining the agent wallet 2x while users are credited once. There is no
    // reliable way to tell a pre-broadcast failure from a post-broadcast one, so
    // we do NOT retry the swap here. The hourly cron is the safe retry: it only
    // advances lastChargedAt on a successful distribution, so a failed run is
    // simply re-attempted next hour with fresh on-chain state.
    const result = await kit.swap({
      from: { adapter, chain: "Arc_Testnet", address: params.walletAddress },
      tokenIn: "USDC",
      tokenOut: params.tokenOut,
      amountIn: params.amountUsdc,
      config: { kitKey: params.kitKey },
    });

    return {
      dryRun: false,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl ?? (result.txHash ? `${ARC_TESTNET_EXPLORER}/tx/${result.txHash}` : undefined),
      amountOut: result.amountOut,
    };
  } catch (err) {
    const category = classifyError(err);
    const causeMsg = err instanceof Error ? err.message : String(err);
    throw new SwapExecutionError(`Swap failed [${category}]: ${causeMsg}`, category, { cause: err });
  }
}
