#!/bin/bash
set -euo pipefail

# Only run in remote (web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install gh CLI (skip if already present)
if ! command -v gh &>/dev/null; then
  apt-get update -qq
  apt-get install -y -qq gh > /dev/null
fi

# Install npm dependencies (remote containers may not have them cached)
if [ ! -d "$CLAUDE_PROJECT_DIR/node_modules" ]; then
  cd "$CLAUDE_PROJECT_DIR" && npm install --prefer-offline 2>/dev/null
fi

# Warn if gh is not authenticated (surface early, not on first gh pr create)
if ! gh auth status &>/dev/null; then
  echo "WARNING: gh CLI is installed but not authenticated. Run 'gh auth login' if needed."
fi

