import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  isCrawlerUserAgent,
  rewriteIndexHtmlForCrawler,
  getPageMetadata,
} from "./crawlerMeta";

const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>FetchTheChange — Monitor any web value. Get alerted when it changes.</title>
    <meta name="description" content="Website change monitoring that works on modern, JavaScript-heavy sites." />
    <link rel="canonical" href="https://fetch-the-change.replit.app/" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="FetchTheChange — Monitor any web value. Get alerted when it changes." />
    <meta property="og:description" content="Website change monitoring that works on modern, JavaScript-heavy sites." />
    <meta property="og:url" content="https://fetch-the-change.replit.app/" />
    <meta property="og:image" content="https://fetch-the-change.replit.app/images/fix-selector-showcase.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="FetchTheChange — Monitor any web value. Get alerted when it changes." />
    <meta name="twitter:description" content="Website change monitoring that works on modern, JavaScript-heavy sites." />
    <meta name="twitter:image" content="https://fetch-the-change.replit.app/images/fix-selector-showcase.png" />
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("isCrawlerUserAgent", () => {
  it("detects Facebook, X, Slack, Discord, LinkedIn, Google, Bing bots", () => {
    expect(isCrawlerUserAgent("facebookexternalhit/1.1")).toBe(true);
    expect(isCrawlerUserAgent("Twitterbot/1.0")).toBe(true);
    expect(isCrawlerUserAgent("Slackbot-LinkExpanding 1.0")).toBe(true);
    expect(isCrawlerUserAgent("Discordbot/2.0")).toBe(true);
    expect(isCrawlerUserAgent("LinkedInBot/1.0")).toBe(true);
    expect(isCrawlerUserAgent("Googlebot/2.1")).toBe(true);
    expect(isCrawlerUserAgent("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe(true);
  });

  it("returns false for a normal browser UA", () => {
    expect(
      isCrawlerUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });

  it("returns false for undefined/null/empty", () => {
    expect(isCrawlerUserAgent(undefined)).toBe(false);
    expect(isCrawlerUserAgent(null)).toBe(false);
    expect(isCrawlerUserAgent("")).toBe(false);
  });
});

describe("rewriteIndexHtmlForCrawler", () => {
  it("rewrites title, description, canonical, og:*, twitter:* for a blog post path", () => {
    const out = rewriteIndexHtmlForCrawler(
      TEMPLATE,
      "/blog/slack-webpage-change-alerts",
      "https://ftc.bd73.com",
    );
    expect(out).toContain(
      "<title>How to Get a Slack Alert When Any Webpage Changes | FetchTheChange</title>",
    );
    expect(out).toContain(
      'content="Set up Slack notifications for webpage changes in minutes. Monitor prices, stock levels, competitor pages, or any site element — alerts go straight to your Slack channel."',
    );
    expect(out).toContain(
      '<link rel="canonical" href="https://ftc.bd73.com/blog/slack-webpage-change-alerts" />',
    );
    expect(out).toContain('<meta property="og:type" content="article" />');
    expect(out).toContain(
      '<meta property="og:url" content="https://ftc.bd73.com/blog/slack-webpage-change-alerts" />',
    );
    expect(out).toContain(
      '<meta property="og:title" content="How to Get a Slack Alert When Any Webpage Changes | FetchTheChange" />',
    );
    expect(out).toContain(
      '<meta name="twitter:title" content="How to Get a Slack Alert When Any Webpage Changes | FetchTheChange" />',
    );
  });

  it("falls back to landing metadata for unknown paths", () => {
    const out = rewriteIndexHtmlForCrawler(
      TEMPLATE,
      "/some/unknown/path",
      "https://ftc.bd73.com",
    );
    // og:url still reflects the actual path even when metadata falls back
    expect(out).toContain(
      '<meta property="og:url" content="https://ftc.bd73.com/some/unknown/path" />',
    );
  });

  it("HTML-escapes metadata before emitting into attributes/text", () => {
    const out = rewriteIndexHtmlForCrawler(TEMPLATE, "/pricing", "https://ftc.bd73.com");
    // The attribute-context captured group cannot contain a bare quote or
    // angle bracket — escapeAttr would emit &quot; / &lt; / &gt;.
    const ogDescMatch = out.match(
      /<meta\s+property="og:description"\s+content="([^"]*)"/,
    );
    expect(ogDescMatch).not.toBeNull();
    expect(ogDescMatch?.[1]).not.toContain("<");
    expect(ogDescMatch?.[1]).not.toContain(">");
    // Title is text-context, not attribute — escapeHtmlText replaces &/</>
    // but leaves quotes. Prove the angle brackets never leak through.
    const titleMatch = out.match(/<title>([\s\S]*?)<\/title>/);
    expect(titleMatch).not.toBeNull();
    expect(titleMatch?.[1]).not.toContain("<");
    expect(titleMatch?.[1]).not.toContain(">");
  });

  it("rewrites tags even when attributes are split across multiple lines", () => {
    // \s+ in JS regex matches newlines by default, but lock that in so a
    // future prettier reformat or hand-edit that line-wraps attributes
    // doesn't silently break the rewriter.
    const multilineTemplate = `<!DOCTYPE html>
<html>
  <head>
    <meta
      name="description"
      content="landing description"
    />
    <meta
      property="og:title"
      content="landing title"
    />
    <meta
      property="og:url"
      content="https://old.example.com/"
    />
  </head>
</html>`;
    const out = rewriteIndexHtmlForCrawler(
      multilineTemplate,
      "/pricing",
      "https://ftc.bd73.com",
    );
    const pricingMeta = getPageMetadata("/pricing");
    expect(out).toContain(
      `<meta name="description" content="${pricingMeta.description.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" />`,
    );
    expect(out).toContain(
      `<meta property="og:title" content="${pricingMeta.title}" />`,
    );
    expect(out).toContain(
      '<meta property="og:url" content="https://ftc.bd73.com/pricing" />',
    );
    expect(out).not.toContain("landing description");
    expect(out).not.toContain("landing title");
  });
});

describe("getPageMetadata", () => {
  it("returns landing metadata for /", () => {
    const meta = getPageMetadata("/");
    expect(meta.title).toContain("FetchTheChange");
  });

  it("returns per-blog metadata", () => {
    const meta = getPageMetadata("/blog/slack-webpage-change-alerts");
    expect(meta.ogType).toBe("article");
    expect(meta.title).toContain("Slack Alert");
  });

  it("falls back to landing metadata for an unknown path", () => {
    const meta = getPageMetadata("/no-such-route-exists");
    expect(meta.title).toContain("FetchTheChange");
  });

  it("normalizes trailing slash before lookup (#440 skeptic Concern 7)", () => {
    expect(getPageMetadata("/pricing/").title).toBe(
      getPageMetadata("/pricing").title,
    );
  });

  it("does not strip the root path's slash", () => {
    expect(getPageMetadata("/").title).toContain("FetchTheChange");
  });
});

describe("rewriteIndexHtmlForCrawler noindex for unknown paths (Concern 2)", () => {
  it("injects robots noindex when the path has no PAGE_METADATA entry", () => {
    const out = rewriteIndexHtmlForCrawler(
      TEMPLATE,
      "/no-such-path",
      "https://ftc.bd73.com",
    );
    expect(out).toContain('<meta name="robots" content="noindex" />');
    // og:url still reflects the real path so a caller can see what was hit
    expect(out).toContain(
      '<meta property="og:url" content="https://ftc.bd73.com/no-such-path" />',
    );
  });

  it("does NOT inject noindex for known paths", () => {
    const out = rewriteIndexHtmlForCrawler(
      TEMPLATE,
      "/pricing",
      "https://ftc.bd73.com",
    );
    expect(out).not.toContain('<meta name="robots" content="noindex" />');
  });

  it("tolerates a trailing slash on baseUrl (no double-slash in og:url)", () => {
    const out = rewriteIndexHtmlForCrawler(
      TEMPLATE,
      "/pricing",
      "https://ftc.bd73.com/",
    );
    expect(out).toContain(
      '<link rel="canonical" href="https://ftc.bd73.com/pricing" />',
    );
    expect(out).toContain(
      '<meta property="og:url" content="https://ftc.bd73.com/pricing" />',
    );
    expect(out).not.toContain("com//pricing");
  });

  it("normalizes trailing slash so /pricing/ is treated as known", () => {
    const out = rewriteIndexHtmlForCrawler(
      TEMPLATE,
      "/pricing/",
      "https://ftc.bd73.com",
    );
    expect(out).not.toContain('<meta name="robots" content="noindex" />');
    // Canonical should point at the trailing-slash-stripped URL
    expect(out).toContain(
      '<link rel="canonical" href="https://ftc.bd73.com/pricing" />',
    );
  });
});

describe("client/index.html contains exactly one of each rewritten tag", () => {
  // The regex rewriter replaces only the first occurrence. A duplicate meta
  // tag (from a Vite plugin injection or hand-edit) would leave the second
  // copy showing landing-page content. Lock in the invariant. See Phase 5
  // skeptic Concern 7.
  const clientIndex = fs.readFileSync(
    path.resolve(__dirname, "..", "client", "index.html"),
    "utf-8",
  );
  const countOccurrences = (re: RegExp): number =>
    (clientIndex.match(re) ?? []).length;

  it.each([
    ["<title>", /<title>/gi],
    ["description", /<meta\s+name="description"/gi],
    ["canonical link", /<link\s+rel="canonical"/gi],
    ["og:type", /<meta\s+property="og:type"/gi],
    ["og:title", /<meta\s+property="og:title"/gi],
    ["og:description", /<meta\s+property="og:description"/gi],
    ["og:url", /<meta\s+property="og:url"/gi],
    ["og:image", /<meta\s+property="og:image"/gi],
    ["twitter:title", /<meta\s+name="twitter:title"/gi],
    ["twitter:description", /<meta\s+name="twitter:description"/gi],
    ["twitter:image", /<meta\s+name="twitter:image"/gi],
  ])("has exactly one %s tag", (_label, re) => {
    expect(countOccurrences(re)).toBe(1);
  });
});

describe("rewriteIndexHtmlForCrawler runs against the real client/index.html", () => {
  // Prevents silent drift: if someone edits client/index.html to reorder
  // attributes, single-quote values, or split a tag across lines, the regex-
  // based rewriter in crawlerMeta.ts would otherwise no-op and crawlers would
  // keep seeing the landing-page fallback. See Phase 3 architecture review.
  const clientIndexPath = path.resolve(__dirname, "..", "client", "index.html");
  const realTemplate = fs.readFileSync(clientIndexPath, "utf-8");

  it("rewrites every expected head tag in the real template", () => {
    const out = rewriteIndexHtmlForCrawler(
      realTemplate,
      "/pricing",
      "https://ftc.bd73.com",
    );

    const pricingMeta = getPageMetadata("/pricing");

    // Every tag we claim to rewrite must actually be rewritten. We check by
    // requiring the new content to be present — the old landing copy MUST
    // have been replaced.
    expect(out).toContain(`<title>${pricingMeta.title}</title>`);
    expect(out).toContain(
      '<link rel="canonical" href="https://ftc.bd73.com/pricing" />',
    );
    expect(out).toContain(
      '<meta property="og:url" content="https://ftc.bd73.com/pricing" />',
    );
    expect(out).toContain(
      `<meta property="og:title" content="${pricingMeta.title}" />`,
    );
    expect(out).toContain(
      `<meta name="twitter:title" content="${pricingMeta.title}" />`,
    );

    // And the old landing copy must no longer appear in those slots.
    expect(out).not.toContain(
      '<meta property="og:title" content="FetchTheChange — Monitor any web value. Get alerted when it changes."',
    );
  });
});
