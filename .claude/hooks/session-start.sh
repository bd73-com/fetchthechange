#!/bin/bash
set -euo pipefail

# Only run in remote (web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install gh CLI if not already installed
if ! command -v gh &>/dev/null; then
  apt-get update -qq
  apt-get install -y -qq gh
fi

# Install project dependencies
cd "$CLAUDE_PROJECT_DIR"
npm install
