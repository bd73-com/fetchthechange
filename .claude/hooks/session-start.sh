#!/bin/bash
set -euo pipefail

# Only run in remote (web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Skip if gh is already installed (cached container)
if command -v gh &>/dev/null; then
  exit 0
fi

# Install gh CLI
apt-get update -qq
apt-get install -y -qq gh > /dev/null 2>&1
