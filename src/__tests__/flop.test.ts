import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  claimFaucet,
  buildClaimRequest,
  parseFaucetResponse,
  planFaucetSpend,
  runFaucetCycle,
  isFaucetEnabled,
  isAutoSpendEnabled,
  autoSpendMaxUsdc,
  type FlopDidIdentity,
  type ProofChallenge,
} from "../flop/index.js";

const SAVED = { ...process.env };
function resetEnv() {
  for (const k of Object.keys(process.env)) if (k.startsWith("FLOP_")) delete process.env[k];
}
beforeEach(resetEnv);
afterEach(() => {
  resetEnv();
  Object.assign(process.env, SAVED);
});

const IDENTITY: FlopDidIdentity = {
  did: "did:key:z6MkExample",
  address: "0x00Ebbd3aFCCaD08970ED8FdaE591244c8475a0aC",
};

/** A fetch that returns a canned faucet body and records the POST it received. */
function fetchOk(body: unknown, calls: Array<{ url: string; init?: RequestInit }> = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => body, text: async () => "" };
  }) as unknown as typeof fetch;
}
function fetchStatus(status: number, text = ""): typeof fetch {
  return (async () => ({ ok: false, status, json: async () => ({}), text: async () => text })) as unknown as typeof fetch;
}
const signOk = async (c: ProofChallenge) => `proof-for-${c.nonce}`;

describe("FLOP faucet — gating", () => {
  it("is disabled by default", () => {
    expect(isFaucetEnabled()).toBe(false);
    expect(isAutoSpendEnabled()).toBe(false);
  });

  it("skips with skipped_disabled when the flag is off", async () => {
    const r = await claimFaucet({ signProof: signOk, identity: IDENTITY, url: "https://faucet.example" });
    expect(r.outcome).toBe("skipped_disabled");
  });

  it("skips as unconfigured when enabled but URL/identity missing", async () => {
    process.env.FLOP_FAUCET_ENABLED = "true";
    const r = await claimFaucet({ signProof: signOk, identity: IDENTITY });
    expect(r.outcome).toBe("skipped_unconfigured");
    expect(r.reason).toMatch(/FLOP_FAUCET_URL/);
  });

  it("refuses to POST when enabled + configured but no DID signer is wired", async () => {
    process.env.FLOP_FAUCET_ENABLED = "true";
    const calls: Array<{ url: string }> = [];
    const r = await claimFaucet({ identity: IDENTITY, url: "https://faucet.example", fetchImpl: fetchOk({}, calls) });
    expect(r.outcome).toBe("skipped_unconfigured");
    expect(r.reason).toMatch(/DID auth scheme/);
    expect(calls).toHaveLength(0); // never hit the network with a fabricated proof
  });

  it("enforces the cooldown window", async () => {
    process.env.FLOP_FAUCET_ENABLED = "true";
    process.env.FLOP_FAUCET_COOLDOWN_HOURS = "24";
    const now = () => 1_000_000_000_000;
    const r = await claimFaucet({
      signProof: signOk,
      identity: IDENTITY,
      url: "https://faucet.example",
      now,
      lastClaimAt: now() - 3_600_000, // 1h ago, inside a 24h window
    });
    expect(r.outcome).toBe("skipped_cooldown");
    expect(r.reason).toMatch(/until eligible/);
  });
});

describe("FLOP faucet — claim path", () => {
  beforeEach(() => {
    process.env.FLOP_FAUCET_ENABLED = "true";
  });

  it("claims and parses a successful faucet response", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const r = await claimFaucet({
      signProof: signOk,
      identity: IDENTITY,
      url: "https://faucet.example/claim",
      fetchImpl: fetchOk({ amount: "100", token: "FLOP", txHash: "0xabc123def456", explorerUrl: "https://x/tx/0xabc" }, calls),
    });
    expect(r.outcome).toBe("claimed");
    expect(r.amount).toBe("100");
    expect(r.token).toBe("FLOP");
    expect(r.txHash).toBe("0xabc123def456");
    expect(r.claimedAt).toBeDefined();

    // The POST body carries the DID, address and the signed proof.
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(String(calls[0]?.init?.body));
    expect(sent.did).toBe(IDENTITY.did);
    expect(sent.address).toBe(IDENTITY.address);
    expect(sent.proof).toMatch(/^proof-for-0x/);
  });

  it("maps 403 to error_rejected and other non-2xx to error_http", async () => {
    const rejected = await claimFaucet({ signProof: signOk, identity: IDENTITY, url: "https://f", fetchImpl: fetchStatus(403, "bad proof") });
    expect(rejected.outcome).toBe("error_rejected");
    const http = await claimFaucet({ signProof: signOk, identity: IDENTITY, url: "https://f", fetchImpl: fetchStatus(500) });
    expect(http.outcome).toBe("error_http");
  });

  it("surfaces a signer failure as error_rejected without throwing", async () => {
    const r = await claimFaucet({
      signProof: async () => {
        throw new Error("key locked");
      },
      identity: IDENTITY,
      url: "https://f",
      fetchImpl: fetchOk({}),
    });
    expect(r.outcome).toBe("error_rejected");
    expect(r.reason).toMatch(/key locked/);
  });
});

describe("FLOP faucet — pure helpers", () => {
  it("buildClaimRequest assembles the body", () => {
    const challenge: ProofChallenge = { did: IDENTITY.did, address: IDENTITY.address, issuedAt: 1234, nonce: "0xdead" };
    const body = buildClaimRequest(IDENTITY, challenge, "sig");
    expect(body).toEqual({ did: IDENTITY.did, address: IDENTITY.address, proof: "sig", nonce: "0xdead", issuedAt: 1234 });
  });

  it("parseFaucetResponse falls back to the default token and tolerates junk", () => {
    expect(parseFaucetResponse(null, "FLOP").token).toBe("FLOP");
    expect(parseFaucetResponse({ amount: 42 }, "FLOP").amount).toBe("42");
  });
});

describe("FLOP auto-spend planner", () => {
  const claimed = { outcome: "claimed" as const, reason: "ok" };

  it("does not propose spend when auto-spend is off", () => {
    const plan = planFaucetSpend({ faucet: claimed, balanceUsdc: "5" });
    expect(plan.proceed).toBe(false);
  });

  it("does not propose spend on a non-claim outcome", () => {
    process.env.FLOP_AUTOSPEND_ENABLED = "true";
    const plan = planFaucetSpend({ faucet: { outcome: "skipped_cooldown", reason: "x" }, balanceUsdc: "5" });
    expect(plan.proceed).toBe(false);
  });

  it("caps the proposal at min(desired, cap, balance)", () => {
    process.env.FLOP_AUTOSPEND_ENABLED = "true";
    process.env.FLOP_AUTOSPEND_MAX_USDC = "0.10";
    expect(autoSpendMaxUsdc()).toBe("0.10");
    // desired 1.00 but cap 0.10
    expect(planFaucetSpend({ faucet: claimed, balanceUsdc: "5", desiredUsdc: "1.00" }).amountUsdc).toBe("0.10");
    // balance below the cap binds instead
    expect(planFaucetSpend({ faucet: claimed, balanceUsdc: "0.03", desiredUsdc: "1.00" }).amountUsdc).toBe("0.03");
  });

  it("refuses when there is no spendable balance", () => {
    process.env.FLOP_AUTOSPEND_ENABLED = "true";
    const plan = planFaucetSpend({ faucet: claimed, balanceUsdc: "0" });
    expect(plan.proceed).toBe(false);
  });
});

describe("runFaucetCycle", () => {
  it("returns only the faucet result on a skip (no plan)", async () => {
    const out = await runFaucetCycle("5"); // disabled ⇒ skipped_disabled
    expect(out.faucet.outcome).toBe("skipped_disabled");
    expect(out.plan).toBeUndefined();
  });

  it("attaches a spend plan once claim + auto-spend are enabled", async () => {
    process.env.FLOP_FAUCET_ENABLED = "true";
    process.env.FLOP_AUTOSPEND_ENABLED = "true";
    process.env.FLOP_AUTOSPEND_MAX_USDC = "0.10";
    const out = await runFaucetCycle("5", {
      signProof: signOk,
      identity: IDENTITY,
      url: "https://faucet.example",
      fetchImpl: fetchOk({ amount: "100", token: "FLOP" }),
    });
    expect(out.faucet.outcome).toBe("claimed");
    expect(out.plan?.proceed).toBe(true);
    expect(out.plan?.amountUsdc).toBe("0.10");
  });
});
