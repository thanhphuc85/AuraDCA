import type { PaymentRequirements } from "./types.js";
import { usdcToAtomic } from "./payment.js";
import { ARC_USDC_CONTRACT } from "../ledger/constants.js";

// Arc Testnet — verified in contracts/README.md.
export const ARC_TESTNET_CHAIN_ID = 5042002;
export const X402_NETWORK = "arc-testnet";

// EIP-712 domain of Arc Testnet USDC. Carried in requirements.extra so the payer
// signs — and the server verifies — under identical domain params. Overridable by
// env in case Arc's USDC advertises a different name/version, so the signed
// authorization stays settlement-ready without a code change.
const USDC_DOMAIN_NAME = process.env.X402_USDC_NAME?.trim() || "USDC";
const USDC_DOMAIN_VERSION = process.env.X402_USDC_VERSION?.trim() || "2";

/** Default price to read the premium market brief, in whole USDC. */
export const X402_BRIEF_PRICE_USDC = process.env.X402_BRIEF_PRICE_USDC?.trim() || "0.001";

/**
 * Build the PaymentRequirements the service demands for a resource. `payTo`
 * defaults to the configured service wallet (X402_PAY_TO); tests pass it
 * explicitly. Amount is whole-USDC in, atomic-units out.
 */
export function buildRequirements(opts: {
  resource: string;
  description: string;
  priceUsdc?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
}): PaymentRequirements {
  const payTo = opts.payTo ?? process.env.X402_PAY_TO?.trim() ?? "";
  return {
    scheme: "exact",
    network: X402_NETWORK,
    maxAmountRequired: usdcToAtomic(opts.priceUsdc ?? X402_BRIEF_PRICE_USDC),
    resource: opts.resource,
    description: opts.description,
    mimeType: "application/json",
    payTo,
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 120,
    asset: ARC_USDC_CONTRACT,
    extra: {
      name: USDC_DOMAIN_NAME,
      version: USDC_DOMAIN_VERSION,
      chainId: ARC_TESTNET_CHAIN_ID,
      verifyingContract: ARC_USDC_CONTRACT,
    },
  };
}
