# FLOP testnet faucet + auto-spend (`src/flop/`)

An **additive, gated scaffold** for the FLOP testnet faucet and optional
auto-spend. Same ethos as [`src/x402/`](../x402): inert by default, never touches
the DCA money path, pure logic tested now, spec-dependent seams injected.

## Why a scaffold and not a full integration

Arc/FLOP announced that testnet faucet tokens will live on **Technocore.chat**,
claimable by **agents holding a DID key**, with the **$FLOP airdrop weighting
testnet activity**. The announcement explicitly says *details are coming soon* —
so the faucet endpoint shape and the exact **DID authentication scheme are not
public yet**. Rather than guess (and POST a fabricated proof to a real faucet),
the two unknown seams are **injected**:

- `signProof(challenge)` — produces the DID proof. Drop in `did-jwt` / a signed
  challenge once the scheme is published.
- `FLOP_FAUCET_URL` — the endpoint.

Everything else — gating, cooldown, request assembly, response parsing, and the
spend planner — is real and unit-tested (`src/__tests__/flop.test.ts`).

> ⚠️ **Airdrop-scam note:** community replies circulating third-party links
> ("connect wallet to boost your airdrop") are **not** part of this. Only the
> official FLOP faucet, once its spec is published, should ever be wired here.
> Never put a real seed phrase or private key into any such site.

## Behavior (all default OFF)

| Flag | Effect |
|---|---|
| `FLOP_FAUCET_ENABLED` | Master switch. Off ⇒ `claimFaucet()` → `skipped_disabled`. |
| `FLOP_AUTOSPEND_ENABLED` | After a claim, propose a spend (still only a recommendation). |

When enabled but the URL / identity / DID signer are missing, a claim returns
`skipped_unconfigured` and **never hits the network**. Cooldown, HTTP errors, and
proof rejection are all recorded outcomes — `claimFaucet()` never throws.

## Wiring it once FLOP ships the spec

```ts
import { runFaucetCycle } from "./flop/index.js";
import { clampDecision } from "./decision/guardrails.js";

// 1. Implement the real DID proof signer for FLOP's scheme.
const signProof = async (c) => await mySchemeSign(c, process.env.FLOP_DID_PRIVATE_KEY!);

// 2. Claim, then get a spend RECOMMENDATION.
const { faucet, plan } = await runFaucetCycle(balanceUsdc, { signProof });

// 3. The recommendation is NOT authoritative — clamp it before spending.
if (plan?.proceed) {
  const decision = clampDecision(/* …, plan.amountUsdc, guardrails */);
  // …execute via the existing swap path only if the guardrail allows.
}
```

`clampDecision()` stays the **sole authority** over the real spend, exactly as in
the DCA pipeline — the faucet planner only proposes.

## Try it offline (no keys, no network)

```bash
npm run flop-demo
```

Flips the gates in-process, injects a fake signer + fake faucet, and prints the
claim result and the (capped) spend recommendation.

## Token ledger + the "dry-run" mode switch (`ledger.ts`)

The **token manager** half: it holds per-token FLOP balances and records credits
(faucet top-ups) and spends (e.g. paying FLOP for an inference call), persisting to
`data/flop-ledger.json` like the seq store. Balance math goes through viem's
`parseUnits`/`formatUnits`, so a `0.001` spend is exact — no float drift.

A **single flag**, `FLOP_TESTNET_ENABLED`, selects the behavior — so the framework
is production-ready *before* the testnet opens (build the pipe now, open the valve
later):

| `FLOP_TESTNET_ENABLED` | `spendToken()` behavior |
|---|---|
| unset / `false` (default) | **simulation** — debit a MOCK balance and log `[SIMULATION] Spent 0.001 MOCK_FLOP for <memo>`. Nothing touches a chain. |
| `true` | **testnet** — submit a REAL transfer, but ONLY through an injected `submitTx` signer + an explicit `FLOP_RPC_URL`. Absent either ⇒ `skipped_unconfigured` (it never fabricates a tx hash). |

Every path is a recorded, non-throwing outcome (`spent_simulated`, `spent_onchain`,
`skipped_insufficient`, `skipped_unconfigured`, `error_submit`) — same ethos as the
faucet. When FLOP publishes the testnet RPC, wiring is: implement `submitTx` against
their chain, set `FLOP_RPC_URL`, flip `FLOP_TESTNET_ENABLED=true`. The accounting
logic here is unchanged.

```ts
import { creditToken, spendToken, checkBalance } from "./flop/index.js";

await creditToken({ amount: "100", token: "FLOP" });        // record a faucet top-up
await checkBalance("FLOP");                                  // "100"
await spendToken({ amount: "0.001", memo: "Gemini Inference" });
//  simulation: logs `[SIMULATION] Spent 0.001 MOCK_FLOP for Gemini Inference`
//  testnet:    submits via the injected submitTx, records the real tx hash
```

`npm run flop-demo` exercises this end-to-end (offline, in a throwaway store).

## Signing + posting a message to a Technocore room

The lobby feed (`/r/lobby?format=json`) shows the identity scheme actually in use:
messages are **Ed25519-signed writes bound to a `did:key:z6Mk…`**. That primitive
*is* specified, so it's implemented for real in [`signer.ts`](signer.ts) (Ed25519 →
`did:key`, verified against a fixed vector) and [`technocore.ts`](technocore.ts)
(assemble → sign → POST `<base>/r/<room>` → save the returned `seq`).

Same ethos as the faucet — **gated OFF, never throws, and it will not POST to a
guessed endpoint**. `postSignedMessage()` returns a `skipped_*` outcome unless all
three are set: `TECHNOCORE_POST_ENABLED=true`, `TECHNOCORE_BASE_URL`, and
`FLOP_DID_PRIVATE_KEY` (the Ed25519 seed, reused from the faucet identity). The seed
stays inside the signer — never logged, never in the body.

Run it yourself with your own key:

```bash
# 1) Inspect the signed envelope WITHOUT sending anything (no network):
FLOP_DID_PRIVATE_KEY=<hex32> npm run flop-post -- --dry-run "gm technocore"

# 2) Actually post to the technocore room (not lobby) and save the seq:
TECHNOCORE_POST_ENABLED=true TECHNOCORE_BASE_URL=https://technocore.chat \
TECHNOCORE_ROOM=technocore FLOP_DID_PRIVATE_KEY=<hex32> \
npm run flop-post -- "gm technocore"
```

> ⚠️ **What's real vs. injected:** the Ed25519 signature and `did:key` are real.
> Technocore hasn't published the exact **POST path / response shape**, so those are
> the adjustable seams — confirm `TECHNOCORE_BASE_URL` and tweak `parsePostResponse`
> if the room returns `seq` under a different field. Generate your key locally and
> never paste a seed phrase into any third-party "boost your airdrop" site.

See [`.env.example`](../../.env.example) for every flag.
