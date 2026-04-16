import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const PAGES_DIR = path.resolve(__dirname);

/**
 * Every public page (one that renders PublicNav) must also render SEOHead so
 * it has a document title, meta description, canonical URL, and OG tags.
 *
 * This test reads source files statically — no DOM rendering required.
 */

const publicPageFiles = fs
  .readdirSync(PAGES_DIR)
  .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
  .filter((f) => {
    const src = fs.readFileSync(path.join(PAGES_DIR, f), "utf-8");
    return src.includes("PublicNav");
  });

describe("every public page includes SEOHead", () => {
  it("found at least 10 public pages (sanity check)", () => {
    expect(publicPageFiles.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of publicPageFiles) {
    it(`${file} imports and uses SEOHead`, () => {
      const src = fs.readFileSync(path.join(PAGES_DIR, file), "utf-8");
      expect(src).toContain('from "@/components/SEOHead"');
      expect(src).toMatch(/<SEOHead\b/);
    });
  }
});

describe("LandingPage SEOHead props", () => {
  const src = fs.readFileSync(path.join(PAGES_DIR, "LandingPage.tsx"), "utf-8");

  it("sets a title containing the brand name", () => {
    expect(src).toMatch(/title="[^"]*FetchTheChange[^"]*"/);
  });

  it("sets a non-empty description", () => {
    expect(src).toMatch(/description="[^"]+"/);
  });

  it('uses path="/"', () => {
    expect(src).toContain('path="/"');
  });
});
