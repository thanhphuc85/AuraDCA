import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { withRetry } from "./retry.js";

export interface Wallet {
  address: `0x${string}`;
  /** USDC balance for this wallet as reported by Circle Wallets (already a human-readable decimal string). */
  getUsdcTokenBalance(): Promise<string>;
}

export async function createWallet(apiKey: string, entitySecret: string, walletId: string): Promise<Wallet> {
  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  const walletResponse = await withRetry(
    () => client.getWallet({ id: walletId }),
    { maxRetries: 3, label: "Circle getWallet" },
  );
  const address = walletResponse.data?.wallet?.address;
  if (!address) {
    throw new Error(`Circle Wallets returned no address for wallet id ${walletId}`);
  }

  return {
    address: address as `0x${string}`,
    async getUsdcTokenBalance() {
      const balanceResponse = await withRetry(
        () => client.getWalletTokenBalance({ id: walletId }),
        { maxRetries: 3, label: "Circle getWalletTokenBalance" },
      );
      const usdc = balanceResponse.data?.tokenBalances?.find((b) => b.token.symbol === "USDC");
      return usdc?.amount ?? "0";
    },
  };
}
