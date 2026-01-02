#!/bin/bash

set -euo pipefail

# Initialize a clean git repo for whizzCentralPlatform-stg and push to GitHub.
# This script intentionally does NOT handle GitHub repo creation (do that in GitHub UI first).

REPO_URL="${REPO_URL:-https://github.com/whizzgo/whizzCentralPlatform-stg.git}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-staging}"

cd "$(dirname "$0")"

if ! command -v git >/dev/null 2>&1; then
  echo "❌ Missing git"
  exit 1
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ℹ️ Already a git repo. Skipping git init."
else
  echo "🧱 Initializing git repo"
  git init
fi

# Ensure we have the right branch name
current_branch="$(git branch --show-current 2>/dev/null || true)"
if [[ -z "$current_branch" ]]; then
  git checkout -b "$DEFAULT_BRANCH"
elif [[ "$current_branch" != "$DEFAULT_BRANCH" ]]; then
  # Create/checkout the requested branch
  if git show-ref --verify --quiet "refs/heads/${DEFAULT_BRANCH}"; then
    git checkout "$DEFAULT_BRANCH"
  else
    git checkout -b "$DEFAULT_BRANCH"
  fi
fi

# Sanity: show ignored env patterns
if [[ -f .gitignore ]]; then
  echo "✅ Using .gitignore (env files and frontend/env.js are ignored)"
else
  echo "⚠️ No .gitignore found. Aborting to avoid committing secrets."
  exit 1
fi

# Stage and commit
echo "➕ Adding files"
git add -A

if git diff --cached --quiet; then
  echo "ℹ️ Nothing to commit"
else
  echo "✅ Creating initial commit"
  git commit -m "chore(staging): initial whizzCentralPlatform-stg snapshot"
fi

# Set remote
if git remote get-url origin >/dev/null 2>&1; then
  echo "ℹ️ Remote 'origin' already set: $(git remote get-url origin)"
else
  echo "🔗 Setting remote origin: ${REPO_URL}"
  git remote add origin "$REPO_URL"
fi

echo "🚀 Pushing ${DEFAULT_BRANCH} to origin"
git push -u origin "$DEFAULT_BRANCH"

echo "✅ Done"
echo "Next: connect Amplify to GitHub repo using connect-amplify-to-github-staging.sh"
