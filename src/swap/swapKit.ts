import { SwapKit } from "@circle-fin/swap-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { ARC_TESTNET_EXPLORER } from "../config.js";

export class SwapExecutionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SwapExecutionError";
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

export async function executeSwap(params: SwapParamsInput): Promise<SwapExecutionResult> {
  if (params.dryRun) {
    return { dryRun: true };
  }

  if (!params.kitKey) {
    throw new SwapExecutionError("KIT_KEY is required to execute a real swap");
  }

  try {
    const adapter = createCircleWalletsAdapter({
      apiKey: params.circleApiKey,
      entitySecret: params.circleEntitySecret,
    });

    const kit = new SwapKit();
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
    throw new SwapExecutionError("Swap Kit execution failed", { cause: err });
  }
}
