# Aura DCA — Hackathon Pitch

*An autonomous DCA agent that lets Claude drive strategy while code owns every number that touches money — built on Arc Network.*

**Encode Club × Circle — Programmable Money Hackathon**

| | |
|---|---|
| 🌐 Live dashboard | **https://aura-dca.xyz** |
| 💾 Repo | https://github.com/thanhphuc85/AuraDCA |
| 🔗 Flagship on-chain proof | [Pooled 2-user swap, split pro-rata](https://testnet.arcscan.app/tx/0xd8a19fef1527ed91122ba29ec1ea9a845be1a7e3f3005450252f143956c07a19) |
| ⚓ On-chain audit anchor | [`AuraAttestation` contract](https://testnet.arcscan.app/address/0x4948c662630c7dE36BD59089085850c00996F661) |

---

## 1. The one-sentence pitch

An autonomous agent that lets **Claude drive strategy** while **code owns every number that touches money** — pooling many users' DCA schedules into **one on-chain swap per token, settled pro-rata**. Dollar-cost averaging is the reference implementation; the safety architecture underneath is the contribution.

## 2. The problem

"Agent-driven finance" hides a real tension:

> An LLM is great at contextual judgment — but you can **never** let a language model be the final authority on how much money to move.

Give it the keys and one hallucinated number drains the wallet. Take away all its agency and it's just a cron script with extra steps.

That tension gets sharper the moment the money isn't yours. An agent serving **many** users has to be **fair** as well as **safe**:

- each person's schedule honoured exactly,
- each person's funds ring-fenced from everyone else's,
- every allocation reconstructable after the fact,
- while still executing efficiently on-chain — not one transaction per user.

## 3. The solution — Claude *recommends*, code *decides*

The core design decision, drawn as our logo: **two orbits that never contain each other, meeting only where a decision is made.**

|  | **Claude** (the agent) | **`clampDecision()`** (the code) |
|---|---|---|
| Role | **Recommends** an amount + reasoning | **Decides** the amount actually swapped |
| Input | Balance, day count, budget, recent history | Claude's recommendation + hard guardrails |
| Output | `{ proceed, amountUsdc, reasoning }` (forced tool-use, zod-validated) | Clamped amount, or a skip with a recorded reason |
| Trust | **Never** trusted with the final number | **Sole authority**; pure function; unit-tested |

Every run records **which** constraint bound the outcome (`boundBy`) — so the audit trail is transparent about whether Claude's judgment or a hard cap drove the result.

In **Smart mode** the agent doesn't just gate the buy — it **sizes** it. A Claude sizing pass reads the market brief and proposes a multiplier; code clamps that into a hard envelope, each user's sensitivity/ceiling bounds it further, and the pooled total *still* passes through `clampDecision()`. If the sizing pass is unavailable, a deterministic dip + Fear & Greed formula takes over. **The agent's judgment moves the number — but only inside rails the code owns.**

## 4. The flagship claim — many users, one swap, fair settlement

Each wallet sets its own cadence, amount, and caps. Every run the agent:

1. computes each user's due spend,
2. executes the **sum as a single swap**,
3. distributes the received token **pro-rata by contribution** — scaling every share down together if a guardrail capped the total, assigning the rounding remainder deterministically so the books always close.

**One transaction serves everyone; nobody subsidises anyone.**

## 5. Proven on-chain — not a mockup

The part most agent projects only *describe*, ours **did** on-chain, unsupervised, on the hourly cron:

**Pooled 2-user swap** — [`0xd8a19f…1527`](https://testnet.arcscan.app/tx/0xd8a19fef1527ed91122ba29ec1ea9a845be1a7e3f3005450252f143956c07a19)

| Wallet | Contributed | Received | Share |
|---|---|---|---|
| `0xdd6045a6…` | 1.000000 USDC | 0.896977 EURC | 50.0% |
| `0xfc337ba1…` | 1.000000 USDC | 0.896976 EURC | 50.0% |

`0.896977 + 0.896976 = 1.793953` — **the books close exactly**, to the last unit. It repeated the next run. Four successful swaps recorded in total, each with its tx hash in [`data/history.json`](data/history.json).

## 6. Non-custodial by construction — both Circle wallet types

Users never hand over keys. Every state change — set schedule, run now, withdraw — is authorised by a signature the user makes in their **own** wallet, verified server-side. The agent can execute the strategy; it can **never invent a user's consent**.

We use *both* halves of Circle's wallet stack:

- The **agent** runs on a **Developer-Controlled Wallet** — Circle custodies the signing key server-side, so there's no raw private key to leak in a CI secret.
- **End users onboard with "Sign in with Google"** → a real, non-custodial **Circle User-Controlled Wallet on Arc** (MPC key custody, PIN recovery — **no MetaMask, no seed phrase**).

Proven live end-to-end: Google login → wallet created on Arc → USDC deposited via a Circle challenge → hourly DCA schedule saved.

## 7. It audits itself — on-chain

Git alone is only as trustworthy as the repo. So after each run the agent hashes the committed ledger and records `keccak256(data/ledger.json)` in [`AuraAttestation.sol`](https://testnet.arcscan.app/address/0x4948c662630c7dE36BD59089085850c00996F661), a purpose-built contract on Arc Testnet that **only the agent's wallet may write to**.

Anyone can recompute the hash from the public repo and check it against the on-chain `latestHash` — the off-chain books become **tamper-evident on-chain**. The cron has written **14+ attestations with no human in the loop**. The contract holds **no funds and touches no balances** — a bug there can't move a token.

Verify it yourself, read-only: `npm run verify-attest`.

## 8. The honest state — and why it's a strength

Open [`data/history.json`](data/history.json) and you'll see rows of `error_swap_failed`. Here it is straight:

> `USDC → cirBTC` has returned *"No route available"* on **every** attempt across 14 distinct calendar days. It's a **liquidity outage on Arc Testnet, not a bug in the agent** — `npm run check-routes` proves it's isolated to cirBTC, the only volatile asset Arc carries (the chain is stablecoin-native, down to its USDC gas token).

**The agent handled it the way we'd want.** It recognised the failures as *structural, not transient*, wrote that reasoning to its own [reflections](data/reflections.json), cut its probe frequency to stop burning fees, and **withheld spend to preserve capital** across the whole outage — unsupervised. **Knowing when *not* to act is the harder half of an autonomous money agent.**

Rather than paper over it, we made the **target token a per-user choice**: pick EURC and your buys settle live today (proven on-chain, hourly); leave it on cirBTC and the agent rides out the outage. Both halves run side by side, from the same scheduler, in the same runs.

**The bug that proves the point:** our own `dayCount()` once returned the *run* count, not distinct days — so the agent believed it was on "day 21" after a week and its reflections overstated the outage ~3×. An agent reasoning from a mislabeled number is **confidently wrong, and nothing in the output looks broken** — which is the whole argument for keeping the money-authority in tested code, not in the model. Fixed and regression-tested.

## 9. x402 — the agent pays for its own inputs

Beyond *spending* USDC to accumulate, the agent can **pay per call** for a metered input over **x402** (HTTP 402 "Payment Required") — a genuinely different money primitive, and closer to what "programmable money" means.

A request with no payment gets a `402` + payment requirements; a retry carrying a signed USDC authorization (**EIP-3009 `transferWithAuthorization`**) is cryptographically **verified** and the resource is released.

```bash
npm run x402-demo   # one command, no setup, no keys
```

**Honest scope:** the payment is signed and verified, but **settlement is gated off** — the same paper-fill honesty we applied to the cirBTC outage. The signed struct is exactly what a facilitator would settle. It's an **additive module** (`src/x402/`, 12 tests) that never touches the DCA pipeline.

## 10. Tech stack & safety architecture

- **TypeScript / Node.js**, run directly with `tsx` (no build step)
- **Anthropic Claude** — the decision engine, via forced tool-use + zod validation
- **Circle Swap Kit** + **Developer-Controlled Wallets** (agent) + **User-Controlled Wallets** (Google/email onboarding)
- **Arc Testnet** — Circle's stablecoin-native EVM L1 (gas paid in USDC)
- **Solidity** — `AuraAttestation.sol`, a fund-less on-chain audit anchor
- **GitHub Actions** cron — scheduling, secrets, and the commit-back audit trail. No server to host.
- **Vitest** — **65 unit tests** on the safety-critical paths: the `clampDecision()` guardrails, the pooled pro-rata settlement, the smart-sizing envelope, the on-chain audit hash, the outage/campaign-day arithmetic
- **Vercel** serverless functions for the dashboard's signed actions
- **Single-file dashboard** (`docs/index.html`) — EIP-6963 wallet discovery, EIP-191 signing, EN/VI, light/dark

**Two independent switches** guard live trading: `DRY_RUN` and `LIVE_TRADING_ENABLED`. Until both are set, every run defaults to dry run.

## 11. What makes it stand out

- **The hard claim is proven, not asserted** — "many users, one swap, settled pro-rata" ran on-chain, unsupervised, twice.
- **Real, verifiable execution** — not a demo video. Real swaps, real per-user distributions, green CI runs anyone can inspect.
- **Safety architecture** — the LLM-recommends / code-decides split, enforced by a tested pure function plus a two-switch live gate.
- **It audits itself on-chain** — 14+ attestations by the cron, no human involved.
- **Genuinely autonomous** — self-hosted on free CI, reasoning over its own past runs, reporting to Telegram every run.
- **Deep Circle integration — both wallet types** — agent on a Developer-Controlled Wallet, users onboard Google → User-Controlled Wallet on Arc.

## 12. What's next

- **Circle Nanopayments (x402) on-chain settlement** — first slice already shipped (verify-only); productionizing to on-chain settle via Circle Gateway is next, and the signed struct is already settlement-ready.
- **Claude-decided split across multiple volatile assets** — per-user token choice already ships; a multi-asset split unlocks the day Arc wires more than one.
- **Live P&L / cost-basis panel** — the per-token fill chart already plots the real rate paid each run.
- **Mainnet-readiness review** when Arc mainnet ships.

---

### Brand & safety

**Aura DCA is an independent project built on Arc Network — not affiliated with, endorsed by, or a product of Circle.** The product name and logo are Aura's own; Arc is referenced only in the approved factual sense. **Testnet only** — funds are valueless faucet tokens; live trading requires two explicit switches. Guardrails are enforced in code, not by the model.
