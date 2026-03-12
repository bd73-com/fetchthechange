---
applyTo: "script*/**"
---

# Script Rules

## Scripts must not contain hardcoded secrets
Scripts must never contain hardcoded API keys, database credentials, tokens, or other secrets. Use environment variables. Database operations in scripts must be idempotent. Stripe-related scripts must use test mode keys.

## No arbitrary command execution in scripts
Scripts must not execute arbitrary shell commands from user input or dynamic strings. Use parameterized commands and validate all inputs. Verify output paths are within expected directories.
