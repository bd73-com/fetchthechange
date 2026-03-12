---
applyTo: "shared/**"
---

# Shared Code Rules

## Avoid type: any in shared code
Never use `any` type in shared code. Use precise types, `unknown` with type narrowing, or proper generics. The `shared/` directory defines the contract between client and server — type precision here prevents entire classes of bugs.

## Zod schemas must match Drizzle table definitions
Zod validation schemas in `shared/routes.ts` must stay in sync with Drizzle table definitions in `shared/schema.ts`. When adding or modifying a column in the schema, update the corresponding Zod schema and vice versa.
