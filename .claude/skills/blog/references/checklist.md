# Blog Integrity Checklist

One item per assertion in `client/src/pages/blog-integrity.test.ts`. Every item must pass before committing.

## Blog index and route consistency

- [ ] **Slug has matching route** — every `slug` in the `blogPosts` array in `Blog.tsx` has a corresponding `<Route path="/blog/{slug}">` in `App.tsx`
- [ ] **Route has matching slug** — every `/blog/*` route in `App.tsx` has a corresponding entry in the `blogPosts` array in `Blog.tsx`
- [ ] **Reverse chronological order** — `blogPosts` entries are ordered newest-first; `dates[i-1] >= dates[i]` for all adjacent pairs
- [ ] **Valid ISO dates** — every `date` value matches `YYYY-MM-DD` and parses to a valid `Date`
- [ ] **No duplicate slugs** — `new Set(slugs).size === slugs.length`

## Blog post page integrity

- [ ] **BLOG_PATH matches route** — the exported `BLOG_PATH` constant matches a `/blog/*` route in `App.tsx`
- [ ] **Valid PUBLISH_DATE** — `PUBLISH_DATE` matches `YYYY-MM-DD`
- [ ] **Schema.org BlogPosting** — page source contains `"@type": "BlogPosting"`, `datePublished`, `publisher`, and `author`
- [ ] **Internal links exist** — at least 3 `<Link href="/blog/...">` elements, each pointing to a route that exists in `App.tsx`
- [ ] **CTA links to login** — page contains `href="/api/login"`
- [ ] **SEO title has brand suffix** — the `title` prop passed to `<SEOHead>` includes `| FetchTheChange`
- [ ] **Badge shows category** — page contains a `<Badge>` with the category text matching the `blogPosts` entry

## Page file existence

- [ ] **Component file exists** — `App.tsx` imports the component used in the blog route, and the import resolves to an existing file
