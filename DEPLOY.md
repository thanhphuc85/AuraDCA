# Deploy to Vercel (dashboard + real-time withdrawals)

The dashboard (`docs/`) and the withdrawal API (`api/withdraw.ts`) ship in **one**
Vercel deployment. Because they share an origin, the frontend calls
`/api/withdraw` directly — no URL to paste anywhere.

## 1. Create a GitHub token (GH_PAT)

The withdrawal API commits balance updates to `data/ledger.json`, so it needs a
token with write access to this repo.

1. https://github.com/settings/personal-access-tokens/new (fine-grained)
2. Repository access → **Only select repositories** → `thanhphuc85/AuraDCA`
3. Permissions → Repository permissions → **Contents: Read and write**
4. Generate and copy the `github_pat_...` value.

## 2. Import the repo into Vercel

1. https://vercel.com → sign in with GitHub → **Add New… → Project**
2. Import `thanhphuc85/AuraDCA`
3. **Framework Preset: Other** · Build Command: *(empty)* · Output Directory: *(empty)*
   (`vercel.json` already rewrites `/` to `docs/` and keeps `/api/*` as functions.)

## 3. Environment variables

| Vercel env var | Required for | Value |
| --- | --- | --- |
| `GH_PAT` | ledger writes (all signed actions) | the token from step 1 |
| `CIRCLE_API_KEY` | withdraw, run-dca | same value as GitHub secret `CIRCLE_API_KEY` |
| `CIRCLE_ENTITY_SECRET` | withdraw, run-dca | same as GitHub secret `CIRCLE_ENTITY_SECRET` |
| `CIRCLE_WALLET_ID` | withdraw, run-dca | same value as GitHub secret **`WALLET_ID`** |
| `ANTHROPIC_API_KEY` | chat assistant (`/api/chat`) | same as GitHub secret `ANTHROPIC_API_KEY` |
| `ANTHROPIC_BASE_URL` | chat assistant (`/api/chat`) | **only if** the DCA cron uses a proxy — same value as GitHub **variable** `ANTHROPIC_BASE_URL` |
| `KIT_KEY` | on-demand swap (`/api/run-dca`) | same as GitHub secret `KIT_KEY` |
| `RESEND_API_KEY` | welcome email (`/api/send-welcome`) | key from [resend.com](https://resend.com/api-keys) |

> The Circle wallet id is named `WALLET_ID` in the GitHub Actions workflow but
> `CIRCLE_WALLET_ID` here. The API accepts **either** name, so setting `WALLET_ID`
> on Vercel also works — but `CIRCLE_WALLET_ID` is preferred for clarity.
>
> The first four are enough for withdrawals; add `ANTHROPIC_API_KEY`, `KIT_KEY`,
> and `RESEND_API_KEY` to enable the chat assistant, on-demand DCA, and the
> welcome email respectively. Each feature degrades gracefully if its key is absent.
>
> If the DCA cron routes Claude through a proxy via `ANTHROPIC_BASE_URL` (a GitHub
> Actions **variable**, not a secret), set the **same** value on Vercel too —
> otherwise `/api/chat` keeps hitting `api.anthropic.com` with a key scoped to the
> proxy and every message fails with a 503 *"The assistant is temporarily
> unavailable."* The chat and the cron must point at the same Anthropic host.
>
> **Applying an env-var change:** env vars are baked into a deployment at deploy
> time, so an existing deployment won't see a new/changed value — you need a fresh
> deployment created *after* the change. Note the Ignored Build Step
> ([`scripts/vercel-ignore-build.sh`](scripts/vercel-ignore-build.sh)) **cancels**
> a redeploy whose commit only touched `data/` (every `chore: record DCA run …`
> cron commit is data-only), so "Redeploy" on one of those is skipped and the env
> change never lands. Force a real build by pushing a commit that changes a
> non-`data/` file (any code/config/docs edit), or run `vercel --prod --force`.

## 4. Deploy & test

1. Click **Deploy** (~1 min). You get a URL like `https://aura-dca.vercel.app`.
   - Dashboard: `/`
   - Withdrawal API: `/api/withdraw`
2. Open the dashboard, connect a wallet, go to **My Position → Withdraw**, enter an
   amount, sign the message, and the tokens arrive in ~10–30s.
3. Leave the **Settings → Withdrawal API URL** field **empty** — it defaults to this
   site's own `/api/withdraw`.

Use the Vercel URL in place of the old GitHub Pages link once it works.

## 5. The hourly cron vs. the Hobby deploy limit — deploy via CLI

The DCA cron commits `data/*.json` every run ("chore: record DCA run …"), ~96×/day.
Nothing in the deployment reads those files (the frontend fetches the ledger/history
from `raw.githubusercontent.com` at runtime; the API reads it via the GitHub API), so
those commits never need a rebuild.

An **Ignored Build Step** (`scripts/vercel-ignore-build.sh`) skips the *build* for
data-only commits, but on Hobby the **deployment is still created and still counts**
toward the **100-deployments/day** cap — so ~96 cron pushes/day exhaust the quota on
their own and real deploys start failing with *"Resource is limited … more than 100,
api-deployments-free-per-day."*

**Fix — stop the cron from creating deployments at all:** `vercel.json` sets

```json
"git": { "deploymentEnabled": { "main": false } }
```

which tells Vercel to create **no** deployment for any push to `main`. The cron then
costs zero quota. (The Ignored Build Step is now redundant but harmless.)

**Deploy the site with the Vercel CLI** (a direct deploy — not git-triggered — so it
is unaffected by the setting above, and it can't be raced/superseded by a cron commit):

```bash
npx vercel --prod --scope dca-agent
```

First run only: `npx vercel login`, then `npx vercel link` to the `aura-dca` project.
CLI deploys still count toward the 100/day cap, but a handful of real deploys is far
under it once the cron no longer contributes.
