#!/bin/bash
# Push the Zephyr repo to GitHub.
# Usage: GITHUB_TOKEN=ghp_xxx ./scripts/push.sh [repo-name]
set -eu
REPO=${1:-zephyr-browser}
OWNER=${GITHUB_OWNER:-salim77007j}
cd "$(dirname "$0")/.."

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "error: GITHUB_TOKEN is not set" >&2
  echo "usage: GITHUB_TOKEN=ghp_xxx $0" >&2
  exit 1
fi

AUTH="Authorization: token ${GITHUB_TOKEN}"
ACCEPT="Accept: application/vnd.github+json"

# create the repo if it does not exist
CODE=$(curl -s -o /tmp/repo-check.json -w "%{http_code}" \
  -H "$AUTH" -H "$ACCEPT" \
  "https://api.github.com/repos/${OWNER}/${REPO}")
if [ "$CODE" = "404" ]; then
  echo "creating ${OWNER}/${REPO} (public)…"
  curl -s -H "$AUTH" -H "$ACCEPT" \
    -d "{\"name\":\"${REPO}\",\"description\":\"Zephyr — privacy-first, ultra-light browser built in Rust\",\"private\":false,\"has_issues\":true}" \
    https://api.github.com/user/repos > /tmp/repo-create.json
  echo "created"
fi

# configure the remote with the token (never printed)
git remote remove origin 2>/dev/null || true
git remote add origin "https://${OWNER}:${GITHUB_TOKEN}@github.com/${OWNER}/${REPO}.git"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push -u origin "${BRANCH}" --force-with-lease=origin/"${BRANCH}" 2>/dev/null || git push -u origin "${BRANCH}"
echo "pushed ${BRANCH} -> github.com/${OWNER}/${REPO}"
echo "CI: https://github.com/${OWNER}/${REPO}/actions"
