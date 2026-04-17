import { PAGE_METADATA, DEFAULT_PAGE_METADATA, type PageMeta } from "@shared/pageMetadata";

/**
 * Link-unfurl bots don't execute JavaScript, so without server-side rewriting
 * they only see the static meta tags in client/index.html — which describe
 * the landing page. This middleware detects those bots and rewrites the head
 * with per-route metadata so a blog post shared on Slack unfurls as the blog
 * post, not the landing page. See GitHub issue #440.
 */

// Case-insensitive match against user-agent substrings. Covers the major
// scrapers that power link previews on Facebook/X/Slack/LinkedIn/Discord/etc.
const CRAWLER_UA_PATTERNS = [
  "facebookexternalhit",
  "facebot",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "discordbot",
  "telegrambot",
  "whatsapp",
  "skypeuripreview",
  "applebot",
  "pinterest",
  "redditbot",
  "embedly",
  "googlebot", // also needs per-page meta for indexation
  "bingbot",
  "duckduckbot",
];

export function isCrawlerUserAgent(ua: string | undefined | null): boolean {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  return CRAWLER_UA_PATTERNS.some((p) => lower.includes(p));
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Normalize a request path for metadata lookup: strip trailing slash (except
 * for root "/"). Without this, `/pricing/` would miss PAGE_METADATA and fall
 * back to the landing metadata with a non-canonical `og:url`. See Phase 5
 * skeptic Concern 7.
 */
function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

export function getPageMetadata(path: string): PageMeta {
  return PAGE_METADATA[normalizePath(path)] ?? DEFAULT_PAGE_METADATA;
}

/** Returns true when the given path has a known PAGE_METADATA entry. */
export function hasKnownPageMetadata(path: string): boolean {
  return PAGE_METADATA[normalizePath(path)] !== undefined;
}

/**
 * Rewrites the static OG/Twitter/canonical/title tags in an index.html string
 * with per-path metadata. Uses regex replacements against the well-known tag
 * shape emitted from client/index.html — when that template changes, this
 * pattern-matching may need to change too (covered by crawlerMeta.test.ts).
 *
 * When the path has no PAGE_METADATA entry (e.g., a typo or stale URL), the
 * rewriter additionally injects `<meta name="robots" content="noindex">` so
 * crawlers don't index arbitrary 404-equivalent paths with landing-page
 * content. See Phase 5 skeptic Concern 2.
 */
export function rewriteIndexHtmlForCrawler(
  template: string,
  path: string,
  baseUrl: string,
): string {
  const normalized = normalizePath(path);
  const meta = getPageMetadata(normalized);
  const isKnown = hasKnownPageMetadata(normalized);
  // Defensive normalization: if a caller ever passes `https://host/` as the
  // base, naive concatenation yields `//pricing`, which crawlers treat as a
  // distinct URL and silently breaks canonicalization.
  const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const canonicalUrl = `${cleanBase}${normalized}`;
  // Accept absolute `https://` / `http://` and protocol-relative `//cdn/…`;
  // everything else is treated as a site-relative path and prefixed with the
  // canonical origin. `startsWith("http")` was too loose — it matched
  // `httpunknown:…` and missed protocol-relative.
  const isAbsolute = (u: string): boolean =>
    /^https?:\/\//i.test(u) || u.startsWith("//");
  const ogImage = meta.image
    ? isAbsolute(meta.image)
      ? meta.image
      : `${cleanBase}${meta.image}`
    : `${cleanBase}/images/fix-selector-showcase.png`;
  const ogType = meta.ogType ?? "website";

  const titleAttr = escapeHtmlText(meta.title);
  const descAttr = escapeAttr(meta.description);
  const titleA = escapeAttr(meta.title);
  const urlA = escapeAttr(canonicalUrl);
  const imageA = escapeAttr(ogImage);
  const typeA = escapeAttr(ogType);

  let out = template;

  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${titleAttr}</title>`);

  out = out.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${descAttr}" />`,
  );

  out = out.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${urlA}" />`,
  );

  out = out.replace(
    /<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:type" content="${typeA}" />`,
  );
  out = out.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:title" content="${titleA}" />`,
  );
  out = out.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:description" content="${descAttr}" />`,
  );
  out = out.replace(
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:url" content="${urlA}" />`,
  );
  out = out.replace(
    /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:image" content="${imageA}" />`,
  );
  out = out.replace(
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:title" content="${titleA}" />`,
  );
  out = out.replace(
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:description" content="${descAttr}" />`,
  );
  out = out.replace(
    /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:image" content="${imageA}" />`,
  );

  if (!isKnown) {
    // Inject noindex so Googlebot doesn't index typo / stale URLs as 200s.
    // Prepend into <head> — the regex tolerates attributes on the head tag
    // (e.g., `<head lang="en">` or `<head prefix="og: …">`) so the injection
    // doesn't silently no-op when someone adds one.
    out = out.replace(
      /<head(\s[^>]*)?>/i,
      (match) => `${match}\n    <meta name="robots" content="noindex" />`,
    );
  }

  return out;
}
