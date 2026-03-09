---
name: add-page
description: "Adding a new public-facing page — creating the page component, registering the route in App.tsx, wiring SEOHead with getCanonicalUrl(), including PublicNav, and using Tailwind semantic color tokens. Use when asked to 'add a page', 'create a new page', 'add a public page', or 'build a landing page'. Blog pages are a subtype — use the blog skill instead."
---

## Overview

Every public page in FetchTheChange requires four things in sync: a page component file, a route in `client/src/App.tsx`, an `SEOHead` component for meta tags, and `PublicNav` for consistent navigation. Missing any one causes SEO gaps, broken routing, or navigation inconsistency. This skill encodes those constraints plus the UI conventions (shadcn/ui primitives, Tailwind semantic tokens).

## Workflow

1. Read `client/src/App.tsx` — understand existing route registrations and import patterns.
2. Read `client/src/components/SEOHead.tsx` — understand `SEOHeadProps` and `getCanonicalUrl()`.
3. Read `client/src/components/PublicNav.tsx` (first 20 lines) — understand the component interface.
4. Read an existing public page (e.g. `client/src/pages/Support.tsx` or `client/src/pages/Changelog.tsx`) as a reference implementation.
5. Create the page component file at `client/src/pages/{PageName}.tsx`:
   - Import `SEOHead` and `getCanonicalUrl` from `@/components/SEOHead`.
   - Import `PublicNav` from `@/components/PublicNav`.
   - Render `<SEOHead title="..." description="..." path="/your-path" />` as the first child.
   - Render `<PublicNav />` immediately after SEOHead.
   - Use Tailwind semantic color tokens (`text-primary`, `bg-background`, `text-muted-foreground`, `bg-secondary`, etc.) — never hardcoded hex/rgb values.
   - Use shadcn/ui primitives (`Button`, `Card`, `Input`, `Select`, etc.) from `@/components/ui/` — never raw HTML form elements.
6. Add the import to `client/src/App.tsx` alongside existing page imports.
7. Add the `<Route>` in the `Router` component in `client/src/App.tsx`, before the fallback `<Route component={NotFound} />`.
8. If the page should appear in navigation, add an entry to `navLinks` in `client/src/components/PublicNav.tsx`.
9. Run `npm run check && npm run test`.

## Hard constraints

- NEVER create a page without `SEOHead` — every public page requires it for meta tags and canonical URL
- NEVER call `getCanonicalUrl()` without importing it from `client/src/components/SEOHead.tsx`
- NEVER use hardcoded color values (hex, rgb, hsl) — use Tailwind semantic tokens (`text-primary`, `bg-secondary`, `text-muted-foreground`, `border-border`, etc.)
- NEVER use raw HTML `<input>`, `<button>`, or `<select>` — use shadcn/ui primitives from `@/components/ui/`
- NEVER register a route in `App.tsx` without a matching import — and vice versa; orphaned imports or routes cause build or runtime errors
- NEVER add a blog page with this skill — use the `blog` skill instead, which additionally enforces `blog-integrity.test.ts`
- NEVER place a new `<Route>` after the fallback `<Route component={NotFound} />` — it will never match
- NEVER skip the verification gate — run `npm run check && npm run test` before committing
