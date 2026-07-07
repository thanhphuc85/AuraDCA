import { SwapKit } from "@circle-fin/swap-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, createWalletClient, http } from "viem";
import { ARC_TESTNET_EXPLORER } from "../config.js";
import { arcTestnetChain } from "../wallet.js";

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
  privateKey: `0x${string}`;
  rpcUrl: string;
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
    const chain = { ...arcTestnetChain, rpcUrls: { default: { http: [params.rpcUrl] } } };
    const adapter = createViemAdapterFromPrivateKey({
      privateKey: params.privateKey,
      getPublicClient: ({ chain: c }) => createPublicClient({ chain: c ?? chain, transport: http(params.rpcUrl) }),
      getWalletClient: ({ chain: c, account }) =>
        createWalletClient({ chain: c ?? chain, account, transport: http(params.rpcUrl) }),
    });

    const kit = new SwapKit();
    const result = await kit.swap({
      from: { adapter, chain: "Arc_Testnet" },
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
