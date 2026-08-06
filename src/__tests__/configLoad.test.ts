import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, ConfigError } from "../config.js";

// loadConfig reads process.env live via safeParse(process.env), so we drive it
// by installing a clean env per test and restoring the real one afterwards.
const REQUIRED = {
  CIRCLE_API_KEY: "ck_test",
  CIRCLE_ENTITY_SECRET: "es_test",
  WALLET_ID: "wallet_test",
  ANTHROPIC_API_KEY: "sk-ant-test",
};

let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = process.env;
  process.env = { ...REQUIRED } as NodeJS.ProcessEnv; // pristine: only the required secrets
});

afterEach(() => {
  process.env = saved;
});

describe("loadConfig — defaults and guardrail wiring", () => {
  it("applies documented defaults when only the required secrets are set", () => {
    const cfg = loadConfig();
    expect(cfg.dryRun).toBe(true);               // safe by default
    expect(cfg.allowanceMode).toBe(false);
    expect(cfg.attestationEnabled).toBe(false);
    expect(cfg.tokenOut).toBe("cirBTC");
    expect(cfg.guardrails).toEqual({
      maxDailyUsdc: "1.00",
      minUsdcReserve: "0.50",
      minSwapUsdc: "0.10",
      campaignTotalBudgetUsdc: undefined,
      campaignDurationDays: undefined,
    });
  });

  it("treats empty-string env vars as unset so defaults still apply", () => {
    process.env.MAX_DAILY_USDC = "";   // e.g. an unset GitHub Actions variable
    process.env.TOKEN_OUT = "";
    const cfg = loadConfig();
    expect(cfg.guardrails.maxDailyUsdc).toBe("1.00");
    expect(cfg.tokenOut).toBe("cirBTC");
  });

  it("parses DRY_RUN case-insensitively", () => {
    process.env.DRY_RUN = "FALSE";
    process.env.KIT_KEY = "kit_live"; // required once live
    expect(loadConfig().dryRun).toBe(false);
  });
});

describe("loadConfig — refuses invalid or unsafe configurations", () => {
  it("throws ConfigError listing every blank required secret, with the missing-secrets hint", () => {
    // Blank (not absent) secrets hit zod's min(1) → too_small, which is what the
    // "Missing secrets? … GitHub" hint keys off of.
    process.env = { CIRCLE_API_KEY: "", CIRCLE_ENTITY_SECRET: "", WALLET_ID: "", ANTHROPIC_API_KEY: "" } as NodeJS.ProcessEnv;
    expect(() => loadConfig()).toThrow(ConfigError);
    try {
      loadConfig();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("CIRCLE_API_KEY");
      expect(msg).toContain("ANTHROPIC_API_KEY");
      expect(msg).toContain("GitHub"); // the "missing secrets?" hint
    }
  });

  it("refuses a live run (DRY_RUN=false) without a Swap Kit key", () => {
    process.env.DRY_RUN = "false"; // no KIT_KEY
    expect(() => loadConfig()).toThrow(/KIT_KEY is required/);
  });

  it("rejects a non-decimal money string", () => {
    process.env.MAX_DAILY_USDC = "abc";
    expect(() => loadConfig()).toThrow(ConfigError);
  });
});

describe("loadConfig — optional withdrawal + campaign inputs", () => {
  it("assembles withdrawalInput only when address, token, and amount are all present", () => {
    expect(loadConfig().withdrawalInput).toBeUndefined();
    process.env.WITHDRAWAL_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.WITHDRAWAL_TOKEN = "USDC";
    process.env.WITHDRAWAL_AMOUNT = "2.5";
    expect(loadConfig().withdrawalInput).toEqual({
      address: "0x1111111111111111111111111111111111111111",
      token: "USDC",
      amount: "2.5",
    });
  });

  it("carries campaign budget + duration into guardrails when set", () => {
    process.env.CAMPAIGN_TOTAL_BUDGET_USDC = "100";
    process.env.CAMPAIGN_DURATION_DAYS = "30";
    const g = loadConfig().guardrails;
    expect(g.campaignTotalBudgetUsdc).toBe("100");
    expect(g.campaignDurationDays).toBe(30);
  });
});
