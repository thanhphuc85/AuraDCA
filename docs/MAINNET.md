# Arc mainnet cutover runbook

> **Status (2026-09-16): Arc mainnet is in the _Private Mainnet_ phase — permissioned.**
> The mainnet RPC and explorer require credentials granted by Circle, and mainnet
> gas USDC is requested through your Circle point of contact. Until you have that
> access you **cannot** connect to mainnet, no matter what config you set.
>
> **This is real money.** Turning `DRY_RUN` off on mainnet moves real funds. That
> final step is yours to take — not something this repo or Claude does for you.
> This document is preparation only; nothing here activates mainnet.

The network config is already env-parameterized (see [`.env.example`](../.env.example)
and PR #32), so the switch is a config change, not a code change — **once the
prerequisites below are met.**

---

## Quick path: prove ONE mainnet transaction

If all you need is a **single real tx proving the dapp runs on Arc mainnet** (not a
full production migration), use the proof script — no ledger changes, no
`TOKEN_OUT`/strategy change. You need a Circle DCW wallet on Arc mainnet
(blockchain `ARC`) funded with a little real USDC, plus your Circle credentials
(`CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `WALLET_ID`, `KIT_KEY`) in `.env`.

```bash
# 1. Dry run first — quotes only, spends nothing, confirms the route is live:
npm run prove-swap -- --mainnet

# 2. Execute ONE real swap — spends real USDC (this is the money step, your call):
npm run prove-swap -- --mainnet --execute 0.5 EURC
```

The printed tx hash / `https://explorer.arc.io/tx/…` link is your proof. The
script does **not** touch `data/ledger.json` or `data/history.json`. Full
production DCA on mainnet is the larger effort described below.

---

## 1. Prerequisites (all required before mainnet is even reachable)

- [ ] **Private-mainnet access + RPC credentials** from Circle (request via the Arc
      "Private mainnet" page / your Circle contact).
- [ ] **A new Circle Developer-Controlled Wallet on mainnet** (blockchain id `ARC`,
      not `ARC-TESTNET`). The testnet wallet/agent address does **not** carry over.
- [ ] **Confirmation that Circle DCW + Swap Kit support Arc mainnet** (blockchain id
      `ARC`, and a Swap Kit route for your target token).
- [ ] **Real USDC** funded into that mainnet wallet (gas + swap budget).
- [ ] A **mainnet `KIT_KEY`** (Swap Kit) and **`WALLET_ID`** from the Circle console.
- [ ] Decide the **target token** — see the cirBTC caveat in §4.

---

## 2. Verified mainnet parameters (from docs.arc.io)

| Value | Mainnet | (Testnet, for reference) |
| --- | --- | --- |
| Chain ID | `5042` | `5042002` |
| RPC (Circle, permissioned) | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Explorer (permissioned) | `https://explorer.arc.io` | `https://explorer.testnet.arc.io` |
| USDC | `0x3600000000000000000000000000000000000000` | same (native) |
| EURC | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` | `0x89b50855aa3be2f677cd6303cec089b5f319d72a` |
| cirBTC | **not listed on mainnet** | `0xf0c4a4ce82a5746abaad9425360ab04fbba432bf` |

> Note: the repo's current testnet defaults are the older `rpc.testnet.arc.network`
> / `testnet.arcscan.app`. Docs have since moved to `rpc.testnet.arc.io` /
> `explorer.testnet.arc.io`. Both work today; worth aligning eventually.

---

## 3. Backend env for mainnet

Set these (in `.env` or GitHub Actions secrets/variables). Leave every other var
at its default. **Keep `DRY_RUN=true` until you have done a successful dry run** —
the very last line is the only real-money switch, and it is your call.

```bash
# --- Arc mainnet network ---
ARC_CIRCLE_BLOCKCHAIN=ARC
ARC_RPC_URL=https://rpc.mainnet.arc.io        # permissioned — needs Circle credentials
ARC_CHAIN_ID=5042
ARC_EXPLORER_URL=https://explorer.arc.io
ARC_USDC_CONTRACT=0x3600000000000000000000000000000000000000
ARC_EURC_CONTRACT=0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1
# ARC_CIRBTC_CONTRACT — leave UNSET (no cirBTC on mainnet)
ARC_AGENT_ADDRESS=0xYOUR_NEW_MAINNET_AGENT_WALLET
ARC_X402_NETWORK=arc                          # confirm exact id with Circle
ARC_X402_CAIP2=eip155:5042

# --- Circle credentials (mainnet) ---
WALLET_ID=your_mainnet_wallet_id
KIT_KEY=your_mainnet_swap_kit_key             # required once DRY_RUN=false

# --- What the agent buys ---
TOKEN_OUT=EURC                                # cirBTC is not on mainnet (see §4)

# --- Real-money switch: keep true until you are ready. Flipping to false = LIVE. ---
DRY_RUN=true
```

The money-path guardrails (`MAX_DAILY_USDC`, `MIN_USDC_RESERVE`, `MIN_SWAP_USDC`,
optional `CAMPAIGN_*`) are unchanged by the network switch — review them for
real-money sizing before going live.

---

## 4. cirBTC is not on Arc mainnet

Arc mainnet lists **USDC, EURC, USYC** only — there is no cirBTC. So:

- Set **`TOKEN_OUT=EURC`** (USYC needs allowlisting + a $100k minimum — not viable).
- Before mainnet, **remove cirBTC** from `SUPPORTED_DCA_TOKENS`
  ([`src/ledger/constants.ts`](../src/ledger/constants.ts)) and from the dashboard's
  token pickers, so no user can select a token with no mainnet route.

---

## 5. Frontend (static dashboard)

The dashboard reads its network config from
[`docs/js/network.js`](js/network.js), overridable via `window.ARC_NET`. To point
the static site at mainnet without editing the module, add this **before** the
module loads (e.g. an inline `<script>` in `<head>` of `docs/index.html`):

```html
<script>
  window.ARC_NET = {
    chainIdHex: "0x13b2",                                 // 5042
    chainName: "Arc",
    rpc: "https://rpc.mainnet.arc.io",                    // permissioned
    explorer: "https://explorer.arc.io",
    usdc: "0x3600000000000000000000000000000000000000",
    eurc: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    agent: "0xYOUR_NEW_MAINNET_AGENT_WALLET",
  };
</script>
```

---

## 6. Known gaps to close before go-live

1. **Withdrawal token enum** — `WITHDRAWAL_TOKEN` is `["USDC", "cirBTC"]`
   ([`src/config.ts`](../src/config.ts)). To let users withdraw EURC on mainnet,
   add `EURC` to that enum + the withdraw path.
2. **AuraAttestation** — the audit-anchor contract is deployed on testnet only. To
   keep attestations on mainnet, re-deploy `contracts/AuraAttestation.sol` on Arc
   mainnet and set `ATTESTATION_CONTRACT` to the new address (or leave
   `ATTESTATION_ENABLED=false`).
3. **x402 subsystem** — confirm the mainnet `ARC_X402_NETWORK` id and Gateway
   support with Circle before enabling any x402 settlement on mainnet.
4. **Circle SDK support** — confirm `@circle-fin/developer-controlled-wallets` and
   `@circle-fin/swap-kit` accept the `ARC` mainnet blockchain id.

---

## 7. Go-live sequence (when access + funds are in place)

1. Set the §3 env with `DRY_RUN=true`; run once and confirm the log shows the
   correct network, wallet, balance, and the intended EURC route.
2. Fund the mainnet wallet with a **small** USDC amount first.
3. Set `DRY_RUN=false` **(this is the real-money switch — your action)** and run a
   single small buy. Verify the tx on `https://explorer.arc.io`.
4. Only then raise guardrail limits / enable the cron on mainnet.

**Rollback:** unset the `ARC_*` env (or set `DRY_RUN=true`) — defaults revert to
testnet, no code change needed.
