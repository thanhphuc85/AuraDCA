#!/usr/bin/env bash
# Vercel "Ignored Build Step" for Aura DCA.
#
# Exit code contract (Vercel): exit 1 => BUILD proceeds; exit 0 => build is SKIPPED.
#
# Why: the hourly DCA cron commits ONLY data/*.json ("chore: record DCA run …").
# Nothing in the Vercel deployment reads those files — the frontend fetches the
# ledger/history from raw.githubusercontent.com at runtime, and the API functions
# read it via the GitHub API (readLedgerFromGitHub). So a data-only commit changes
# no served asset; deploying it just burns the Hobby deploy quota (~96/day) and
# slows real code deploys. This skips the deploy for data-only commits and builds
# for everything else (src, docs, api, config).
#
# Set this as the project's Ignored Build Step command:
#   bash scripts/vercel-ignore-build.sh

set -u

# Fail SAFE: if we can't compute a diff (missing parent in a shallow clone, first
# commit, detached weirdness), build rather than risk skipping a real change.
if ! git rev-parse HEAD^ >/dev/null 2>&1; then
  echo "vercel-ignore: no parent commit available — building to be safe."
  exit 1
fi

CHANGED="$(git diff --name-only HEAD^ HEAD)"
echo "vercel-ignore: files changed in HEAD:"
echo "${CHANGED:-<none>}"

if [ -z "$CHANGED" ]; then
  # An empty commit (`git commit --allow-empty`) also lands here and is skipped,
  # so it can't be used to force a redeploy — push a real non-data change instead.
  echo "vercel-ignore: no file changes — skipping deploy."
  exit 0
fi

# If ANY changed path is outside data/, a real asset may have changed → BUILD.
if echo "$CHANGED" | grep -qvE '^data/'; then
  echo "vercel-ignore: non-data changes present — building."
  exit 1
fi

echo "vercel-ignore: only data/ changed (cron ledger record) — skipping deploy."
exit 0
