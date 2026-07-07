# Arc DCA Agent — Hackathon Submission

*Encode Club × Circle — Programmable Money Hackathon (build on Arc)*

Repo: https://github.com/thanhphuc85/ArcDCA
On-chain proof: https://testnet.arcscan.app/tx/0x83097f432db9c013b3f8d7748b58f18484c2a5fde4ce500c221ee38524250933

---

## Tagline

An LLM-driven dollar-cost-averaging agent that runs itself: every day it asks Claude how much USDC to allocate, enforces hard spend limits in code, and executes a real USDC → cirBTC swap on Arc Testnet — no server, no human in the loop.

## The problem

"Agent-driven finance" is one of the hackathon's headline themes, but it hides a real tension: an LLM is great at contextual judgment, yet you can *never* let a language model be the final authority on how much money to move. Give it the keys and one hallucinated number drains the wallet. Take away all its agency and it's just a cron script with extra steps.

## What we built

A daily DCA (dollar-cost-averaging) bot for **cirBTC** on **Arc Testnet** that resolves that tension with a deliberate two-layer design:

1. **Claude decides the strategy.** On each run the agent feeds Claude the live wallet balance, day count, remaining budget, and recent trade history, then asks — via a forced, schema-validated tool call — how much USDC to buy today and why. This is genuinely agentic: Claude reads its own history, paces spending, and even declines to trade when it recognizes the daily budget is already spent.
2. **Code owns the money.** Claude's answer is only a *recommendation*. A pure, unit-tested function `clampDecision()` is the sole authority on the amount actually swapped — it re-derives the cap from hard guardrails (max/day, minimum reserve, dust threshold, optional campaign budget) and never trusts the LLM's arithmetic. Every run records which constraint bound the result, so the audit trail is transparent.

The swap itself goes through Circle's official **Swap Kit** SDK — the only officially documented, reliably-available swap path on Arc Testnet (USDC / EURC / cirBTC). The wallet is a Circle **Developer-Controlled Wallet**, so there's no raw private key to leak.

It runs entirely on a **GitHub Actions cron** — no server to host. Each run commits its result back to `data/history.json` in the repo, producing a public, tamper-evident audit trail that grows over time.

## How it works (flow)

```
GitHub Actions cron (daily)
  → read Circle wallet USDC balance on Arc Testnet
  → Claude decides: { proceed, amountUsdc, reasoning }   (forced tool-use, zod-validated)
  → clampDecision(): hard guardrails enforce the real amount
  → Circle Swap Kit: USDC → cirBTC swap (or dry-run stub)
  → append to data/history.json  →  commit back to repo
```

## Tech stack

- **TypeScript / Node.js**, run directly with `tsx` (no build step)
- **Anthropic Claude** (`@anthropic-ai/sdk`) — the decision engine, via forced tool-use + zod validation
- **Circle Swap Kit** (`@circle-fin/swap-kit`) + **Developer-Controlled Wallets** (`@circle-fin/developer-controlled-wallets`) + Circle Wallets adapter
- **Arc Testnet** (Circle's stablecoin-native EVM L1; gas paid in USDC)
- **GitHub Actions** for scheduling, secrets, and the commit-back audit trail
- **Vitest** unit tests on the safety-critical guardrail logic

## What makes it stand out

- **Real, verifiable execution** — not a demo video. There's an actual on-chain swap and green CI runs anyone can inspect.
- **Safety architecture** — the LLM-recommends / code-decides split is the whole point, and it's enforced by a tested pure function plus a two-switch live-trading gate (`DRY_RUN` + `LIVE_TRADING_ENABLED`).
- **Genuinely autonomous** — self-hosted on free CI, self-documenting via committed history, and it reasons over its own past runs.

## Challenges we ran into

- **Arc Testnet has no "real altcoin"** — community DEXs (ArcSwap/Presto/…) lacked publicly verified contract addresses, so we deliberately standardized on Circle's official Swap Kit (USDC↔EURC↔cirBTC) for a submission that actually runs.
- **Circle SDK packaging** — required Node ≥ 22 and had ESM named-export quirks that only surface on specific Node versions; pinned CI to Node 24 to match the verified runtime.
- **Empty-string config in CI** — unset GitHub Actions variables arrive as `""`, which zod's `.default()` doesn't fill; fixed with an explicit empty-to-undefined preprocess.

## What's next

- Multi-asset DCA (split across cirBTC / EURC by a Claude-decided allocation)
- Price-aware pacing once an on-chain oracle is available on Arc
- A small dashboard rendering `history.json` as a running P&L / cost-basis chart
- Mainnet-readiness review when Arc mainnet ships

## Safety note

Testnet only. Funds are valueless faucet tokens. Guardrails are enforced in code, not by the model; live trading requires two explicit switches to be enabled.
