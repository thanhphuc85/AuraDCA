# Arc DCA Agent

An agentic daily dollar-cost-averaging (DCA) bot for **cirBTC** on [Arc Testnet](https://docs.arc.io) (Circle's stablecoin-native L1). Built for the Encode Club x Circle Programmable Money Hackathon.

Every day, a GitHub Actions cron job:

1. Checks the bot wallet's USDC balance on Arc Testnet.
2. Calls **Claude** (Anthropic API) to decide how much USDC to allocate to today's buy, given the remaining budget, day count, and recent trade history.
3. Clamps that recommendation against hard-coded guardrails in code (max per day, minimum reserve, minimum swap size, optional total campaign budget) — **Claude only recommends, the code decides**.
4. Executes a USDC → cirBTC swap via Circle's official [Swap Kit](https://docs.arc.io/app-kit/swap.md) SDK (the only officially documented swap path on Arc Testnet today).
5. Appends a record to [`data/history.json`](data/history.json) and commits it back to the repo, so there's a visible audit trail over time.

Arc Testnet only supports Swap Kit swaps between USDC, EURC, and cirBTC — third-party community DEXs on Arc were deliberately avoided since they don't have publicly verified contract addresses.

## Architecture

```
src/
  config.ts        env parsing (zod) + guardrail defaults
  wallet.ts         viem clients + USDC balance getters
  decision/
    prompt.ts        context + system prompt sent to Claude
    client.ts         Anthropic tool-use call, zod-validated
    guardrails.ts     clampDecision() -- the real spending authority
  swap/swapKit.ts    Circle Swap Kit execution (+ dry-run stub)
  history/store.ts   data/history.json read/append + budget math
  run.ts             orchestrator for one daily run
  index.ts           entrypoint, exit-code handling
```

## Prerequisites

- Node.js 20+
- A wallet private key (EOA). You can generate one with `node -e "console.log(require('viem/accounts').generatePrivateKey())"` after `npm install`.
- Testnet USDC for that wallet from the [Circle faucet](https://faucet.circle.com) (select Arc Testnet).
- A Swap Kit `kitKey` from the [Circle Developer Console](https://console.circle.com) (only required for real swaps, not for dry runs).
- An [Anthropic API key](https://console.anthropic.com).

## Local setup

```bash
npm install
cp .env.example .env
# fill in PRIVATE_KEY, KIT_KEY, ANTHROPIC_API_KEY

npm run typecheck
npm test

DRY_RUN=true npm start
```

A dry run performs the balance check and the real Claude decision call, but skips the actual swap and logs what *would* have happened.

## Guardrail configuration

All guardrails live in environment variables (see `.env.example`) and are enforced in [`src/decision/guardrails.ts`](src/decision/guardrails.ts), not trusted to the LLM:

| Variable | Meaning | Default |
|---|---|---|
| `MAX_DAILY_USDC` | Max USDC spend per day | `1.00` |
| `MIN_USDC_RESERVE` | USDC balance to always keep untouched | `0.50` |
| `MIN_SWAP_USDC` | Dust threshold below which a swap is skipped | `0.10` |
| `CAMPAIGN_TOTAL_BUDGET_USDC` | Optional overall cap across the whole campaign | unset |
| `CAMPAIGN_DURATION_DAYS` | Optional horizon Claude uses to pace spend | unset |
| `TOKEN_OUT` | Swap target token symbol | `cirBTC` |
| `DRY_RUN` | Skip the real swap when `true` | `true` |

## GitHub Actions setup

1. **Settings → Actions → General → Workflow permissions** → select **Read and write permissions** (required for the bot's history commit-back push).
2. **Settings → Secrets and variables → Actions → Secrets**, add:
   - `PRIVATE_KEY`
   - `KIT_KEY`
   - `ANTHROPIC_API_KEY`
3. **Settings → Secrets and variables → Actions → Variables** (optional, all have code defaults), add any of `RPC_URL`, `MAX_DAILY_USDC`, `MIN_USDC_RESERVE`, `MIN_SWAP_USDC`, `CAMPAIGN_TOTAL_BUDGET_USDC`, `CAMPAIGN_DURATION_DAYS`, `TOKEN_OUT`.
4. Set the `LIVE_TRADING_ENABLED` variable to `true` only when you're ready for the scheduled job to spend real testnet funds. Until then, both the scheduled and manual runs default to dry run — this is a deliberate second safety switch on top of the `dry_run` workflow input.

### Manual dry run

Go to the **Actions** tab → **Daily DCA Bot** → **Run workflow**, leave `dry_run` checked (default), and run it. Check the job logs and the updated `data/history.json` diff.

## Reading `data/history.json`

Each entry has a `status` field: `success` / `dry_run` for completed runs, `skipped_*` for routine no-ops (low balance, LLM declined, guardrail clamped to zero), and `error_*` for failures. `requestedAmountUsdc` is what Claude proposed; `clampedAmountUsdc` is what the guardrails actually allowed, with `boundBy` showing which constraint bound the result.

## Safety notes

- **Testnet only.** This targets Arc Testnet (chain ID `5042002`); there is no mainnet USDC or cirBTC at risk.
- The wallet is **self-custodied** via a plain EOA private key — never commit `.env` or a real key to the repo.
- Guardrails (`clampDecision`) are the sole authority on spend amounts; Claude's output is only ever a recommendation.
