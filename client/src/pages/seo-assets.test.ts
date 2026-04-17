import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const PUBLIC_DIR = path.resolve(__dirname, "..", "..", "public");

describe("robots.txt", () => {
  const robotsPath = path.join(PUBLIC_DIR, "robots.txt");

  it("exists", () => {
    expect(fs.existsSync(robotsPath)).toBe(true);
  });

  it("declares a user-agent and references the sitemap", () => {
    const src = fs.readFileSync(robotsPath, "utf-8");
    expect(src).toMatch(/^User-agent:\s*\*/m);
    expect(src).toMatch(/^Sitemap:\s*https?:\/\/\S+\/sitemap\.xml/m);
  });

  it("disallows private application routes", () => {
    const src = fs.readFileSync(robotsPath, "utf-8");
    expect(src).toMatch(/Disallow:\s*\/api\//);
    expect(src).toMatch(/Disallow:\s*\/admin\//);
    expect(src).toMatch(/Disallow:\s*\/dashboard/);
    expect(src).toMatch(/Disallow:\s*\/monitors\//);
  });
});

describe("sitemap.xml", () => {
  const sitemapPath = path.join(PUBLIC_DIR, "sitemap.xml");

  it("exists", () => {
    expect(fs.existsSync(sitemapPath)).toBe(true);
  });

  it("is a well-formed urlset", () => {
    const src = fs.readFileSync(sitemapPath, "utf-8");
    expect(src).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(src).toMatch(
      /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/,
    );
    expect(src).toMatch(/<\/urlset>\s*$/);
  });

  it("lists the core public marketing pages", () => {
    const src = fs.readFileSync(sitemapPath, "utf-8");
    const expectedPaths = [
      "/",
      "/pricing",
      "/blog",
      "/changelog",
      "/support",
      "/privacy",
    ];
    for (const p of expectedPaths) {
      expect(src).toMatch(
        new RegExp(`<loc>https?://[^<]+${p.replace(/\//g, "\\/")}</loc>`),
      );
    }
  });

  it("does not expose authenticated app routes", () => {
    const src = fs.readFileSync(sitemapPath, "utf-8");
    expect(src).not.toMatch(/<loc>[^<]*\/dashboard<\/loc>/);
    expect(src).not.toMatch(/<loc>[^<]*\/monitors\//);
    expect(src).not.toMatch(/<loc>[^<]*\/admin\//);
    expect(src).not.toMatch(/<loc>[^<]*\/developer<\/loc>/);
    expect(src).not.toMatch(/<loc>[^<]*\/extension-auth<\/loc>/);
  });

  it("has a url entry for every known blog post", () => {
    const blogTsxPath = path.resolve(__dirname, "Blog.tsx");
    const blogSrc = fs.readFileSync(blogTsxPath, "utf-8");
    const slugs = [...blogSrc.matchAll(/slug:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(slugs.length).toBeGreaterThanOrEqual(1);

    const sitemapSrc = fs.readFileSync(sitemapPath, "utf-8");
    for (const slug of slugs) {
      expect(sitemapSrc).toMatch(
        new RegExp(`<loc>https?://[^<]+/blog/${slug}</loc>`),
      );
    }
  });

  it("has a url entry for every PublicNav-rendering page", () => {
    const PAGES_DIR = __dirname;
    // Pages that render PublicNav but are intentionally not in the sitemap
    // (auth-bound entry points, thin redirect landing pages, etc.)
    const EXCLUDED_PAGES = new Set<string>([
      "ExtensionAuth.tsx",
      // Developer page is Power-tier gated (ProtectedRoute in App.tsx) and
      // renders PublicNav for unauthenticated visitors only; not a public
      // SEO surface.
      "Developer.tsx",
    ]);
    // Map of filename -> canonical path, for pages whose file name doesn't
    // trivially encode the route.
    const FILE_TO_PATH: Record<string, string> = {
      "LandingPage.tsx": "/",
      "Blog.tsx": "/blog",
      "Pricing.tsx": "/pricing",
      "Support.tsx": "/support",
      "Changelog.tsx": "/changelog",
      "Privacy.tsx": "/privacy",
      "DocsWebhooks.tsx": "/docs/webhooks",
      "DocsZapier.tsx": "/docs/zapier",
      "DocsMake.tsx": "/docs/make",
    };
    const publicPages = fs
      .readdirSync(PAGES_DIR)
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .filter((f) => !EXCLUDED_PAGES.has(f))
      .filter((f) => {
        const src = fs.readFileSync(path.join(PAGES_DIR, f), "utf-8");
        return src.includes("PublicNav");
      });

    // Blog post pages are asserted by the blog-slug test above; skip them here.
    const topLevelPages = publicPages.filter((f) => !f.startsWith("Blog") || f === "Blog.tsx");

    const sitemapSrc = fs.readFileSync(sitemapPath, "utf-8");
    for (const file of topLevelPages) {
      const expectedPath = FILE_TO_PATH[file];
      expect(
        expectedPath,
        `No canonical path mapping for ${file} — add it to FILE_TO_PATH or EXCLUDED_PAGES`,
      ).toBeDefined();
      expect(sitemapSrc).toMatch(
        new RegExp(
          `<loc>https?://[^<]+${expectedPath!.replace(/\//g, "\\/")}</loc>`,
        ),
      );
    }
  });

  it("has a url entry for every public /docs/* route registered in App.tsx", () => {
    const appTsxPath = path.resolve(__dirname, "..", "App.tsx");
    const appSrc = fs.readFileSync(appTsxPath, "utf-8");
    const docPaths = [
      ...appSrc.matchAll(/path="(\/docs\/[^"]+)"/g),
    ].map((m) => m[1]);
    expect(docPaths.length).toBeGreaterThanOrEqual(1);

    const sitemapSrc = fs.readFileSync(sitemapPath, "utf-8");
    for (const docPath of docPaths) {
      expect(sitemapSrc).toMatch(
        new RegExp(
          `<loc>https?://[^<]+${docPath.replace(/\//g, "\\/")}</loc>`,
        ),
      );
    }
  });
});
