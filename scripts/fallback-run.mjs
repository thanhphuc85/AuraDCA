#!/usr/bin/env node
// Standalone fallback executor for Aura DCA.
//
// WHY: the DCA swap can only run on a GitHub-Actions-style Node runtime — Circle
// Swap Kit throws "require() of ES Module" inside Vercel's serverless bundler, so
// api/trigger-dca can only *fire* the GH workflow, not execute a swap. That means
// when GitHub Actions itself is down (a runner/control-plane outage), NO trigger
// can help and DCA stalls. This script is the only path that runs the real bot on
// DIFFERENT infrastructure (your PC or a VPS), independent of GitHub Actions.
//
// SAFETY: it is a *fallback*, not a parallel runner. It first asks the GitHub
// Actions API whether the primary path is healthy and only takes over when GitHub
// has been silent/failing for longer than FALLBACK_STALE_MIN (default 45 min).
// Combined with isDueNow()'s UTC-bucket idempotency (each user fires at most once
// per bucket) and the rebase-retry push below, a brief overlap can't silently
// double-charge. Keep STALE_MIN generous so the window where both could fire is
// tiny.
//
// SETUP: put the same secrets the GH workflow uses into a `.env` at the repo root
// (git-ignored) — CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, WALLET_ID, KIT_KEY,
// ANTHROPIC_API_KEY, DRY_RUN, TELEGRAM_*, X402_*, GH_PAT (for the health check &
// push), etc. Then schedule `npm run dca:fallback` every ~15 min (Windows Task
// Scheduler / cron). src/config.ts loads .env via dotenv, and so does this script.
//
// Run:  node scripts/fallback-run.mjs   (or: npm run dca:fallback)

import "dotenv/config";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STALE_MIN = Number(process.env.FALLBACK_STALE_MIN || 45);
const OWNER = "thanhphuc85";
const NAME = "AuraDCA";
const WORKFLOW = "dca.yml";

const log = (m) => console.log(`[fallback ${new Date().toISOString()}] ${m}`);
const sh = (cmd) => execSync(cmd, { cwd: REPO, stdio: "pipe", encoding: "utf8" }).trim();
const shTry = (cmd) => { try { return sh(cmd); } catch (e) { log(`\`${cmd}\` failed: ${(e.stderr || e.message || "").toString().trim()}`); return null; } };

// --- 0. Start from the latest committed state so our ledger read is current. ---
shTry("git pull --rebase --autostash origin main");

// --- 1. Is the GitHub Actions primary path healthy? ---
// Healthy = a run was created within STALE_MIN AND the recent completed runs
// aren't all failing. Prefer the Actions API (a token gives a true health signal);
// fall back to history.json recency when no token is available.
function historyFresh() {
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(REPO, "data/history.json"), "utf8"));
    const last = Array.isArray(rows) ? rows[rows.length - 1] : null;
    if (!last?.timestamp) return false;
    const ageMin = (Date.now() - new Date(last.timestamp).getTime()) / 60000;
    log(`last recorded run ${ageMin.toFixed(0)}m ago (threshold ${STALE_MIN}m).`);
    return ageMin <= STALE_MIN;
  } catch { return false; }
}

async function githubHealthy() {
  const token = (process.env.GH_PAT || process.env.GITHUB_TOKEN || "").trim();
  if (!token) { log("no GH_PAT → using history.json recency for the health check."); return historyFresh(); }
  let runs;
  try {
    const r = await fetch(
      `https://api.github.com/repos/${OWNER}/${NAME}/actions/workflows/${WORKFLOW}/runs?per_page=5`,
      { headers: { Authorization: `Bearer ${token}`, "User-Agent": "auradca-fallback", Accept: "application/vnd.github+json" } },
    );
    if (!r.ok) { log(`Actions API ${r.status} → history.json recency.`); return historyFresh(); }
    runs = (await r.json()).workflow_runs || [];
  } catch (e) { log(`Actions API error (${e.message}) → history.json recency.`); return historyFresh(); }

  if (!runs.length) { log("no workflow runs found → treating GH as down."); return false; }
  const ageMin = (Date.now() - new Date(runs[0].created_at).getTime()) / 60000;
  if (ageMin > STALE_MIN) { log(`latest Actions run ${ageMin.toFixed(0)}m ago (> ${STALE_MIN}m) → GH not scheduling.`); return false; }
  const completed = runs.filter((x) => x.status === "completed").slice(0, 3);
  if (completed.length >= 2 && completed.every((x) => x.conclusion === "failure")) {
    log("last completed runs all FAILED (e.g. no runner acquired) → GH degraded.");
    return false;
  }
  log(`GitHub Actions healthy (latest run ${ageMin.toFixed(0)}m ago).`);
  return true;
}

if (await githubHealthy()) {
  log("Primary path OK — skipping fallback to avoid a duplicate run.");
  process.exit(0);
}

// --- 2. Take over: run the real bot exactly like the workflow does. ---
log("Primary path DOWN — running the DCA bot locally as fallback.");
const run = spawnSync("npx", ["tsx", "src/index.ts"], {
  cwd: REPO,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32", // resolve `npx.cmd` on Windows
});
if (run.status !== 0) log(`bot exited with code ${run.status} — committing whatever state changed.`);

// --- 3. Commit + push data, mirroring the workflow (skip if nothing changed; rebase-retry). ---
// Identity is passed per-commit with `-c` so we never mutate the user's repo
// git config (this runs on their persistent machine, not an ephemeral runner).
const IDENT = `-c user.name="auradca-fallback" -c user.email="auradca-fallback@users.noreply.github.com"`;
sh("git add data/history.json data/reflections.json data/ledger.json data/prices.json");
if (!sh("git diff --cached --name-only")) { log("no data changes to commit."); process.exit(0); }
sh(`git ${IDENT} commit -m "chore: fallback DCA run ${new Date().toISOString().slice(0, 10)}"`);

for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    sh("git push origin HEAD:main");
    log(`pushed on attempt ${attempt}.`);
    process.exit(0);
  } catch {
    log(`push rejected (attempt ${attempt}) — rebasing onto latest main and retrying.`);
    shTry("git pull --rebase origin main");
  }
}
log("push failed after 5 attempts — the run is committed locally but not on main; resolve manually.");
process.exit(1);
