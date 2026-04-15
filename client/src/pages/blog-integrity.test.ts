import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const PAGES_DIR = path.resolve(__dirname);
const APP_TSX = path.resolve(__dirname, "../App.tsx");
const BLOG_TSX = path.resolve(__dirname, "Blog.tsx");

const appSource = fs.readFileSync(APP_TSX, "utf-8");
const blogSource = fs.readFileSync(BLOG_TSX, "utf-8");

/**
 * Extract blog post slugs from the blogPosts array in Blog.tsx.
 */
function extractBlogSlugs(source: string): string[] {
  const matches = [...source.matchAll(/slug:\s*"([^"]+)"/g)];
  return matches.map((m) => m[1]);
}

/**
 * Extract blog route paths from App.tsx.
 */
function extractBlogRoutes(source: string): string[] {
  const matches = [...source.matchAll(/path="(\/blog\/[^"]+)"/g)];
  return matches.map((m) => m[1]);
}

/**
 * Extract blog dates from the blogPosts array in Blog.tsx.
 */
function extractBlogDates(source: string): string[] {
  const matches = [...source.matchAll(/date:\s*"([^"]+)"/g)];
  return matches.map((m) => m[1]);
}

const slugs = extractBlogSlugs(blogSource);
const routes = extractBlogRoutes(appSource);

describe("blog index and route consistency", () => {
  it("every blog post slug has a matching route in App.tsx", () => {
    for (const slug of slugs) {
      expect(routes).toContain(`/blog/${slug}`);
    }
  });

  it("every blog route in App.tsx has a matching slug in Blog.tsx", () => {
    for (const route of routes) {
      const slug = route.replace("/blog/", "");
      expect(slugs).toContain(slug);
    }
  });

  it("blog posts are in reverse chronological order", () => {
    const dates = extractBlogDates(blogSource);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1] >= dates[i]).toBe(true);
    }
  });

  it("blog post dates are valid ISO date strings", () => {
    const dates = extractBlogDates(blogSource);
    for (const d of dates) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(d).toString()).not.toBe("Invalid Date");
    }
  });

  it("no duplicate slugs in blog index", () => {
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("BlogUseCases page integrity", () => {
  const useCasesSource = fs.readFileSync(
    path.join(PAGES_DIR, "BlogUseCases.tsx"),
    "utf-8",
  );

  it("has matching BLOG_PATH and route in App.tsx", () => {
    const match = useCasesSource.match(/BLOG_PATH\s*=\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    const blogPath = match![1];
    expect(routes).toContain(blogPath);
  });

  it("has a valid PUBLISH_DATE", () => {
    const match = useCasesSource.match(/PUBLISH_DATE\s*=\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("contains required Schema.org BlogPosting properties", () => {
    expect(useCasesSource).toContain('"@type": "BlogPosting"');
    expect(useCasesSource).toContain("datePublished");
    expect(useCasesSource).toContain("publisher");
    expect(useCasesSource).toContain("author");
  });

  it("internal links point to existing blog routes", () => {
    const hrefMatches = [
      ...useCasesSource.matchAll(/href="(\/blog\/[^"]+)"/g),
    ];
    const linkedPaths = hrefMatches.map((m) => m[1]);
    expect(linkedPaths.length).toBeGreaterThanOrEqual(3);
    for (const href of linkedPaths) {
      expect(routes).toContain(href);
    }
  });

  it("CTA button links to /api/login", () => {
    expect(useCasesSource).toContain('href="/api/login"');
  });

  it("has correct SEO title with brand suffix", () => {
    expect(useCasesSource).toContain("| FetchTheChange");
  });

  it("Badge shows 'Use Cases' category", () => {
    expect(useCasesSource).toContain(">Use Cases<");
  });
});

describe("BlogNoCode page integrity", () => {
  const noCodeSource = fs.readFileSync(
    path.join(PAGES_DIR, "BlogNoCode.tsx"),
    "utf-8",
  );

  it("has matching BLOG_PATH and route in App.tsx", () => {
    const match = noCodeSource.match(/BLOG_PATH\s*=\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    const blogPath = match![1];
    expect(routes).toContain(blogPath);
  });

  it("has a valid PUBLISH_DATE", () => {
    const match = noCodeSource.match(/PUBLISH_DATE\s*=\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("contains required Schema.org BlogPosting properties", () => {
    expect(noCodeSource).toContain('"@type": "BlogPosting"');
    expect(noCodeSource).toContain("datePublished");
    expect(noCodeSource).toContain("publisher");
    expect(noCodeSource).toContain("author");
  });

  it("internal links point to existing blog routes", () => {
    const hrefMatches = [
      ...noCodeSource.matchAll(/href="(\/blog\/[^"]+)"/g),
    ];
    const linkedPaths = hrefMatches.map((m) => m[1]);
    expect(linkedPaths.length).toBeGreaterThanOrEqual(3);
    for (const href of linkedPaths) {
      expect(routes).toContain(href);
    }
  });

  it("CTA button links to /api/login", () => {
    expect(noCodeSource).toContain('href="/api/login"');
  });

  it("has correct SEO title with brand suffix", () => {
    expect(noCodeSource).toContain("| FetchTheChange");
  });

  it("Badge shows 'Getting Started' category", () => {
    expect(noCodeSource).toContain(">Getting Started<");
  });
});

describe("BlogSlackAlerts page integrity", () => {
  const slackAlertsSource = fs.readFileSync(
    path.join(PAGES_DIR, "BlogSlackAlerts.tsx"),
    "utf-8",
  );

  it("has matching BLOG_PATH and route in App.tsx", () => {
    const match = slackAlertsSource.match(/BLOG_PATH\s*=\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    const blogPath = match![1];
    expect(routes).toContain(blogPath);
  });

  it("has a valid PUBLISH_DATE", () => {
    const match = slackAlertsSource.match(/PUBLISH_DATE\s*=\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("contains required Schema.org BlogPosting properties", () => {
    expect(slackAlertsSource).toContain('"@type": "BlogPosting"');
    expect(slackAlertsSource).toContain("datePublished");
    expect(slackAlertsSource).toContain("publisher");
    expect(slackAlertsSource).toContain("author");
  });

  it("CTA button links to /api/login", () => {
    expect(slackAlertsSource).toContain('href="/api/login"');
  });

  it("has correct SEO title with brand suffix", () => {
    expect(slackAlertsSource).toContain("| FetchTheChange");
  });

  it("Badge shows 'Integrations' category", () => {
    expect(slackAlertsSource).toContain(">Integrations<");
  });

  it("includes stub links to the 4 planned series posts", () => {
    // The spec requires stubbed Link hrefs to the other 4 integration
    // series posts so they go live automatically when those posts ship.
    const seriesSlugs = [
      "/blog/webhook-webpage-change-trigger",
      "/blog/zapier-webpage-change-automation",
      "/blog/webpage-monitoring-api",
      "/blog/chrome-extension-webpage-monitor",
    ];
    for (const href of seriesSlugs) {
      expect(slackAlertsSource).toContain(`href="${href}"`);
    }
  });

  it("every /blog/ href is either an existing route or a planned series stub", () => {
    // This assertion intentionally replaces the standard "internal links
    // point to existing blog routes" check. The four planned-series stubs
    // are allowed because they ship as nofollow Links that go live when
    // later posts in the series land. Any other /blog/ href (e.g. a typo
    // in one of the stubs) must resolve to a real route today.
    const plannedStubs = new Set([
      "/blog/webhook-webpage-change-trigger",
      "/blog/zapier-webpage-change-automation",
      "/blog/webpage-monitoring-api",
      "/blog/chrome-extension-webpage-monitor",
    ]);
    const hrefMatches = [
      ...slackAlertsSource.matchAll(/href="(\/blog\/[^"]+)"/g),
    ];
    const linkedPaths = hrefMatches.map((m) => m[1]);
    expect(linkedPaths.length).toBeGreaterThanOrEqual(3);
    for (const href of linkedPaths) {
      if (plannedStubs.has(href)) continue;
      expect(routes).toContain(href);
    }
  });

  it("planned-series stub links carry rel=\"nofollow\"", () => {
    // Prevents Google from treating the not-yet-routed targets as
    // soft-404s during the window before each series post ships.
    const plannedStubs = [
      "/blog/webhook-webpage-change-trigger",
      "/blog/zapier-webpage-change-automation",
      "/blog/webpage-monitoring-api",
      "/blog/chrome-extension-webpage-monitor",
    ];
    for (const href of plannedStubs) {
      const pattern = new RegExp(
        `href="${href.replace(/\//g, "\\/")}"[^>]*rel="nofollow"|rel="nofollow"[^>]*href="${href.replace(/\//g, "\\/")}"`,
      );
      expect(slackAlertsSource).toMatch(pattern);
    }
  });

  it("JSON-LD headline matches the rendered H1", () => {
    // Google Rich Results expects the structured-data headline to match
    // the visible page headline. This assertion prevents future case or
    // wording drift between the two.
    const headlineMatch = slackAlertsSource.match(/headline:\s*"([^"]+)"/);
    expect(headlineMatch).not.toBeNull();
    const headline = headlineMatch![1];
    const h1Pattern = new RegExp(`<h1[^>]*>\\s*${headline.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*</h1>`);
    expect(slackAlertsSource).toMatch(h1Pattern);
  });
});

describe("each blog post has a corresponding page file", () => {
  for (const slug of slugs) {
    it(`page file exists for slug "${slug}"`, () => {
      // App.tsx imports map slug routes to Blog* components
      const routeLine = appSource
        .split("\n")
        .find((l) => l.includes(`/blog/${slug}`));
      expect(routeLine).toBeDefined();
      // Extract the component name from the route
      const compMatch = routeLine!.match(/component=\{(\w+)\}/);
      expect(compMatch).not.toBeNull();
      const componentName = compMatch![1];
      // Verify the import exists
      expect(appSource).toContain(`import ${componentName}`);
    });
  }
});
