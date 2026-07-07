import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

export interface Wallet {
  address: `0x${string}`;
  /** USDC balance for this wallet as reported by Circle Wallets (already a human-readable decimal string). */
  getUsdcTokenBalance(): Promise<string>;
}

export async function createWallet(apiKey: string, entitySecret: string, walletId: string): Promise<Wallet> {
  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  const walletResponse = await client.getWallet({ id: walletId });
  const address = walletResponse.data?.wallet?.address;
  if (!address) {
    throw new Error(`Circle Wallets returned no address for wallet id ${walletId}`);
  }

  return {
    address: address as `0x${string}`,
    async getUsdcTokenBalance() {
      const balanceResponse = await client.getWalletTokenBalance({ id: walletId });
      const usdc = balanceResponse.data?.tokenBalances?.find((b) => b.token.symbol === "USDC");
      return usdc?.amount ?? "0";
    },
  };
}
