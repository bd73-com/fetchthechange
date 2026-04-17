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

export function getPageMetadata(path: string): PageMeta {
  return PAGE_METADATA[path] ?? DEFAULT_PAGE_METADATA;
}

/**
 * Rewrites the static OG/Twitter/canonical/title tags in an index.html string
 * with per-path metadata. Uses regex replacements against the well-known tag
 * shape emitted from client/index.html — when that template changes, this
 * pattern-matching may need to change too (covered by crawlerMeta.test.ts).
 */
export function rewriteIndexHtmlForCrawler(
  template: string,
  path: string,
  baseUrl: string,
): string {
  const meta = getPageMetadata(path);
  const canonicalUrl = `${baseUrl}${path}`;
  const ogImage = meta.image
    ? meta.image.startsWith("http")
      ? meta.image
      : `${baseUrl}${meta.image}`
    : `${baseUrl}/images/fix-selector-showcase.png`;
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

  return out;
}
