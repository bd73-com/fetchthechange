---
name: skill-creator
description: "Create a new Claude Code skill for this project. Use when asked to 'add a skill', 'create a skill', 'write a skill for X workflow', or 'add /skillname to the project'. Produces a SKILL.md and optional bundled resources under .claude/skills/{name}/. Skills encode FetchTheChange-specific constraints so future agents pass npm run check && npm run test on the first attempt without manual correction."
---

## Overview

Skills are modular guides that give a future Claude Code session everything it needs to execute a repeatable workflow correctly the first time. Each skill lives at `.claude/skills/{name}/` and consists of a `SKILL.md` plus optional `references/`, `assets/`, and `scripts/` subdirectories. The skill-creator reads the codebase, extracts constraints, and encodes them so that running the skill eliminates first-attempt failures.

## Before Writing Any Skill File

1. Read `CLAUDE.md` — conventions here become hard constraints in the new skill
2. Read `.claude/skills/skill-creator/references/ftc-patterns.md` — every applicable pattern section must be reflected in the skill's hard constraints
3. Read the test files that enforce the target workflow — each assertion becomes a hard constraint
4. Read 2–3 reference implementations of the workflow — these establish the pattern the skill encodes
5. List existing skills (`ls .claude/skills/`) — do not duplicate coverage

## Deciding What Bundled Resources to Create

| Resource | Include when |
|----------|-------------|
| `references/` markdown | Constraints exceed 150 lines in SKILL.md, or a checklist/decision table is needed at runtime |
| `assets/` template file | Workflow always starts from a predictable file shape; a template eliminates "forgot X" failures |
| `scripts/` executable | Same shell/Python code would be rewritten each session, or deterministic execution is critical |

Default to the minimum. A SKILL.md-only skill is often sufficient.

## Writing SKILL.md

Frontmatter: `name` and `description` only — no other fields. The description is the only triggering mechanism; include 3–5 natural trigger phrases and name the test file or enforcer the skill encodes.

Body structure (imperative/infinitive form throughout):

1. **Overview** — what the skill does, which files it touches, why they must change together, name the enforcer
2. **Workflow** — numbered steps from zero to `npm run check && npm run test` passing; each step specific enough that the agent makes no discretionary decisions
3. **Hard constraints** — minimum 5; each names the test assertion, invariant, or security rule it comes from:
   ```
   - NEVER {X} — {why: names the source}
   ```
4. **References** (if applicable) — one line per file, what it contains, when to load it

Keep SKILL.md body under 150 lines. Move overflow into a `references/` file.

## Hard Constraints

- NEVER add a skill that duplicates an existing skill's coverage — check `ls .claude/skills/` first
- NEVER omit frontmatter `name` and `description` fields — they are the only trigger mechanism
- NEVER hardcode tier limits in a skill's workflow steps — reference `TIER_LIMITS` from `shared/models/auth.ts`
- NEVER skip the verification gate (`npm run check && npm run test`) at the end of a skill workflow
- NEVER create a skill that modifies production code without encoding the SSRF, CSRF, and ownership-check constraints from `references/ftc-patterns.md`
- NEVER use `gh` commands without `--repo bd73-com/fetchthechange` — the git remote uses a local proxy

## After Writing Skill Files

1. Verify with `find .claude/skills/{name} -type f | sort` and `wc -l .claude/skills/{name}/SKILL.md`
2. Confirm SKILL.md is under 150 lines
3. Update `CLAUDE.md` — append the new skill to the Skills inventory section
4. Commit and open a PR:

```bash
git checkout -b "skill/{name}"
git add .claude/skills/{name}/ CLAUDE.md
git commit -m "feat: add .claude/skills/{name}/ skill"
gh pr create \
  --repo bd73-com/fetchthechange \
  --title "feat: add .claude/skills/{name}/ skill" \
  --body "Adds skill for {workflow}. Encodes constraints from {source files}. No production code changed." \
  --base main
```

## References

- `references/ftc-patterns.md` — FetchTheChange-specific patterns (schema, routes, CSRF, tier gating, frontend, security, verification); read before writing any skill's hard constraints section
