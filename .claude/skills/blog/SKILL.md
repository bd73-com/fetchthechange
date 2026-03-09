---
name: blog
description: "Adding a new blog post — creating the page component, prepending the index entry in Blog.tsx, and registering the route in App.tsx. All three files must change together; blog-integrity.test.ts enforces consistency across them. Use when asked to 'add a blog post', 'create a blog post', 'write a new blog article', or 'add a post to the blog'."
---

## Overview

Add a new blog post to FetchTheChange. Every blog post requires synchronized changes to three files:

1. **Page component** — `client/src/pages/Blog{Name}.tsx` (the article itself)
2. **Blog index entry** — `blogPosts` array in `client/src/pages/Blog.tsx` (prepend, not append)
3. **Route registration** — `<Route>` in `client/src/App.tsx` (with matching lazy import)

All three must reference the same slug. `client/src/pages/blog-integrity.test.ts` enforces consistency — every assertion is listed in `references/checklist.md`.

## Workflow

1. Read `references/checklist.md` to understand every test assertion that must pass.
2. Copy `assets/blog-post-template.tsx` into `client/src/pages/Blog{Name}.tsx`. Replace every `__PLACEHOLDER__` token:
   - `__BLOG_PATH__` — `/blog/{slug}` (kebab-case, matches the slug)
   - `__PUBLISH_DATE__` — ISO date `YYYY-MM-DD`
   - `__HEADLINE__` — article headline
   - `__DESCRIPTION__` — meta description
   - `__CATEGORY__` — Badge label (e.g. "Guide", "Use Cases", "Comparison")
   - `__COMPONENT_NAME__` — PascalCase export name (e.g. `BlogMyNewPost`)
   - Remove or fill every `{/* TODO: ... */}` comment
3. Add at least 3 internal `<Link href="/blog/{existing-slug}">` elements pointing to routes that already exist in `App.tsx`. Verify each target slug is present in the `blogPosts` array.
4. Ensure the CTA section contains `<a href="/api/login">`.
5. Ensure the SEO `title` prop includes `| FetchTheChange` as a suffix.
6. Prepend a new entry to the `blogPosts` array in `client/src/pages/Blog.tsx`. The `date` must be >= every other entry's date (reverse-chronological order). The `slug` must match `__BLOG_PATH__` without the `/blog/` prefix.
7. Add a lazy/static import of the new component in `client/src/App.tsx`.
8. Add a `<Route path="/blog/{slug}" component={Blog{Name}} />` in the blog route block of `App.tsx`.
9. Run `npm run check && npm run test` — fix all failures before committing.

## Hard Constraints

- NEVER append to `blogPosts` — always prepend — reverse-chronological order is enforced by test (`blog posts are in reverse chronological order`)
- NEVER use a slug that already exists in `blogPosts` — uniqueness enforced by test (`no duplicate slugs in blog index`)
- NEVER omit the route in `App.tsx` for a new slug — enforced by test (`every blog post slug has a matching route in App.tsx`)
- NEVER leave a route in `App.tsx` without a matching slug in `Blog.tsx` — enforced by test (`every blog route in App.tsx has a matching slug in Blog.tsx`)
- NEVER omit `"@type": "BlogPosting"`, `datePublished`, `publisher`, or `author` from the JSON-LD object — enforced by test (`contains required Schema.org BlogPosting properties`)
- NEVER omit the `| FetchTheChange` suffix from the SEO title — enforced by test (`has correct SEO title with brand suffix`)
- NEVER omit `href="/api/login"` from the CTA button — enforced by test (`CTA button links to /api/login`)
- NEVER use fewer than 3 internal `<Link href="/blog/...">` elements — enforced by test (`internal links point to existing blog routes`)
- NEVER link to a `/blog/` path that has no matching route in `App.tsx` — enforced by test (`internal links point to existing blog routes`)
- NEVER use an invalid or non-ISO date format for `PUBLISH_DATE` — enforced by test (`blog post dates are valid ISO date strings`)
- NEVER skip `npm run check && npm run test` before committing — required by verification gate

## References

- `references/checklist.md` — one item per `blog-integrity.test.ts` assertion; review before and after writing the post
- `assets/blog-post-template.tsx` — starting-point TypeScript file with all required constants, imports, JSON-LD, SEOHead, CTA, and internal link placeholders
