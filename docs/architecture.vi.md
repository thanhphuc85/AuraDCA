# Aura DCA — Sơ đồ kiến trúc

> 🇬🇧 English: [`architecture.md`](architecture.md)

Luồng dữ liệu & luồng tiền của agent DCA tự động trên Arc Network.
Nguyên tắc cốt lõi: **Claude *khuyến nghị*, code (`clampDecision`) *quyết định* con số thật sự được chi.**

```mermaid
flowchart TB
    %% ---------- Actors & Triggers ----------
    subgraph ACTORS["👤 Người dùng &amp; Trigger"]
      direction LR
      U["User<br/><small>wallet EIP-6963 / email</small>"]
      WEB["Web Dashboard<br/><small>aura-dca.xyz · docs/index.html</small>"]
      CRON["GitHub Actions cron<br/><small>mỗi giờ · tự động, không người</small>"]
    end

    %% ---------- API & Orchestration ----------
    subgraph API["⚙️ API &amp; Orchestration"]
      direction LR
      VERCEL["Vercel serverless · api/*.ts<br/><small>chat · set-dca-rate · run-dca · withdraw<br/>mỗi action ký EIP-191, verify server-side</small>"]
      RUN["run.ts orchestrator<br/><small>per-user ledger · schedule / pooled / allowance</small>"]
    end

    %% ---------- AI Logic ----------
    subgraph AI["🧠 AI Logic — Claude · multi-agent (chỉ KHUYẾN NGHỊ)"]
      direction LR
      ANALYST["Market Analyst<br/><small>analyst.ts</small>"]
      SIZING["Smart sizing<br/><small>sizing.ts</small>"]
      DECIDE["Decision / commentary<br/><small>client.ts · forced tool-use · zod</small>"]
      REFLECT["Reflection memory<br/><small>reflect.ts → reflections.json</small>"]
    end

    %% ---------- Guardrail gate ----------
    GUARD{{"🔒 GUARDRAIL — clampDecision·guardrails.ts<br/>Quyền quyết định DUY NHẤT số tiền thật<br/>re-derive cap từ hard rules · ghi boundBy"}}

    %% ---------- Payments & Execution ----------
    subgraph EXEC["💸 Payments &amp; Execution"]
      direction LR
      X402["x402 · agent.ts <small>(bổ sung · gated)</small><br/><small>trả phí brief · EIP-3009 sign/verify<br/>smartFee · Circle Gateway settle</small>"]
      SWAP["Circle Swap Kit · swapKit.ts<br/><small>1 pooled swap / token · chia pro-rata</small>"]
      WALLET["Circle Dev-Controlled Wallet · wallet.ts<br/><small>key custody server-side</small>"]
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
      HIST["data/history.json<br/><small>commit back vào repo</small>"]
      NOTIFY["Telegram / Discord push<br/><small>OUTBOUND-only, không tương tác</small>"]
    end

    %% ---------- Edges ----------
    U --> WEB --> VERCEL
    CRON --> RUN
    VERCEL --> RUN
    RUN -. "context" .-> AI
    AI -. "recommends" .-> GUARD
    RUN == "live spend request" ==> GUARD
    GUARD == "số tiền đã clamp" ==> SWAP
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

## Đọc sơ đồ

| Ký hiệu | Ý nghĩa |
|---|---|
| **Nét liền đậm** (`==>`) | Luồng tiền có thẩm quyền: request → guardrail → swap → chain |
| **Nét đứt** (`-.->`) | Cố vấn / bổ sung: AI chỉ khuyến nghị, x402 pay-per-call, feedback về dashboard |
| 🔒 Khối cam | `clampDecision()` — chốt an toàn, nơi *phán đoán của LLM* và *guardrail của code* giao nhau |

**Hai entry point thật:** Web Dashboard (người dùng chủ động) + GitHub Actions cron (tự động mỗi giờ).
Telegram/Discord **chỉ nhận thông báo outbound**, không phải bot tương tác.
