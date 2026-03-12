---
applyTo: "**/*.test.ts"
---

# Test Code Rules

## Tests must cover edge cases and error paths
Test files must include assertions for edge cases (empty inputs, boundary values, null/undefined), error paths (invalid input, unauthorized access, not found), and security-relevant scenarios (ownership violations, SSRF attempts). Use `expect` assertions from Vitest, not `assert`.
