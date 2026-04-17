/**
 * Parity test between PAGE_METADATA (server-side, for crawlers) and each
 * page's <SEOHead> call (client-side, for human visitors after JS runs).
 *
 * Link unfurls on Facebook/X/Slack/LinkedIn/Discord don't execute JS, so
 * server/crawlerMeta.ts rewrites index.html's <head> using PAGE_METADATA.
 * That means every public page now has two titles and two descriptions —
 * one in PAGE_METADATA and one in SEOHead props. Without an integrity test,
 * they silently drift as pages are edited.
 *
 * This test statically reads each page's source and asserts that the
 * <SEOHead path="…"> value has a matching PAGE_METADATA entry. Titles and
 * descriptions must match character-for-character where both are present.
 *
 * See GitHub issue #440 and Phase 3 architect review.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PAGE_METADATA } from "@shared/pageMetadata";

const PAGES_DIR = path.resolve(__dirname);

function readPage(file: string): string {
  return fs.readFileSync(path.join(PAGES_DIR, file), "utf-8");
}

function extractSEOProp(src: string, prop: string): string | null {
  // Match prop="..." inside a <SEOHead> block. Doesn't handle JSX expressions
  // like title={foo} — those pages are excluded from the parity check
  // because they compute metadata dynamically.
  const seoBlock = src.match(/<SEOHead[\s\S]*?\/>/);
  if (!seoBlock) return null;
  const m = seoBlock[0].match(
    new RegExp(`${prop}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`),
  );
  return m ? m[1] : null;
}

function extractSEOPath(src: string): string | null {
  const seoBlock = src.match(/<SEOHead[\s\S]*?\/>/);
  if (!seoBlock) return null;
  const staticPath = seoBlock[0].match(/path\s*=\s*"([^"]+)"/);
  if (staticPath) return staticPath[1];
  // Resolve one level of const indirection (e.g., blog pages use
  // `path={BLOG_PATH}` with `const BLOG_PATH = "..."` defined in the same
  // file). Without this, all 7 blog posts silently bypass the parity test —
  // exactly the surface most likely to drift (Phase 5 skeptic Concern 1).
  const constRefMatch = seoBlock[0].match(/path\s*=\s*\{(\w+)\}/);
  if (!constRefMatch) return null;
  const varName = constRefMatch[1];
  const constDef = src.match(
    new RegExp(`const\\s+${varName}\\s*=\\s*"([^"]+)"`),
  );
  return constDef ? constDef[1] : null;
}

// Pages where SEOHead receives a path literal AND the title/description are
// also literals — those are the ones we can statically compare. LandingPage
// takes an optional path prop so its SEOHead call uses {path}, skipped here.
const publicPageFiles = fs
  .readdirSync(PAGES_DIR)
  .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
  .filter((f) => readPage(f).includes("PublicNav"))
  .filter((f) => extractSEOPath(readPage(f)) !== null);

describe("PAGE_METADATA ↔ SEOHead parity (issue #440)", () => {
  it("finds at least 5 pages to compare (sanity)", () => {
    expect(publicPageFiles.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of publicPageFiles) {
    const src = readPage(file);
    const seoPath = extractSEOPath(src)!;

    it(`${file}: PAGE_METADATA["${seoPath}"] exists`, () => {
      expect(PAGE_METADATA[seoPath]).toBeDefined();
    });

    const seoTitle = extractSEOProp(src, "title");
    if (seoTitle) {
      it(`${file}: title matches PAGE_METADATA["${seoPath}"].title`, () => {
        expect(PAGE_METADATA[seoPath]?.title).toBe(seoTitle);
      });
    }

    const seoDesc = extractSEOProp(src, "description");
    if (seoDesc) {
      it(`${file}: description matches PAGE_METADATA["${seoPath}"].description`, () => {
        expect(PAGE_METADATA[seoPath]?.description).toBe(seoDesc);
      });
    }
  }
});
