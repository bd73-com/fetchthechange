import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  PUBLIC_SITEMAP_ENTRIES,
  renderRobotsTxt,
  renderSitemapXml,
} from "../../../server/services/seoFiles";

const TEST_BASE_URL = "https://fetch-the-change.example.test";

describe("robots.txt generator", () => {
  it("declares a user-agent and references the sitemap at the given base URL", () => {
    const src = renderRobotsTxt(TEST_BASE_URL);
    expect(src).toMatch(/^User-agent:\s*\*/m);
    expect(src).toContain(`Sitemap: ${TEST_BASE_URL}/sitemap.xml`);
  });

  it("disallows private application routes", () => {
    const src = renderRobotsTxt(TEST_BASE_URL);
    expect(src).toMatch(/Disallow:\s*\/api\//);
    expect(src).toMatch(/Disallow:\s*\/admin\//);
    expect(src).toMatch(/Disallow:\s*\/dashboard/);
    expect(src).toMatch(/Disallow:\s*\/monitors\//);
  });
});

describe("sitemap.xml generator", () => {
  const sitemapSrc = renderSitemapXml(TEST_BASE_URL);

  it("is a well-formed urlset", () => {
    expect(sitemapSrc).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(sitemapSrc).toMatch(
      /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/,
    );
    expect(sitemapSrc).toMatch(/<\/urlset>\s*$/);
  });

  it("emits every PUBLIC_SITEMAP_ENTRIES path prefixed with the given base URL", () => {
    for (const entry of PUBLIC_SITEMAP_ENTRIES) {
      expect(sitemapSrc).toContain(`<loc>${TEST_BASE_URL}${entry.path}</loc>`);
    }
  });

  it("lists the core public marketing pages", () => {
    const expectedPaths = [
      "/",
      "/pricing",
      "/blog",
      "/changelog",
      "/support",
      "/privacy",
    ];
    for (const p of expectedPaths) {
      expect(sitemapSrc).toContain(`<loc>${TEST_BASE_URL}${p}</loc>`);
    }
  });

  it("does not expose authenticated app routes", () => {
    expect(sitemapSrc).not.toMatch(/<loc>[^<]*\/dashboard<\/loc>/);
    expect(sitemapSrc).not.toMatch(/<loc>[^<]*\/monitors\//);
    expect(sitemapSrc).not.toMatch(/<loc>[^<]*\/admin\//);
    expect(sitemapSrc).not.toMatch(/<loc>[^<]*\/developer<\/loc>/);
    expect(sitemapSrc).not.toMatch(/<loc>[^<]*\/extension-auth<\/loc>/);
  });

  it("has a url entry for every known blog post", () => {
    const blogTsxPath = path.resolve(__dirname, "Blog.tsx");
    const blogSrc = fs.readFileSync(blogTsxPath, "utf-8");
    const slugs = [...blogSrc.matchAll(/slug:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(slugs.length).toBeGreaterThanOrEqual(1);

    for (const slug of slugs) {
      expect(sitemapSrc).toContain(`<loc>${TEST_BASE_URL}/blog/${slug}</loc>`);
    }
  });

  it("has a url entry for every PublicNav-rendering page", () => {
    const PAGES_DIR = __dirname;
    const EXCLUDED_PAGES = new Set<string>([
      "ExtensionAuth.tsx",
      "Developer.tsx",
    ]);
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

    const topLevelPages = publicPages.filter(
      (f) => !f.startsWith("Blog") || f === "Blog.tsx",
    );

    for (const file of topLevelPages) {
      const expectedPath = FILE_TO_PATH[file];
      expect(
        expectedPath,
        `No canonical path mapping for ${file} — add it to FILE_TO_PATH or EXCLUDED_PAGES`,
      ).toBeDefined();
      expect(sitemapSrc).toContain(
        `<loc>${TEST_BASE_URL}${expectedPath!}</loc>`,
      );
    }
  });

  it("has a url entry for every public /docs/* route registered in App.tsx", () => {
    const appTsxPath = path.resolve(__dirname, "..", "App.tsx");
    const appSrc = fs.readFileSync(appTsxPath, "utf-8");
    const docPaths = [...appSrc.matchAll(/path="(\/docs\/[^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(docPaths.length).toBeGreaterThanOrEqual(1);

    for (const docPath of docPaths) {
      expect(sitemapSrc).toContain(`<loc>${TEST_BASE_URL}${docPath}</loc>`);
    }
  });
});
