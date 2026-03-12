---
applyTo: "**/*.{ts,tsx}"
---

# General Code Rules

## Route constants in shared/routes.ts
Never hardcode route path strings like '/api/monitors' in server or client code. Define route constants in the `api` object in `shared/routes.ts` with `method`, `path`, `responses`, and optional `input`. Reference these constants throughout the codebase.

## Shared types use @shared/ import alias
All types, schemas, and constants shared between client and server must live in the `shared/` directory and be imported using the `@shared/` path alias. Never duplicate shared types in client or server code.
