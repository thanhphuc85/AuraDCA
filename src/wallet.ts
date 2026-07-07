import { createPublicClient, createWalletClient, formatUnits, http, type Chain, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_TESTNET_CHAIN_ID, USDC_TOKEN_ADDRESS, USDC_TOKEN_DECIMALS } from "./config.js";

export const arcTestnetChain: Chain = {
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [] }, // overridden per-client via explicit transport below
  },
};

const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface Wallet {
  address: `0x${string}`;
  publicClient: PublicClient;
  walletClient: WalletClient;
  /** Native gas balance -- same underlying USDC, reported with 18 decimals. Do NOT sum with getUsdcTokenBalance(). */
  getNativeBalance(): Promise<string>;
  /** ERC-20 USDC balance (0x3600...0000, 6 decimals) -- this is the pool used for swap-amount decisions. */
  getUsdcTokenBalance(): Promise<string>;
}

export function createWallet(privateKey: `0x${string}`, rpcUrl: string): Wallet {
  const account = privateKeyToAccount(privateKey);
  const chain: Chain = {
    ...arcTestnetChain,
    rpcUrls: { default: { http: [rpcUrl] } },
  };
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, account, transport });

  return {
    address: account.address,
    publicClient,
    walletClient,
    async getNativeBalance() {
      const balance = await publicClient.getBalance({ address: account.address });
      return formatUnits(balance, 18);
    },
    async getUsdcTokenBalance() {
      const balance = await publicClient.readContract({
        address: USDC_TOKEN_ADDRESS,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [account.address],
      });
      return formatUnits(balance, USDC_TOKEN_DECIMALS);
    },
  };
}
