import "dotenv/config";
import { z } from "zod";
import type { GuardrailConfig } from "./types.js";

export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_TESTNET_NAME = "Arc_Testnet";
export const ARC_TESTNET_EXPLORER = "https://testnet.arcscan.app";
// USDC's ERC-20 interface address on Arc Testnet (6 decimals). Native gas
// balance is the SAME underlying USDC but reported with 18 decimals via
// eth_getBalance -- the two must never be summed as separate pools.
export const USDC_TOKEN_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const USDC_TOKEN_DECIMALS = 6;

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");

const envSchema = z.object({
  RPC_URL: z.string().url().default("https://rpc.testnet.arc.network"),
  PRIVATE_KEY: z
    .string()
    .min(1, "PRIVATE_KEY is required")
    .transform((key) => (key.startsWith("0x") ? key : `0x${key}`)),
  KIT_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  MAX_DAILY_USDC: decimalString.default("1.00"),
  MIN_USDC_RESERVE: decimalString.default("0.50"),
  MIN_SWAP_USDC: decimalString.default("0.10"),
  CAMPAIGN_TOTAL_BUDGET_USDC: decimalString.optional().or(z.literal("")),
  CAMPAIGN_DURATION_DAYS: z.coerce.number().int().positive().optional(),
  TOKEN_OUT: z.string().default("cirBTC"),
  DRY_RUN: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),
});

export interface AppConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
  kitKey?: string;
  anthropicApiKey: string;
  tokenOut: string;
  dryRun: boolean;
  guardrails: GuardrailConfig;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid configuration: ${issues}`);
  }
  const env = parsed.data;

  if (!env.DRY_RUN && !env.KIT_KEY) {
    throw new ConfigError("KIT_KEY is required when DRY_RUN is not true (real swaps need a Circle Swap Kit key)");
  }

  return {
    rpcUrl: env.RPC_URL,
    privateKey: env.PRIVATE_KEY as `0x${string}`,
    kitKey: env.KIT_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    tokenOut: env.TOKEN_OUT,
    dryRun: env.DRY_RUN,
    guardrails: {
      maxDailyUsdc: env.MAX_DAILY_USDC,
      minUsdcReserve: env.MIN_USDC_RESERVE,
      minSwapUsdc: env.MIN_SWAP_USDC,
      campaignTotalBudgetUsdc: env.CAMPAIGN_TOTAL_BUDGET_USDC || undefined,
      campaignDurationDays: env.CAMPAIGN_DURATION_DAYS,
    },
  };
}
