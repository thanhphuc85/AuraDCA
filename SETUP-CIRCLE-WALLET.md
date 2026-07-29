# Phase 1 — "Sign in with Google" wallet (Circle User-Controlled Wallets on Arc)

This wires a real, non-custodial **Circle wallet** created by **Google login**, so a
user can onboard without MetaMask, then deposit USDC to the agent. The code is
scaffolded and **gated on config**: until the env vars below are set, the dashboard
keeps using the legacy demo path (deterministic address, cannot transact). Once the
three vars are present, `connectGmail()` switches to the real Circle flow
automatically.

## What the code already does
- **Backend** `api/wallet.ts` — action-based endpoint: `config`, `socialToken`,
  `initWallet` (Arc EOA), `listWallets`, `depositChallenge` (USDC → agent),
  `txStatus`. Uses the server-held `CIRCLE_API_KEY`.
- **Frontend** `docs/index.html` — loads `@circle-fin/w3s-pw-web-sdk@1.1.11` from
  esm.sh, runs Google login → wallet creation on `ARC-TESTNET`, and routes deposits
  from Circle wallets through the challenge flow.

## What YOU must do (console steps — I can't do these for you)

> Do these in order — Google first (to get the Client ID), then Circle (paste it, copy the App ID).

### 1. Google Cloud Console → OAuth client (do this FIRST)
- <https://console.cloud.google.com> → create/select a project → **Google Auth
  Platform** → complete the consent screen → **Create OAuth client** → *Web
  application*.
- **Authorized JavaScript origins**: `https://aura-dca.xyz`
- **Authorized redirect URIs**: `https://aura-dca.xyz` (+ `http://localhost:3000`
  if you test locally). **The redirect URI lives here in Google Cloud, not in
  Circle.** It must match `window.location.origin` the SDK sends.
- Copy the **Client ID**.

### 2. Circle Console → paste Client ID + copy the App ID
- Console: <https://console.circle.com> → the project whose `CIRCLE_API_KEY` the
  agent already uses (**testnet** environment).
- **Wallets → User Controlled → Configurator** — the **App ID** is shown on this page.
- On the same page: **Authentication Methods → Social Logins → Google** → paste the
  Google **Client ID** into the **"Client ID (Web)"** field.

### 3. Vercel → environment variables (Project → Settings → Environment Variables)
| Name | Value | Notes |
|---|---|---|
| `CIRCLE_API_KEY` | *(already set for the agent)* | reuse the same testnet key |
| `CIRCLE_APP_ID` | from step 2 (Circle Configurator) | public, but keep it in env |
| `GOOGLE_CLIENT_ID` | from step 1 (Google Cloud) | public |
| `AGENT_WALLET_ADDRESS` | `0x00Ebbd3aFCCaD08970ED8FdaE591244c8475a0aC` | optional; defaults to this |

> ⚠️ Do **not** paste any API **secret** or OAuth **client secret** into chat. Set
> them only in the Vercel dashboard. Only the **App ID** and **Client ID** (both
> public) are needed by the frontend, and it fetches them from `/api/wallet`.

## Verify after setup
1. Redeploy (Vercel auto-deploys on push; env changes need a redeploy).
2. Open `https://aura-dca.xyz` → **Connect Wallet → Sign in with Google**.
3. A Circle wallet is created on Arc; the address shows in the profile.
4. Fund it with testnet USDC (faucet to that address), then **Deposit to agent** —
   you'll approve the transfer in Circle's UI. It appears in the dashboard after the
   next agent run scans it (~hourly), same as MetaMask deposits.

## Known limitations (Phase 1)
- `userToken` is a short-lived session kept in memory — a page reload requires
  re-login before depositing. (Phase 2: persist/refresh via `createUserToken`.)
- Withdrawals still go through the MetaMask/SIWE path; the Circle signMessage branch
  is Phase 2.
- The Web SDK is loaded from esm.sh; if it fails to load in the browser, pin/host a
  local copy. Everything is gated, so an unconfigured deploy is unaffected.
