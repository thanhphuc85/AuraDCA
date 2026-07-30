import type { VercelRequest, VercelResponse } from "@vercel/node";

// Reliable scheduling shim.
//
// The DCA swap itself MUST run on the GitHub Actions runner: Circle Swap Kit
// loads fine there but throws "require() of ES Module" inside Vercel's
// serverless bundler (the same reason api/run-dca.ts can't settle). So this
// endpoint does NOT execute a swap — it only fires a `workflow_dispatch` at the
// dca.yml workflow, keeping the working executor and replacing the one flaky
// part: GitHub's own `schedule:` trigger, which delays and silently drops a
// large fraction of ticks (worst at the top of the hour). An always-on external
// cron (Vercel Cron, or cron-job.org) hits this every few minutes so each user's
// UTC-bucket schedule gets a dependable chance to fire.
//
// Firing more often than needed is safe: isDueNow() in src/ledger/schedule.ts
// buckets every cadence to UTC and fires each user at most once per bucket, and
// the workflow's `concurrency: daily-dca` group serializes overlapping runs — so
// extra dispatches never double-charge.

const GITHUB_OWNER = "thanhphuc85";
const GITHUB_REPO = "AuraDCA";
const WORKFLOW = "dca.yml";
const REF = "main";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Only Vercel Cron (or a caller that knows CRON_SECRET) may trigger a live
  // run. Vercel attaches `Authorization: Bearer $CRON_SECRET` to cron requests
  // when the CRON_SECRET env var is set; an external cron must send the same.
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) { res.status(500).json({ error: "Server misconfigured: missing CRON_SECRET" }); return; }
  if (req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: "Unauthorized" }); return; }

  const token = process.env.GH_PAT?.trim();
  if (!token) { res.status(500).json({ error: "Server misconfigured: missing GH_PAT" }); return; }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW}/dispatches`;
  let ghRes: Response;
  try {
    ghRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "aura-dca-trigger",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      // dry_run:false asks for a live run, but the workflow's own guard still
      // requires vars.LIVE_TRADING_ENABLED === "true" — so this can never trade
      // unless that second switch is deliberately on. No safety is relaxed here.
      body: JSON.stringify({ ref: REF, inputs: { dry_run: "false" } }),
    });
  } catch (err) {
    res.status(502).json({ error: "Dispatch request failed: " + (err instanceof Error ? err.message : String(err)) });
    return;
  }

  // A successful workflow_dispatch returns 204 No Content.
  if (ghRes.status !== 204) {
    const body = await ghRes.text();
    res.status(502).json({ error: `GitHub dispatch failed: ${ghRes.status} ${body}` });
    return;
  }

  res.status(202).json({ dispatched: true, workflow: WORKFLOW, ref: REF });
}
