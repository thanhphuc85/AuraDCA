import "dotenv/config";

// --- Arc network config (env-overridable; defaults = Arc PUBLIC TESTNET) ----
// Unset env == current testnet behaviour. When Arc mainnet opens, set these in
// the environment (see .env.example / DEPLOY.md) to point the agent at mainnet
// WITHOUT a code change. The money path reads these names, never raw literals.
const envStr = (v: string | undefined, fallback: string): string => {
  const t = v?.trim();
  return t && t.length > 0 ? t : fallback;
};

// Circle Developer-Controlled-Wallet blockchain id (DCW / Swap Kit / faucet).
// Typed to the two Arc ids the project targets (testnet now, "ARC" for mainnet);
// both are members of Circle's transfer / createWallets blockchain unions.
export const ARC_CIRCLE_BLOCKCHAIN = envStr(process.env.ARC_CIRCLE_BLOCKCHAIN, "ARC-TESTNET") as "ARC-TESTNET" | "ARC";
/** JSON-RPC endpoint (may hold a mainnet URL once ARC_RPC_URL is set). */
export const ARC_TESTNET_RPC = envStr(process.env.ARC_RPC_URL, "https://rpc.testnet.arc.network");
/** Numeric EVM chain id (5042002 = Arc public testnet). */
export const ARC_CHAIN_ID = Number(envStr(process.env.ARC_CHAIN_ID, "5042002"));
export const ARC_USDC_CONTRACT = envStr(process.env.ARC_USDC_CONTRACT, "0x3600000000000000000000000000000000000000");
export const ARC_CIRBTC_CONTRACT = envStr(process.env.ARC_CIRBTC_CONTRACT, "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf");
// Verified on-chain from the prove-swap tx 0xe54ee0… (symbol()="EURC", decimals=6).
export const ARC_EURC_CONTRACT = envStr(process.env.ARC_EURC_CONTRACT, "0x89b50855aa3be2f677cd6303cec089b5f319d72a");
export const ARC_AGENT_ADDRESS = envStr(process.env.ARC_AGENT_ADDRESS, "0x00Ebbd3aFCCaD08970ED8FdaE591244c8475a0aC");
export const USDC_DECIMALS = 6;
export const CIRBTC_DECIMALS = 8;
export const EURC_DECIMALS = 6;

/**
 * Tokens the agent can DCA into on Arc Testnet. USDC is the input, never a
 * target. `symbol` is what Circle Swap Kit resolves for the swap; `decimals`
 * governs ledger rounding of the received amount. This is the honest, current
 * set the network's Swap Kit actually supports — it grows as Arc wires more
 * assets, not as we hard-code them.
 */
export interface DcaTokenInfo {
  symbol: string;
  decimals: number;
  label: string;
  note?: string;
  // When true, this token has no live swap route on Arc Testnet (liquidity
  // outage), so the agent records an honest PAPER fill at the live market price
  // instead of a real on-chain swap. See applySimulatedDistribution + run.ts.
  simulated?: boolean;
}
export const SUPPORTED_DCA_TOKENS: DcaTokenInfo[] = [
  { symbol: "cirBTC", decimals: CIRBTC_DECIMALS, label: "cirBTC — tokenized BTC", note: "volatile; route in outage on Arc Testnet — simulated (paper) at live price", simulated: true },
  { symbol: "EURC", decimals: EURC_DECIMALS, label: "EURC — euro stablecoin", note: "live route" },
];
export const DEFAULT_DCA_TOKEN = "cirBTC";

export function dcaTokenInfo(symbol: string | undefined | null): DcaTokenInfo {
  return SUPPORTED_DCA_TOKENS.find((t) => t.symbol === symbol) ?? SUPPORTED_DCA_TOKENS[0]!;
}
export function isSupportedDcaToken(symbol: string | undefined | null): boolean {
  return !!symbol && SUPPORTED_DCA_TOKENS.some((t) => t.symbol === symbol);
}
export const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const DEPOSIT_SCAN_CHUNK_SIZE = 9999;
export const DEPOSIT_SCAN_LOOKBACK = 200_000;
