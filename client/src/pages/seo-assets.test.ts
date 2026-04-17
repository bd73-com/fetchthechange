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
      expect(sitemapSrc).toContain(`/blog/${slug}`);
    }
  });
});
