# Aura DCA — Architecture

> 🇻🇳 Tiếng Việt: [`architecture.vi.md`](architecture.vi.md)

Data flow & money flow of the autonomous DCA agent on Arc Network.
Core principle: **Claude *recommends*, code (`clampDecision`) *decides* the number that actually gets spent.**

```mermaid
flowchart TB
    %% ---------- Actors & Triggers ----------
    subgraph ACTORS["👤 Users &amp; Triggers"]
      direction LR
      U["User<br/><small>wallet EIP-6963 / email</small>"]
      WEB["Web Dashboard<br/><small>aura-dca.xyz · docs/index.html</small>"]
      CRON["GitHub Actions cron<br/><small>hourly · autonomous, no human</small>"]
    end

    %% ---------- API & Orchestration ----------
    subgraph API["⚙️ API &amp; Orchestration"]
      direction LR
      VERCEL["Vercel serverless · api/*.ts<br/><small>chat · set-dca-rate · run-dca · withdraw<br/>each action signed EIP-191, verified server-side</small>"]
      RUN["run.ts orchestrator<br/><small>per-user ledger · schedule / pooled / allowance</small>"]
    end

    %% ---------- AI Logic ----------
    subgraph AI["🧠 AI Logic — Claude · multi-agent (RECOMMENDS only)"]
      direction LR
      ANALYST["Market Analyst<br/><small>analyst.ts</small>"]
      SIZING["Smart sizing<br/><small>sizing.ts</small>"]
      DECIDE["Decision / commentary<br/><small>client.ts · forced tool-use · zod</small>"]
      REFLECT["Reflection memory<br/><small>reflect.ts → reflections.json</small>"]
    end

    %% ---------- Guardrail gate ----------
    GUARD{{"🔒 GUARDRAIL — clampDecision·guardrails.ts<br/>SOLE authority over the real spend<br/>re-derives cap from hard rules · records boundBy"}}

    %% ---------- Payments & Execution ----------
    subgraph EXEC["💸 Payments &amp; Execution"]
      direction LR
      X402["x402 · agent.ts <small>(additive · gated)</small><br/><small>pays for brief · EIP-3009 sign/verify<br/>smartFee · Circle Gateway settle</small>"]
      SWAP["Circle Swap Kit · swapKit.ts<br/><small>one pooled swap / token · split pro-rata</small>"]
      WALLET["Circle Dev-Controlled Wallet · wallet.ts<br/><small>key custodied server-side</small>"]
    end

    %% ---------- Arc chain ----------
    subgraph ARC["⛓️ Arc Chain — Arc Testnet"]
      direction LR
      SWAPTX["USDC → EURC / cirBTC"]
      ATTEST["AuraAttestation.sol<br/><small>on-chain audit anchor</small>"]
      SCAN["ArcScan explorer"]
    end

    %% ---------- Audit & Notify ----------
    subgraph AUDIT["📓 Audit &amp; Notify"]
      direction LR
      HIST["data/history.json<br/><small>committed back to the repo</small>"]
      NOTIFY["Telegram / Discord push<br/><small>OUTBOUND-only, not interactive</small>"]
    end

    %% ---------- Edges ----------
    U --> WEB --> VERCEL
    CRON --> RUN
    VERCEL --> RUN
    RUN -. "context" .-> AI
    AI -. "recommends" .-> GUARD
    RUN == "live spend request" ==> GUARD
    GUARD == "clamped amount" ==> SWAP
    RUN -. "pay-per-call" .-> X402
    SWAP --> WALLET
    X402 --> WALLET
    WALLET ==> SWAPTX
    SWAPTX --> SCAN
    RUN --> ATTEST
    SWAPTX --> HIST
    HIST --> NOTIFY
    HIST -. "track record" .-> WEB

    %% ---------- Styling ----------
    classDef gate fill:#f5a524,stroke:#b45309,color:#1a1200,font-weight:bold;
    class GUARD gate;
```

## Reading the diagram

| Symbol | Meaning |
|---|---|
| **Bold solid** (`==>`) | Authoritative money flow: request → guardrail → swap → chain |
| **Dashed** (`-.->`) | Advisory / additive: AI only recommends, x402 pay-per-call, feedback to the dashboard |
| 🔒 Amber block | `clampDecision()` — the safety gate where the LLM's *judgment* and the code's *guardrails* intersect |

**Two real entry points:** the Web Dashboard (user-initiated) and the GitHub Actions cron (autonomous, hourly).
Telegram/Discord are **outbound push notifications only** — not an interactive bot.
