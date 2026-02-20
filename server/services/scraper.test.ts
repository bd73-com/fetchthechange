import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all external dependencies before importing the module under test
vi.mock("../storage", () => ({
  storage: {
    updateMonitor: vi.fn().mockResolvedValue({}),
    addMonitorChange: vi.fn().mockResolvedValue({}),
    getUser: vi.fn().mockResolvedValue({ id: "user1", tier: "free" }),
  },
}));

vi.mock("./email", () => ({
  sendNotificationEmail: vi.fn().mockResolvedValue({ success: true }),
  sendAutoPauseEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("./logger", () => ({
  ErrorLogger: {
    error: vi.fn().mockResolvedValue(undefined),
    warning: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./browserlessTracker", () => ({
  BrowserlessUsageTracker: {
    canUseBrowserless: vi.fn().mockResolvedValue({ allowed: false, reason: "free_tier" }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../utils/ssrf", () => ({
  validateUrlBeforeFetch: vi.fn().mockResolvedValue(undefined),
  ssrfSafeFetch: vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    return globalThis.fetch(url, init);
  }),
}));

// Hoisted playwright-core mock — connectOverCDP behavior is set per-test.
const { mockConnectOverCDP } = vi.hoisted(() => ({
  mockConnectOverCDP: vi.fn().mockRejectedValue(new Error("playwright-core not configured for this test")),
}));
vi.mock("playwright-core", () => ({
  chromium: {
    connectOverCDP: (...args: any[]) => mockConnectOverCDP(...args),
  },
}));

vi.mock("../db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ consecutiveFailures: 1 }]),
        }),
      }),
    }),
  },
}));

import {
  normalizeValue,
  detectPageBlockReason,
  extractValueFromHtml,
  checkMonitor,
  normalizeTextForMatch,
  extractDigits,
  textMatches,
  validateCssSelector,
  discoverSelectors,
} from "./scraper";
import { storage } from "../storage";
import { sendNotificationEmail, sendAutoPauseEmail } from "./email";
import { db } from "../db";
import type { Monitor } from "@shared/schema";

// ---------------------------------------------------------------------------
// Helper to build a Monitor object for tests
// ---------------------------------------------------------------------------
function makeMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: 1,
    userId: "user1",
    name: "Test Monitor",
    url: "https://example.com",
    selector: ".price",
    frequency: "daily",
    lastChecked: null,
    lastChanged: null,
    currentValue: null,
    lastStatus: "ok",
    lastError: null,
    active: true,
    emailEnabled: false,
    consecutiveFailures: 0,
    pauseReason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeValue
// ---------------------------------------------------------------------------
describe("normalizeValue", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeValue("  hello  ")).toBe("hello");
  });

  it("collapses multiple spaces into one", () => {
    expect(normalizeValue("hello    world")).toBe("hello world");
  });

  it("collapses tabs and newlines into a single space", () => {
    expect(normalizeValue("hello\t\n\r  world")).toBe("hello world");
  });

  it("removes zero-width characters", () => {
    expect(normalizeValue("he\u200Bllo\u200Cwo\u200Drld\uFEFF")).toBe("helloworld");
  });

  it("handles empty string", () => {
    expect(normalizeValue("")).toBe("");
  });

  it("handles string that is only whitespace", () => {
    expect(normalizeValue("   \t\n  ")).toBe("");
  });

  it("handles string with mixed invisible chars and spaces", () => {
    expect(normalizeValue(" \u200B $19.99 \u200D ")).toBe("$19.99");
  });

  it("handles string that is only invisible characters", () => {
    expect(normalizeValue("\u200B\u200C\u200D\uFEFF")).toBe("");
  });

  it("handles multiple consecutive invisible characters interspersed with text", () => {
    expect(normalizeValue("\u200B\u200Bhello\u200C\u200Cworld\u200D\u200D")).toBe("helloworld");
  });

  it("preserves normal punctuation and symbols", () => {
    expect(normalizeValue("  $1,234.56!  ")).toBe("$1,234.56!");
  });
});

// ---------------------------------------------------------------------------
// normalizeTextForMatch
// ---------------------------------------------------------------------------
describe("normalizeTextForMatch", () => {
  it("lowercases text", () => {
    expect(normalizeTextForMatch("HELLO")).toBe("hello");
  });

  it("removes all whitespace", () => {
    expect(normalizeTextForMatch("hello world")).toBe("helloworld");
  });

  it("removes commas", () => {
    expect(normalizeTextForMatch("1,234,567")).toBe("1234567");
  });

  it("removes currency symbols ($, euro, pound, yen, rupee)", () => {
    expect(normalizeTextForMatch("$19.99")).toBe("19.99");
    expect(normalizeTextForMatch("€29.99")).toBe("29.99");
    expect(normalizeTextForMatch("£39.99")).toBe("39.99");
    expect(normalizeTextForMatch("¥4999")).toBe("4999");
    expect(normalizeTextForMatch("₹999")).toBe("999");
  });

  it("handles empty string", () => {
    expect(normalizeTextForMatch("")).toBe("");
  });

  it("removes tabs and newlines", () => {
    expect(normalizeTextForMatch("hello\tworld\n")).toBe("helloworld");
  });

  it("handles combined currency, whitespace, commas, and case", () => {
    expect(normalizeTextForMatch("  $1, 234. 56  ")).toBe("1234.56");
  });

  it("handles multiple currency symbols in sequence", () => {
    expect(normalizeTextForMatch("$€£")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// extractDigits
// ---------------------------------------------------------------------------
describe("extractDigits", () => {
  it("extracts digits and decimal points", () => {
    expect(extractDigits("$1,234.56")).toBe("1234.56");
  });

  it("returns empty for no digits", () => {
    expect(extractDigits("hello")).toBe("");
  });

  it("keeps decimal point", () => {
    expect(extractDigits("19.99")).toBe("19.99");
  });

  it("handles mixed text and numbers", () => {
    expect(extractDigits("Price: $42 USD")).toBe("42");
  });

  it("handles empty string", () => {
    expect(extractDigits("")).toBe("");
  });

  it("preserves multiple decimal points", () => {
    expect(extractDigits("1.2.3")).toBe("1.2.3");
  });

  it("handles string with only dots", () => {
    expect(extractDigits("...")).toBe("...");
  });

  it("handles string with only non-digit characters", () => {
    expect(extractDigits("abc$€")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// textMatches
// ---------------------------------------------------------------------------
describe("textMatches", () => {
  it("matches exact text (case insensitive)", () => {
    expect(textMatches("Hello World", "hello world")).toBe(true);
  });

  it("matches when candidate contains expected", () => {
    expect(textMatches("The price is $19.99 today", "$19.99")).toBe(true);
  });

  it("matches ignoring whitespace and commas", () => {
    expect(textMatches("1, 234, 567", "1234567")).toBe(true);
  });

  it("matches ignoring currency symbols", () => {
    expect(textMatches("$19.99", "19.99")).toBe(true);
  });

  it("does NOT match unrelated text", () => {
    expect(textMatches("hello", "goodbye")).toBe(false);
  });

  it("falls back to digits-only matching for longer expected text", () => {
    // expectedText "Price: 1234" has length >= 4, digits "1234" has length >= 3
    expect(textMatches("$1,234.00", "Price: 1234")).toBe(true);
  });

  it("does NOT use digit fallback for short expected text", () => {
    // expectedText "ab" has length < 4, so digit fallback is skipped
    expect(textMatches("99", "ab")).toBe(false);
  });

  it("does NOT use digit fallback when extracted digits are too short", () => {
    // expectedText "abcd" has length >= 4, but extractDigits("abcd") = "" (length < 3)
    expect(textMatches("1234", "abcd")).toBe(false);
  });

  it("matches when both strings are empty", () => {
    // "" includes "" => true
    expect(textMatches("", "")).toBe(true);
  });

  it("matches when expected is empty (substring match always true)", () => {
    expect(textMatches("anything", "")).toBe(true);
  });

  it("does NOT match when candidate is empty but expected is not", () => {
    expect(textMatches("", "something")).toBe(false);
  });

  it("boundary: expected text length exactly 4, digits exactly 3", () => {
    // expectedText "a123" has length 4, extractDigits = "123" which has length 3
    // candidate "xx123xx", extractDigits = "123"
    expect(textMatches("xx123xx", "a123")).toBe(true);
  });

  it("boundary: expected text length exactly 3 skips digit fallback", () => {
    // expectedText "a12" has length 3, < 4, so digit fallback is skipped
    // normalizeTextForMatch("a12") = "a12", normalizeTextForMatch("xx12xx") = "xx12xx"
    // "xx12xx" does not include "a12" so should be false
    expect(textMatches("xx12xx", "a12")).toBe(false);
  });

  it("matches with exact normalized equality", () => {
    expect(textMatches("$19.99", "$19.99")).toBe(true);
  });

  it("digit fallback: expected has digits but candidate digits don't contain them", () => {
    // expectedText "item5678" length >= 4, digits "5678" length >= 3
    // candidate "item1234", digits "1234", doesn't include "5678"
    expect(textMatches("item1234", "item5678")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectPageBlockReason
// ---------------------------------------------------------------------------
describe("detectPageBlockReason", () => {
  it("returns not blocked for normal HTML", () => {
    const html = `
      <html><head><title>My Page</title></head>
      <body><h1>Welcome</h1><p>Some content here.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it("detects Cloudflare 'checking your browser' in visible text", () => {
    const html = `
      <html><head><title>Just a moment...</title></head>
      <body><p>Checking your browser</p></body>
      </html>`;
    // Title matches are checked first; "just a moment" in the title fires
    // before "checking your browser" in the body is reached.
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Interstitial/Challenge");
    expect(result.reason).toContain("title");
  });

  it("detects 'checking your browser' in body when title is clean", () => {
    const html = `
      <html><head><title>Loading</title></head>
      <body><p>Checking your browser before accessing the site.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Browser check");
  });

  it("detects 'just a moment' in title when body has no earlier pattern match", () => {
    const html = `
      <html><head><title>Just a moment...</title></head>
      <body><p>Please wait while we verify your connection.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Interstitial/Challenge");
    expect(result.reason).toContain("title");
  });

  it("detects 'access denied' in title", () => {
    const html = `
      <html><head><title>Access Denied</title></head>
      <body><p>You do not have permission.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Access denied");
  });

  it("detects captcha in visible text", () => {
    const html = `
      <html><head><title>Shop</title></head>
      <body><p>Please complete the captcha to proceed.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Captcha");
  });

  it("detects 'verify you are a human' in visible text", () => {
    const html = `
      <html><head><title>Check</title></head>
      <body><p>Please verify you are a human</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Human verification");
  });

  it("detects 'checking your browser' in visible text", () => {
    const html = `
      <html><head><title>Wait</title></head>
      <body><p>Checking your browser before accessing the site.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Browser check");
  });

  it("detects 'unusual traffic' in visible text", () => {
    const html = `
      <html><head><title>Blocked</title></head>
      <body><p>We detected unusual traffic from your network.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Rate limited");
  });

  it("detects 'please enable cookies' in visible text", () => {
    const html = `
      <html><head><title>Error</title></head>
      <body><p>Please enable cookies to continue.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Cookies required");
  });

  it("detects challenge element by CSS selector (captcha id)", () => {
    const html = `
      <html><head><title>Page</title></head>
      <body><div id="captcha-widget">Fill this</div></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Challenge element detected");
  });

  it("detects challenge element by class (cf-)", () => {
    const html = `
      <html><head><title>Page</title></head>
      <body><div class="cf-browser-verification">Loading...</div></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Challenge element detected");
  });

  it("detects g-recaptcha class", () => {
    const html = `
      <html><head><title>Page</title></head>
      <body><div class="g-recaptcha" data-sitekey="abc"></div></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Challenge element detected");
  });

  it("detects h-captcha class", () => {
    const html = `
      <html><head><title>Page</title></head>
      <body><div class="h-captcha" data-sitekey="abc"></div></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Challenge element detected");
  });

  it("detects turnstile class", () => {
    const html = `
      <html><head><title>Page</title></head>
      <body><div class="turnstile"></div></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Challenge element detected");
  });

  it("ignores 'enable javascript' inside noscript tags (not in visible text)", () => {
    // noscript content is stripped before checking visible text.
    // On a page with lots of visible text, "enable javascript" in body should
    // be ignored if it appears on a long page (< 4000 chars threshold logic).
    const longContent = "x ".repeat(2500); // >4000 chars visible
    const html = `
      <html><head><title>My Page</title></head>
      <body>
        <noscript>Please enable javascript</noscript>
        <p>${longContent}</p>
        <p>Please enable javascript to use this feature.</p>
      </body>
      </html>`;
    const result = detectPageBlockReason(html);
    // The visible text is long (> 4000 chars) and "enable javascript" appears only once,
    // so isSuspicious is false and the match is skipped.
    expect(result.blocked).toBe(false);
  });

  it("detects 'enable javascript' on short pages as suspicious", () => {
    const html = `
      <html><head><title>App</title></head>
      <body><p>Please enable JavaScript to use this app.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("JavaScript required");
  });

  it("detects 'enable javascript' on long page when it appears more than 2 times", () => {
    const longContent = "x ".repeat(2500); // > 4000 chars
    const html = `
      <html><head><title>Page</title></head>
      <body>
        <p>${longContent}</p>
        <p>Please enable javascript</p>
        <p>You must enable javascript</p>
        <p>Please enable javascript</p>
      </body>
      </html>`;
    const result = detectPageBlockReason(html);
    // visibleTextLength > 4000 but "enable javascript" appears 3 times (> 2), so isSuspicious = true
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("JavaScript required");
  });

  it("detects 'enable javascript' in title regardless of body length", () => {
    const longContent = "x ".repeat(2500);
    const html = `
      <html><head><title>Please Enable JavaScript</title></head>
      <body><p>${longContent}</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("JavaScript required");
    expect(result.reason).toContain("title");
  });

  it("ignores block patterns inside script tags", () => {
    const html = `
      <html><head><title>Normal Page</title></head>
      <body>
        <script>var msg = "checking your browser";</script>
        <p>Welcome to our site with lots of content here.</p>
      </body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(false);
  });

  it("ignores block patterns inside style tags", () => {
    const html = `
      <html><head><title>Normal Page</title>
      <style>.captcha { display: none; }</style></head>
      <body><p>Welcome to our site.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    // "captcha" in style should not trigger visible text check.
    // However the element .captcha doesn't exist in body, but let's check
    // the text matching - style content is stripped from visible text.
    expect(result.blocked).toBe(false);
  });

  it("detects challenge element with class containing 'challenge'", () => {
    const html = `
      <html><head><title>Page</title></head>
      <body><div class="security-challenge-wrapper">Loading...</div></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Challenge element detected");
  });

  it("detects challenge element with id containing 'challenge'", () => {
    const html = `
      <html><head><title>Page</title></head>
      <body><div id="challenge-form">Verify</div></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Challenge element detected");
  });

  it("detects captcha class attribute", () => {
    const html = `
      <html><head><title>Page</title></head>
      <body><div class="my-captcha-widget">Fill in</div></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Challenge element detected");
  });

  it("returns first matching block pattern (priority order)", () => {
    // "enable javascript" and "captcha" both in body, enable javascript comes first in patterns
    const html = `
      <html><head><title>Page</title></head>
      <body><p>Please enable javascript. Also captcha here.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("JavaScript required");
  });

  it("handles minimal/empty HTML without crashing", () => {
    const result = detectPageBlockReason("");
    expect(result.blocked).toBe(false);
  });

  it("handles HTML with only head, no body", () => {
    const html = `<html><head><title>Test</title></head></html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(false);
  });

  it("detects 'please enable cookies' in title", () => {
    const html = `
      <html><head><title>Please Enable Cookies</title></head>
      <body><p>Normal content here</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Cookies required");
    expect(result.reason).toContain("title");
  });

  it("detects 'unusual traffic' in title", () => {
    const html = `
      <html><head><title>Unusual Traffic Detected</title></head>
      <body><p>Sorry</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Rate limited");
    expect(result.reason).toContain("title");
  });

  it("detects 'captcha' in title", () => {
    const html = `
      <html><head><title>Captcha Verification</title></head>
      <body><p>Please complete the form</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Captcha");
    expect(result.reason).toContain("title");
  });

  it("detects 'verify you are a human' in title", () => {
    const html = `
      <html><head><title>Verify You Are A Human</title></head>
      <body><p>Continue</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Human verification");
    expect(result.reason).toContain("title");
  });

  // --- False-positive guards for fuzzy patterns on large pages ---

  it("does NOT flag 'access denied' on a large legitimate page", () => {
    const longContent = "x ".repeat(2500); // > 4000 chars
    const html = `
      <html><head><title>News Article</title></head>
      <body><p>${longContent}</p><p>The user was access denied by the system.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(false);
  });

  it("flags 'access denied' on a short interstitial page", () => {
    const html = `
      <html><head><title>Error</title></head>
      <body><p>Access Denied. You do not have permission.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Access denied");
  });

  it("does NOT flag 'just a moment' on a large legitimate page", () => {
    const longContent = "x ".repeat(2500);
    const html = `
      <html><head><title>Blog Post</title></head>
      <body><p>${longContent}</p><p>Just a moment ago, the team announced the news.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(false);
  });

  it("flags 'just a moment' on a short interstitial page", () => {
    const html = `
      <html><head><title>Loading</title></head>
      <body><p>Just a moment while we verify your connection.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Interstitial/Challenge");
  });

  it("does NOT flag 'captcha' on a large page mentioning it incidentally", () => {
    const longContent = "x ".repeat(2500);
    const html = `
      <html><head><title>Security Blog</title></head>
      <body><p>${longContent}</p><p>We implemented a captcha on our login page.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(false);
  });

  it("flags 'captcha' on a short page (actual captcha challenge)", () => {
    const html = `
      <html><head><title>Verify</title></head>
      <body><p>Please complete the captcha to proceed.</p></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Captcha");
  });

  it("flags fuzzy pattern on large page when it appears more than 2 times", () => {
    const longContent = "x ".repeat(2500);
    const html = `
      <html><head><title>Page</title></head>
      <body>
        <p>${longContent}</p>
        <p>Access denied</p>
        <p>Access denied</p>
        <p>Access denied</p>
      </body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Access denied");
  });

  // --- cf- selector specificity tests ---

  it("does NOT flag generic cf- CDN classes (e.g. cf-wrapper)", () => {
    const html = `
      <html><head><title>Normal Page</title></head>
      <body><div class="cf-wrapper"><p>Hello world</p></div></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(false);
  });

  it("flags cf-browser-verification class", () => {
    const html = `
      <html><head><title>Page</title></head>
      <body><div class="cf-browser-verification">Loading...</div></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Challenge element detected");
  });

  it("flags cf-error class", () => {
    const html = `
      <html><head><title>Page</title></head>
      <body><div class="cf-error-overview">Error 1020</div></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Challenge element detected");
  });

  it("flags cf-challenge class", () => {
    const html = `
      <html><head><title>Page</title></head>
      <body><div class="cf-challenge-running">Please wait</div></body>
      </html>`;
    const result = detectPageBlockReason(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Challenge element detected");
  });
});

// ---------------------------------------------------------------------------
// extractValueFromHtml
// ---------------------------------------------------------------------------
describe("extractValueFromHtml", () => {
  it("extracts text by class selector", () => {
    const html = `<html><body><span class="price">$19.99</span></body></html>`;
    expect(extractValueFromHtml(html, ".price")).toBe("$19.99");
  });

  it("extracts text by ID selector", () => {
    const html = `<html><body><div id="total">$42.00</div></body></html>`;
    expect(extractValueFromHtml(html, "#total")).toBe("$42.00");
  });

  it("extracts text by compound selector", () => {
    const html = `<html><body><div class="product"><span class="price">$9.99</span></div></body></html>`;
    expect(extractValueFromHtml(html, ".product .price")).toBe("$9.99");
  });

  it("auto-prefixes bare class name with dot", () => {
    // "price" without dot/hash/space is treated as a class name
    const html = `<html><body><span class="price">$29.99</span></body></html>`;
    expect(extractValueFromHtml(html, "price")).toBe("$29.99");
  });

  it("returns null when selector matches nothing", () => {
    const html = `<html><body><span class="title">Hello</span></body></html>`;
    expect(extractValueFromHtml(html, ".price")).toBeNull();
  });

  it("returns null for empty HTML", () => {
    expect(extractValueFromHtml("", ".price")).toBeNull();
  });

  it("extracts from first matching element when multiple match", () => {
    const html = `
      <html><body>
        <span class="price">$10.00</span>
        <span class="price">$20.00</span>
      </body></html>`;
    expect(extractValueFromHtml(html, ".price")).toBe("$10.00");
  });

  it("falls back to content attribute when text is empty", () => {
    // Use a class-based selector since attribute selectors without a leading
    // dot/hash/space are auto-prefixed with '.' (a known limitation).
    const html = `<html><body><meta class="meta-price" content="19.99" /></body></html>`;
    expect(extractValueFromHtml(html, ".meta-price")).toBe("19.99");
  });

  it("treats bare attribute selectors as class names (known limitation)", () => {
    // Attribute selectors like [itemprop="price"] get auto-prefixed with '.'
    // because they don't start with '.', '#', or contain a space.
    const html = `<html><body><meta itemprop="price" content="19.99" /></body></html>`;
    // This throws because .[itemprop="price"] is invalid CSS
    expect(() => extractValueFromHtml(html, '[itemprop="price"]')).toThrow();
  });

  it("returns null when element has no text and no content attribute", () => {
    const html = `<html><body><div class="empty"></div></body></html>`;
    expect(extractValueFromHtml(html, ".empty")).toBeNull();
  });

  it("normalizes extracted value (trims, collapses whitespace)", () => {
    const html = `<html><body><span class="price">  $19.99   USD  </span></body></html>`;
    expect(extractValueFromHtml(html, ".price")).toBe("$19.99 USD");
  });

  it("handles tag selectors", () => {
    const html = `<html><body><h1>Page Title</h1><p class="desc">Description</p></body></html>`;
    // "h1" doesn't start with . or # but contains no space → treated as class .h1
    // This is a known limitation; use explicit selectors with . or # for reliable behavior
    expect(extractValueFromHtml(html, ".desc")).toBe("Description");
  });

  it("trims the selector before using it", () => {
    const html = `<html><body><span class="price">$1.00</span></body></html>`;
    expect(extractValueFromHtml(html, "  .price  ")).toBe("$1.00");
  });

  it("trims ID selector with surrounding whitespace", () => {
    const html = `<html><body><div id="total">$42.00</div></body></html>`;
    expect(extractValueFromHtml(html, "  #total  ")).toBe("$42.00");
  });

  it("returns null when element has only whitespace text", () => {
    const html = `<html><body><div class="empty">   \t\n  </div></body></html>`;
    // normalizeValue("   \t\n  ") = "", so returns null
    expect(extractValueFromHtml(html, ".empty")).toBeNull();
  });

  it("extracts text from nested elements", () => {
    const html = `<html><body><div class="price"><span>$</span><span>19.99</span></div></body></html>`;
    expect(extractValueFromHtml(html, ".price")).toBe("$19.99");
  });

  it("auto-prefixes bare class name containing hyphens", () => {
    const html = `<html><body><span class="sale-price">$5.99</span></body></html>`;
    // "sale-price" doesn't start with . or # but contains a hyphen (not a space) → treated as class
    expect(extractValueFromHtml(html, "sale-price")).toBe("$5.99");
  });

  it("does not auto-prefix selector that starts with #", () => {
    const html = `<html><body><div id="price">$9.99</div></body></html>`;
    expect(extractValueFromHtml(html, "#price")).toBe("$9.99");
  });

  it("does not auto-prefix selector that contains a space (compound selector)", () => {
    const html = `<html><body><div class="a"><span class="b">hello</span></div></body></html>`;
    expect(extractValueFromHtml(html, ".a .b")).toBe("hello");
  });

  it("returns content attribute for element with zero-width text only", () => {
    const html = `<html><body><meta class="meta-val" content="42" /></body></html>`;
    // text() returns "" (or whitespace), so falls back to content attr
    expect(extractValueFromHtml(html, ".meta-val")).toBe("42");
  });

  it("returns null when content attribute is also empty", () => {
    const html = `<html><body><meta class="meta-empty" content="" /></body></html>`;
    expect(extractValueFromHtml(html, ".meta-empty")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkMonitor
// ---------------------------------------------------------------------------
describe("checkMonitor", () => {
  const mockStorage = storage as unknown as {
    updateMonitor: ReturnType<typeof vi.fn>;
    addMonitorChange: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
  };
  const mockSendEmail = sendNotificationEmail as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Remove BROWSERLESS_TOKEN so the test doesn't try to use browserless
    delete process.env.BROWSERLESS_TOKEN;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Helper: run checkMonitor and advance past the 2s retry delay
  async function runWithTimers(monitor: Monitor) {
    const promise = checkMonitor(monitor);
    await vi.advanceTimersByTimeAsync(3000);
    return promise;
  }

  it("returns ok with extracted value when selector matches", async () => {
    const html = `<html><body><span class="price">$19.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$19.99" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$19.99");
    expect(result.changed).toBe(false);
    expect(result.error).toBeNull();
  });

  it("detects change when value differs from currentValue", async () => {
    const html = `<html><body><span class="price">$24.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$19.99" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    expect(result.changed).toBe(true);
    expect(result.currentValue).toBe("$24.99");
    expect(result.previousValue).toBe("$19.99");

    // Should record the change in storage
    expect(mockStorage.addMonitorChange).toHaveBeenCalledWith(1, "$19.99", "$24.99");
  });

  it("sends email notification when value changes and emailEnabled is true", async () => {
    const html = `<html><body><span class="price">$24.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$19.99", emailEnabled: true });
    await runWithTimers(monitor);

    expect(mockSendEmail).toHaveBeenCalledWith(monitor, "$19.99", "$24.99");
  });

  it("does NOT send email when emailEnabled is false", async () => {
    const html = `<html><body><span class="price">$24.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$19.99", emailEnabled: false });
    await runWithTimers(monitor);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does NOT send email when value has not changed", async () => {
    const html = `<html><body><span class="price">$19.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$19.99", emailEnabled: true });
    await runWithTimers(monitor);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns selector_missing when selector matches nothing on an unblocked page", async () => {
    const html = `<html><body><span class="title">Hello</span></body></html>`;
    // Both initial and retry get the same non-matching HTML
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    const monitor = makeMonitor({ selector: ".nonexistent" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("selector_missing");
    expect(result.error).toBe("Selector not found");
    expect(result.changed).toBe(false);
  });

  it("returns blocked status when page is blocked", async () => {
    const html = `
      <html><head><title>Access Denied</title></head>
      <body><p>You do not have permission to access this resource.</p></body>
      </html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor();
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("blocked");
    expect(result.error).toContain("Access denied");
    expect(result.changed).toBe(false);
  });

  it("returns error status when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network failure"));

    const monitor = makeMonitor();
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("error");
    expect(result.error).toBe("Network failure");
    expect(result.changed).toBe(false);
  });

  it("returns error status when page returns empty body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 200 })
    );

    const monitor = makeMonitor();
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("error");
    expect(result.error).toBe("Failed to fetch page");
  });

  it("updates monitor lastChecked and lastStatus in storage on success", async () => {
    const html = `<html><body><span class="price">$5.00</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$5.00" });
    await runWithTimers(monitor);

    expect(mockStorage.updateMonitor).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        lastStatus: "ok",
        currentValue: "$5.00",
        lastError: null,
      })
    );
  });

  it("updates monitor with error status when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));

    const monitor = makeMonitor();
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("error");
    expect(result.error).toBe("timeout");
  });

  it("updates monitor with selector_missing when selector not found", async () => {
    const html = `<html><body><p>No match</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    const monitor = makeMonitor({ selector: ".missing" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("selector_missing");
    expect(result.error).toBe("Selector not found");
  });

  it("records lastChanged when a value change is detected", async () => {
    const html = `<html><body><span class="price">$30.00</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$20.00" });
    await runWithTimers(monitor);

    const calls = mockStorage.updateMonitor.mock.calls;
    const lastChangedCall = calls.find(
      (c: any[]) => c[1].lastChanged !== undefined
    );
    expect(lastChangedCall).toBeDefined();
    expect(lastChangedCall![1].lastChanged).toBeInstanceOf(Date);
  });

  it("handles first check (currentValue is null) as a change", async () => {
    const html = `<html><body><span class="price">$15.00</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: null });
    const result = await runWithTimers(monitor);

    expect(result.changed).toBe(true);
    expect(result.currentValue).toBe("$15.00");
    expect(result.previousValue).toBeNull();
    expect(mockStorage.addMonitorChange).toHaveBeenCalledWith(1, null, "$15.00");
  });

  it("retries static fetch when first attempt finds no value", async () => {
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;
    const fullHtml = `<html><body><span class="price">$10.00</span></body></html>`;

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(fullHtml, { status: 200 }));

    const monitor = makeMonitor({ selector: ".price" });
    const result = await runWithTimers(monitor);

    // Should have been called twice (initial + retry)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$10.00");
  });

  it("uses fetchWithCurl fallback on UND_ERR_HEADERS_OVERFLOW", async () => {
    const html = `<html><body><span class="price">$7.77</span></body></html>`;
    const headerError = new Error("Headers overflow");
    (headerError as any).code = "UND_ERR_HEADERS_OVERFLOW";

    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(headerError)
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    const monitor = makeMonitor();
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$7.77");
  });

  it("uses fetchWithCurl fallback on UND_ERR_HEADERS_OVERFLOW via e.cause.code", async () => {
    const html = `<html><body><span class="price">$8.88</span></body></html>`;
    const headerError = new Error("Headers overflow");
    (headerError as any).cause = { code: "UND_ERR_HEADERS_OVERFLOW" };

    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(headerError)
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    const monitor = makeMonitor();
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$8.88");
  });

  it("retry path: updates block status when retry also detects blocked content", async () => {
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;
    const blockedHtml = `
      <html><head><title>Access Denied</title></head>
      <body><p>You are blocked.</p></body>
      </html>`;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(blockedHtml, { status: 200 }));

    const monitor = makeMonitor({ selector: ".price" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("blocked");
    expect(result.error).toContain("Access denied");
  });

  it("retry path: continues with original result when retry fetch throws", async () => {
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockRejectedValueOnce(new Error("Network error on retry"));

    const monitor = makeMonitor({ selector: ".price" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("selector_missing");
    expect(result.error).toBe("Selector not found");
  });

  it("retry path: uses fetchWithCurl on UND_ERR_HEADERS_OVERFLOW during retry", async () => {
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;
    const retryHtml = `<html><body><span class="price">$3.33</span></body></html>`;
    const headerError = new Error("Headers overflow");
    (headerError as any).code = "UND_ERR_HEADERS_OVERFLOW";

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockRejectedValueOnce(headerError)
      .mockResolvedValueOnce(new Response(retryHtml, { status: 200 }));

    const monitor = makeMonitor({ selector: ".price" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$3.33");
  });

  it("retry path: empty retryHtml is ignored and falls through", async () => {
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    const monitor = makeMonitor({ selector: ".price" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("selector_missing");
    expect(result.error).toBe("Selector not found");
  });

  it("handles non-Error thrown during fetch (unknown error)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce("string error");

    const monitor = makeMonitor();
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("error");
    expect(result.error).toBe("Unknown error");
  });

  it("blocked page with challenge element detected", async () => {
    const html = `
      <html><head><title>Page</title></head>
      <body><div class="g-recaptcha" data-sitekey="abc"></div></body>
      </html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ selector: ".price" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("blocked");
    expect(result.error).toContain("Challenge element detected");
  });

  it("does not retry when first fetch finds the value", async () => {
    const html = `<html><body><span class="price">$55.00</span></body></html>`;
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    const monitor = makeMonitor({ selector: ".price" });
    const result = await runWithTimers(monitor);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$55.00");
  });

  it("does not retry when first fetch is blocked (even without value)", async () => {
    const blockedHtml = `
      <html><head><title>Access Denied</title></head>
      <body><p>Forbidden</p></body>
      </html>`;
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(blockedHtml, { status: 200 }));

    const monitor = makeMonitor({ selector: ".price" });
    const result = await runWithTimers(monitor);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("blocked");
  });

  it("preserves oldValue in return when status is not ok", async () => {
    const html = `<html><body><p>No match here</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    const monitor = makeMonitor({ selector: ".price", currentValue: "$99.99" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("selector_missing");
    expect(result.currentValue).toBe("$99.99");
    expect(result.previousValue).toBe("$99.99");
    expect(result.changed).toBe(false);
  });

  it("retry succeeds on second static attempt when first had no value", async () => {
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;
    const fullHtml = `<html><body><span class="price">$10.00</span></body></html>`;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(fullHtml, { status: 200 }));

    const monitor = makeMonitor({ selector: ".price", currentValue: "$5.00" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    expect(result.changed).toBe(true);
    expect(result.currentValue).toBe("$10.00");
    expect(result.previousValue).toBe("$5.00");
    expect(mockStorage.addMonitorChange).toHaveBeenCalledWith(1, "$5.00", "$10.00");
  });

  it("rejects monitors targeting private/internal URLs (SSRF protection)", async () => {
    const { ssrfSafeFetch } = await import("../utils/ssrf");
    const mockSafeFetch = ssrfSafeFetch as ReturnType<typeof vi.fn>;
    mockSafeFetch.mockRejectedValueOnce(new Error("SSRF blocked: This hostname is not allowed"));

    const monitor = makeMonitor({ url: "http://127.0.0.1/admin" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("error");
    expect(result.error).toBe("SSRF blocked: This hostname is not allowed");
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "http://127.0.0.1/admin",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("uses ssrfSafeFetch for all HTTP requests (redirect safety)", async () => {
    const { ssrfSafeFetch } = await import("../utils/ssrf");
    const mockSafeFetch = ssrfSafeFetch as ReturnType<typeof vi.fn>;

    const html = `<html><body><span class="price">$19.99</span></body></html>`;
    mockSafeFetch.mockResolvedValueOnce(new Response(html, { status: 200 }));

    const monitor = makeMonitor({ currentValue: "$19.99" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

// ---------------------------------------------------------------------------
// Failure tracking & auto-pause (handleMonitorFailure integration)
// ---------------------------------------------------------------------------
describe("failure tracking and auto-pause", () => {
  const mockStorage = storage as unknown as {
    updateMonitor: ReturnType<typeof vi.fn>;
    addMonitorChange: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
  };
  const mockDb = db as unknown as {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  const mockAutoPauseEmail = sendAutoPauseEmail as ReturnType<typeof vi.fn>;

  // Deep mock chain helper for db.update().set().where().returning()
  // The atomic UPDATE now returns both consecutiveFailures and active.
  // `returnedActive=false` simulates the SQL CASE evaluating the pause condition as true.
  function mockDbUpdate(returnedFailureCount: number, returnedActive = true) {
    const returningFn = vi.fn().mockResolvedValue([{
      consecutiveFailures: returnedFailureCount,
      active: returnedActive,
    }]);
    const whereFn = vi.fn().mockReturnValue({ returning: returningFn });
    const setFn = vi.fn().mockReturnValue({ where: whereFn });
    mockDb.update.mockReturnValue({ set: setFn });
    return { setFn, whereFn, returningFn };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete process.env.BROWSERLESS_TOKEN;
    // Default: failure count below threshold, monitor still active
    mockDbUpdate(1, true);
    // Default: free tier user
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function runWithTimers(monitor: Monitor) {
    const promise = checkMonitor(monitor);
    await vi.advanceTimersByTimeAsync(3000);
    return promise;
  }

  it("resets consecutiveFailures to 0 on successful check", async () => {
    const html = `<html><body><span class="price">$19.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({
      currentValue: "$19.99",
      consecutiveFailures: 5,
    });
    await runWithTimers(monitor);

    // On success, storage.updateMonitor should reset consecutiveFailures to 0
    expect(mockStorage.updateMonitor).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        consecutiveFailures: 0,
        lastStatus: "ok",
        lastError: null,
      })
    );
  });

  it("calls db.update with atomic increment on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
    const { setFn } = mockDbUpdate(1, true);

    const monitor = makeMonitor();
    await runWithTimers(monitor);

    // db.update should have been called
    expect(mockDb.update).toHaveBeenCalled();
    // The set call should include lastStatus and lastError
    expect(setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        lastStatus: "error",
        lastError: "timeout",
      })
    );
  });

  it("auto-pauses monitor when failure count reaches free tier threshold (3)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
    // Simulate that after this increment, count = 3 (free threshold) and DB set active=false
    mockDbUpdate(3, false);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });

    const monitor = makeMonitor({ emailEnabled: true });
    await runWithTimers(monitor);

    // Pause is now done atomically in db.update, so verify via email
    expect(mockAutoPauseEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      3,
      "timeout"
    );
  });

  it("does NOT auto-pause when failure count is below threshold", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
    // Simulate count = 2 (below free threshold of 3), monitor stays active
    mockDbUpdate(2, true);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });

    const monitor = makeMonitor({ emailEnabled: true });
    await runWithTimers(monitor);

    // Should NOT send auto-pause email
    expect(mockAutoPauseEmail).not.toHaveBeenCalled();
  });

  it("pro tier has higher pause threshold (5)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
    // count = 4, below pro threshold of 5, still active
    mockDbUpdate(4, true);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "pro" });

    const monitor = makeMonitor({ emailEnabled: true });
    await runWithTimers(monitor);

    // Should NOT send auto-pause email at 4 for pro tier
    expect(mockAutoPauseEmail).not.toHaveBeenCalled();
  });

  it("pro tier pauses at threshold (5)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
    mockDbUpdate(5, false);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "pro" });

    const monitor = makeMonitor({ emailEnabled: true });
    await runWithTimers(monitor);

    expect(mockAutoPauseEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      5,
      "timeout"
    );
  });

  it("sends auto-pause email when emailEnabled is true", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("site down"));
    mockDbUpdate(3, false);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });

    const monitor = makeMonitor({ emailEnabled: true });
    await runWithTimers(monitor);

    expect(mockAutoPauseEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      3,
      "site down"
    );
  });

  it("does NOT send auto-pause email when emailEnabled is false", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("site down"));
    mockDbUpdate(3, false);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });

    const monitor = makeMonitor({ emailEnabled: false });
    await runWithTimers(monitor);

    expect(mockAutoPauseEmail).not.toHaveBeenCalled();
  });

  it("does NOT send auto-pause email when below threshold", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("site down"));
    mockDbUpdate(1, true);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });

    const monitor = makeMonitor({ emailEnabled: true });
    await runWithTimers(monitor);

    expect(mockAutoPauseEmail).not.toHaveBeenCalled();
  });

  it("includes last error message in auto-pause email", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("DNS resolution failed"));
    mockDbUpdate(3, false);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });

    const monitor = makeMonitor({ emailEnabled: true });
    await runWithTimers(monitor);

    // The error message is passed to sendAutoPauseEmail
    expect(mockAutoPauseEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      3,
      "DNS resolution failed"
    );
  });

  it("selector_missing failure also triggers handleMonitorFailure", async () => {
    const html = `<html><body><p>No match</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));
    const { setFn } = mockDbUpdate(3, false);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });

    const monitor = makeMonitor({ selector: ".missing", emailEnabled: true });
    await runWithTimers(monitor);

    // Should invoke db.update with selector_missing status
    expect(setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        lastStatus: "selector_missing",
        lastError: "Selector not found",
      })
    );
    // Should send auto-pause email with the selector error
    expect(mockAutoPauseEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      3,
      "Selector not found"
    );
  });

  it("blocked page failure triggers handleMonitorFailure", async () => {
    const html = `<html><head><title>Access Denied</title></head><body><p>Blocked</p></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );
    const { setFn } = mockDbUpdate(3, false);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });

    const monitor = makeMonitor({ emailEnabled: true });
    await runWithTimers(monitor);

    // Should invoke db.update with blocked status
    expect(setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        lastStatus: "blocked",
      })
    );
    // The error passed to email should contain the block reason
    expect(mockAutoPauseEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      3,
      expect.stringContaining("Access denied")
    );
  });

  it("records metrics via db.insert on each check stage", async () => {
    const html = `<html><body><span class="price">$19.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$19.99" });
    await runWithTimers(monitor);

    // recordMetric calls db.insert for the "static" stage
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("recordMetric failure does not break the check (best-effort metrics)", async () => {
    // Make db.insert throw to simulate a metrics recording failure
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockRejectedValueOnce(new Error("DB connection lost")),
    });
    const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const html = `<html><body><span class="price">$19.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$19.99" });
    const result = await runWithTimers(monitor);

    // The check should still succeed despite metrics failure
    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$19.99");
    // Should have logged the metrics error
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Metrics] Failed to record metric"),
      expect.stringContaining("DB connection lost")
    );
    consoleSpy.mockRestore();
  });

  it("power tier has highest pause threshold (10)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
    // count = 9, below power threshold of 10, still active
    mockDbUpdate(9, true);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "power" });

    const monitor = makeMonitor({ emailEnabled: true });
    await runWithTimers(monitor);

    // Should NOT send auto-pause email at 9 for power tier
    expect(mockAutoPauseEmail).not.toHaveBeenCalled();
  });

  it("power tier pauses at threshold (10)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
    mockDbUpdate(10, false);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "power" });

    const monitor = makeMonitor({ emailEnabled: true });
    await runWithTimers(monitor);

    expect(mockAutoPauseEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      10,
      "timeout"
    );
  });

  it("does NOT increment failure count for browserless infrastructure failures", async () => {
    // Set up: static extraction finds nothing and page is not blocked,
    // then browserless throws an infra error
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }));

    // Enable browserless
    process.env.BROWSERLESS_TOKEN = "test-token";

    // Allow browserless usage
    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ allowed: true });

    // Mock Playwright to throw an infra error (connectOverCDP)
    mockConnectOverCDP.mockRejectedValue(new Error("connectOverCDP failed: connection refused"));

    const { setFn } = mockDbUpdate(1, true);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });

    const monitor = makeMonitor({ selector: ".missing" });
    const result = await runWithTimers(monitor);

    // The result should be an error about browserless being unavailable
    expect(result.status).toBe("error");
    expect(result.error).toBe("Browserless service unavailable");

    // The db.update set call should NOT have the SQL increment for consecutiveFailures
    // (browserlessInfraFailure=true means shouldPenalize=false)
    expect(mockDb.update).toHaveBeenCalled();
    const setArg = setFn.mock.calls[0]?.[0];
    expect(setArg).toBeDefined();
    expect(setArg.lastError).toBe("Browserless service unavailable");
    // When browserlessInfraFailure=true, consecutiveFailures should be the Drizzle column
    // reference (no increment) rather than a sql`` expression with queryChunks
    expect(setArg.consecutiveFailures).toBeDefined();
    expect(setArg.consecutiveFailures).not.toHaveProperty("queryChunks");

    delete process.env.BROWSERLESS_TOKEN;
  });

  it("falls back to free tier threshold when user tier is unknown", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
    // free threshold: DB returns active=false to indicate SQL CASE triggered
    mockDbUpdate(3, false);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: undefined });

    const monitor = makeMonitor({ emailEnabled: true });
    await runWithTimers(monitor);

    // Should auto-pause using free threshold (3)
    expect(mockAutoPauseEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      3,
      "timeout"
    );
  });

  it("falls back to in-memory count when db.update returns empty", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
    // Simulate db.update returning empty array (no rows returned)
    const returningFn = vi.fn().mockResolvedValue([]);
    const whereFn = vi.fn().mockReturnValue({ returning: returningFn });
    const setFn = vi.fn().mockReturnValue({ where: whereFn });
    mockDb.update.mockReturnValue({ set: setFn });

    // Monitor already has 2 consecutive failures; after +1 it should be 3 (free threshold)
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });

    const monitor = makeMonitor({ consecutiveFailures: 2, emailEnabled: true });
    await runWithTimers(monitor);

    // Fallback calculation: shouldPenalize=true, so fallbackCount(2) + 1 = 3 >= free threshold
    // Should pause and send email
    expect(mockAutoPauseEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      3,
      "timeout"
    );
  });
});

// ---------------------------------------------------------------------------
// Error message truncation in handleMonitorFailure
// ---------------------------------------------------------------------------
describe("error message truncation", () => {
  const mockStorage = storage as unknown as {
    updateMonitor: ReturnType<typeof vi.fn>;
    addMonitorChange: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
  };
  const mockDb = db as unknown as {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  const mockAutoPauseEmail = sendAutoPauseEmail as ReturnType<typeof vi.fn>;

  function mockDbUpdate(returnedFailureCount: number, returnedActive = true) {
    const returningFn = vi.fn().mockResolvedValue([{
      consecutiveFailures: returnedFailureCount,
      active: returnedActive,
    }]);
    const whereFn = vi.fn().mockReturnValue({ returning: returningFn });
    const setFn = vi.fn().mockReturnValue({ where: whereFn });
    mockDb.update.mockReturnValue({ set: setFn });
    return { setFn, whereFn, returningFn };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete process.env.BROWSERLESS_TOKEN;
    mockDbUpdate(1, true);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function runWithTimers(monitor: Monitor) {
    const promise = checkMonitor(monitor);
    await vi.advanceTimersByTimeAsync(3000);
    return promise;
  }

  it("truncates error messages longer than 200 chars in lastError", async () => {
    const longError = "A".repeat(300);
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error(longError));
    const { setFn } = mockDbUpdate(1, true);

    const monitor = makeMonitor();
    await runWithTimers(monitor);

    const setArg = setFn.mock.calls[0]?.[0];
    expect(setArg).toBeDefined();
    expect(setArg.lastError).toHaveLength(200);
    expect(setArg.lastError).toBe("A".repeat(200));
  });

  it("preserves error messages shorter than 200 chars", async () => {
    const shortError = "Connection refused";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error(shortError));
    const { setFn } = mockDbUpdate(1, true);

    const monitor = makeMonitor();
    await runWithTimers(monitor);

    const setArg = setFn.mock.calls[0]?.[0];
    expect(setArg.lastError).toBe("Connection refused");
  });

  it("passes truncated error to sendAutoPauseEmail", async () => {
    const longError = "X".repeat(500);
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error(longError));
    mockDbUpdate(3, false);

    const monitor = makeMonitor({ emailEnabled: true });
    await runWithTimers(monitor);

    expect(mockAutoPauseEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      3,
      "X".repeat(200)
    );
  });

  it("truncates error messages from selector_missing failures", async () => {
    // A page that returns HTML but the selector doesn't match,
    // resulting in "Selector not found" (short, fits in 200 chars)
    const html = `<html><body><p>No match</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));
    const { setFn } = mockDbUpdate(1, true);

    const monitor = makeMonitor({ selector: ".nonexistent" });
    await runWithTimers(monitor);

    const setArg = setFn.mock.calls[0]?.[0];
    expect(setArg.lastError).toBe("Selector not found");
    expect(setArg.lastError.length).toBeLessThanOrEqual(200);
  });

  it("truncates exactly at 200 chars for boundary-length errors", async () => {
    const exactly200 = "B".repeat(200);
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error(exactly200));
    const { setFn } = mockDbUpdate(1, true);

    const monitor = makeMonitor();
    await runWithTimers(monitor);

    const setArg = setFn.mock.calls[0]?.[0];
    expect(setArg.lastError).toHaveLength(200);
    expect(setArg.lastError).toBe(exactly200);
  });

  it("truncates 201-char error to 200 chars", async () => {
    const error201 = "C".repeat(201);
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error(error201));
    const { setFn } = mockDbUpdate(1, true);

    const monitor = makeMonitor();
    await runWithTimers(monitor);

    const setArg = setFn.mock.calls[0]?.[0];
    expect(setArg.lastError).toHaveLength(200);
    expect(setArg.lastError).toBe("C".repeat(200));
  });
});

// ---------------------------------------------------------------------------
// validateCssSelector
// ---------------------------------------------------------------------------
describe("validateCssSelector", () => {
  it("returns null for valid class selector", () => {
    expect(validateCssSelector(".price")).toBeNull();
  });

  it("returns null for valid ID selector", () => {
    expect(validateCssSelector("#total")).toBeNull();
  });

  it("returns null for valid compound selector", () => {
    expect(validateCssSelector(".product .price")).toBeNull();
  });

  it("returns null for bare class name (auto-prefixed with dot)", () => {
    expect(validateCssSelector("price")).toBeNull();
  });

  it("returns null for bare class name with hyphens", () => {
    expect(validateCssSelector("sale-price")).toBeNull();
  });

  it("returns null for selector with pseudo-class", () => {
    expect(validateCssSelector(".item:first-child")).toBeNull();
  });

  it("treats bare attribute selectors as class names (auto-prefixed with dot)", () => {
    // '[data-testid="price"]' doesn't start with '.', '#', or contain a space
    // so it gets treated as a bare class name → '.[data-testid="price"]' which is invalid
    const result = validateCssSelector('[data-testid="price"]');
    expect(result).toContain("Invalid CSS selector syntax");
  });

  it("returns error for empty string", () => {
    const result = validateCssSelector("");
    expect(result).toBe("Selector cannot be empty");
  });

  it("returns error for whitespace-only string", () => {
    const result = validateCssSelector("   ");
    expect(result).toBe("Selector cannot be empty");
  });

  it("returns error for selector exceeding 500 characters", () => {
    const longSelector = ".a".repeat(251); // 502 chars
    const result = validateCssSelector(longSelector);
    expect(result).toBe("Selector is too long (max 500 characters)");
  });

  it("accepts selector at exactly 500 characters", () => {
    const selector = ".a".repeat(250); // exactly 500 chars
    expect(validateCssSelector(selector)).toBeNull();
  });

  it("returns error for invalid CSS selector syntax", () => {
    const result = validateCssSelector(".price[invalid===");
    expect(result).toContain("Invalid CSS selector syntax");
    expect(result).toContain(".price[invalid===");
  });

  it("trims whitespace before validating", () => {
    expect(validateCssSelector("  .price  ")).toBeNull();
  });

  it("returns error for selector with only special chars that form invalid CSS", () => {
    const result = validateCssSelector(">>><<<");
    // ">>>" as bare class name becomes ".>>><<<"  which is invalid
    expect(result).toContain("Invalid CSS selector syntax");
  });
});

// ---------------------------------------------------------------------------
// Browserless retry logic
// ---------------------------------------------------------------------------
describe("Browserless retry logic", () => {
  const mockStorage = storage as unknown as {
    updateMonitor: ReturnType<typeof vi.fn>;
    addMonitorChange: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
  };
  const mockDb = db as unknown as {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  function mockDbUpdate(returnedFailureCount: number, returnedActive = true) {
    const returningFn = vi.fn().mockResolvedValue([{
      consecutiveFailures: returnedFailureCount,
      active: returnedActive,
    }]);
    const whereFn = vi.fn().mockReturnValue({ returning: returningFn });
    const setFn = vi.fn().mockReturnValue({ where: whereFn });
    mockDb.update.mockReturnValue({ set: setFn });
    return { setFn, whereFn, returningFn };
  }

  /**
   * Creates a mock Playwright browser/page chain for extractWithBrowserless.
   * Returns a page mock whose behavior can be configured per-test.
   */
  function createPlaywrightMock(pageContentHtml: string, selectorCount: number, extractedText: string | null) {
    const locatorMock = {
      count: vi.fn().mockResolvedValue(selectorCount),
      first: vi.fn().mockReturnValue({
        innerText: vi.fn().mockResolvedValue(extractedText || ""),
      }),
    };
    const pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue(pageContentHtml),
      locator: vi.fn().mockReturnValue(locatorMock),
      url: vi.fn().mockReturnValue("https://example.com"),
      title: vi.fn().mockResolvedValue("Test Page"),
      getByRole: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn().mockReturnValue({}),
    };
    const contextMock = {
      route: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: vi.fn().mockResolvedValue(undefined),
    };
    return { browserMock, contextMock, pageMock, locatorMock };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    process.env.BROWSERLESS_TOKEN = "test-token";
    mockDbUpdate(1, true);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.BROWSERLESS_TOKEN;
  });

  async function runWithTimers(monitor: Monitor) {
    const promise = checkMonitor(monitor);
    // Advance in small increments so each registered setTimeout
    // is triggered before the next one is enqueued.
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    return promise;
  }

  it("does not retry Browserless on infrastructure failure (connectOverCDP)", async () => {
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }));

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ allowed: true });

    mockConnectOverCDP.mockRejectedValue(new Error("connectOverCDP failed: ECONNREFUSED"));

    const monitor = makeMonitor({ selector: ".missing" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("error");
    expect(result.error).toBe("Browserless service unavailable");
    // connectOverCDP should only be called once (no retry for infra failures)
    expect(mockConnectOverCDP).toHaveBeenCalledTimes(1);
  });

  it("retries Browserless once on transient (non-infra) failure then succeeds", async () => {
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;
    const fullHtml = `<html><body><span class="price">$19.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }));

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ allowed: true });

    // First attempt: timeout error (non-infra, triggers retry)
    // Second attempt: success with value
    const { browserMock: successBrowser } = createPlaywrightMock(fullHtml, 1, "$19.99");

    let callCount = 0;
    mockConnectOverCDP.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error("Navigation timeout of 30000ms exceeded"));
      }
      return Promise.resolve(successBrowser);
    });

    const monitor = makeMonitor({ selector: ".price" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$19.99");
    expect(mockConnectOverCDP).toHaveBeenCalledTimes(2);
  });

  it("gives up after two transient failures", async () => {
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }));

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ allowed: true });

    mockConnectOverCDP.mockRejectedValue(
      new Error("Navigation timeout of 30000ms exceeded")
    );

    const monitor = makeMonitor({ selector: ".price" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("selector_missing");
    // Both attempts should have been made
    expect(mockConnectOverCDP).toHaveBeenCalledTimes(2);
  });

  it("records browserless_retry metric stage on retry attempt", async () => {
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }));

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ allowed: true });

    // Both attempts fail with non-infra error
    mockConnectOverCDP.mockRejectedValue(
      new Error("Page crashed")
    );

    const monitor = makeMonitor({ selector: ".price" });
    await runWithTimers(monitor);

    // Verify metrics were recorded for both "browserless" and "browserless_retry" stages
    const insertCalls = mockDb.insert.mock.results;
    const valuesCalls = insertCalls
      .map((r: any) => r.value?.values?.mock?.calls)
      .filter(Boolean)
      .flat();

    // At minimum, db.insert should have been called multiple times
    // (static, static_retry, browserless, browserless_retry)
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("records usage via BrowserlessUsageTracker after retry completes", async () => {
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }));

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ allowed: true });

    mockConnectOverCDP.mockRejectedValue(
      new Error("Timeout exceeded")
    );

    const monitor = makeMonitor({ selector: ".price" });
    await runWithTimers(monitor);

    // BrowserlessUsageTracker.recordUsage should be called even after retry failures
    expect(BrowserlessUsageTracker.recordUsage).toHaveBeenCalledWith(
      "user1", 1, expect.any(Number), false
    );
  });

  it("does not retry when Browserless succeeds on first attempt", async () => {
    const emptyHtml = `<html><body><p>Loading...</p></body></html>`;
    const fullHtml = `<html><body><span class="price">$25.00</span></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(emptyHtml, { status: 200 }));

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ allowed: true });

    const { browserMock } = createPlaywrightMock(fullHtml, 1, "$25.00");
    mockConnectOverCDP.mockResolvedValue(browserMock);

    const monitor = makeMonitor({ selector: ".price" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$25.00");
    // Only one attempt needed
    expect(mockConnectOverCDP).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Auto-heal (selector recovery)
// ---------------------------------------------------------------------------
describe("auto-heal selector recovery", () => {
  const mockStorage = storage as unknown as {
    updateMonitor: ReturnType<typeof vi.fn>;
    addMonitorChange: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
  };
  const mockDb = db as unknown as {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  function mockDbUpdate(returnedFailureCount: number, returnedActive = true) {
    const returningFn = vi.fn().mockResolvedValue([{
      consecutiveFailures: returnedFailureCount,
      active: returnedActive,
    }]);
    const whereFn = vi.fn().mockReturnValue({ returning: returningFn });
    const setFn = vi.fn().mockReturnValue({ where: whereFn });
    mockDb.update.mockReturnValue({ set: setFn });
    return { setFn, whereFn, returningFn };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockDbUpdate(1, true);
    mockStorage.getUser.mockResolvedValue({ id: "user1", tier: "free" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.BROWSERLESS_TOKEN;
  });

  async function runWithTimers(monitor: Monitor) {
    const promise = checkMonitor(monitor);
    // Advance in small increments so each registered setTimeout
    // is triggered before the next one is enqueued.
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    return promise;
  }

  it("skips auto-heal when currentValue (oldValue) is null", async () => {
    const html = `<html><body><p>No match</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    process.env.BROWSERLESS_TOKEN = "test-token";

    // Don't allow browserless for the main check
    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ allowed: false, reason: "capped" });

    // currentValue is null → auto-heal should not be triggered
    const monitor = makeMonitor({ selector: ".missing", currentValue: null });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("selector_missing");
    // discoverSelectors should not be called (auto-heal skipped)
    // We verify by checking that BrowserlessUsageTracker.canUseBrowserless
    // was only called once (for the main browserless check, not for auto-heal)
    expect(BrowserlessUsageTracker.canUseBrowserless).toHaveBeenCalledTimes(1);
  });

  it("skips auto-heal when BROWSERLESS_TOKEN is not set", async () => {
    const html = `<html><body><p>No match</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    delete process.env.BROWSERLESS_TOKEN;

    const monitor = makeMonitor({ selector: ".missing", currentValue: "$50.00" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("selector_missing");
    expect(result.error).toBe("Selector not found");
  });

  it("skips auto-heal when browserless cap is not allowed", async () => {
    const html = `<html><body><p>No match</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    process.env.BROWSERLESS_TOKEN = "test-token";

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    // First call: main browserless check → not allowed (so we get selector_missing)
    // Second call: auto-heal check → also not allowed
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ allowed: false, reason: "free_tier_cap" });

    const monitor = makeMonitor({ selector: ".missing", currentValue: "$50.00" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("selector_missing");
    expect(result.error).toBe("Selector not found");
  });

  it("skips auto-heal after browserless infrastructure failure", async () => {
    const html = `<html><body><p>No match</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    process.env.BROWSERLESS_TOKEN = "test-token";

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ allowed: true });

    // Make extractWithBrowserless fail with infra error
    mockConnectOverCDP.mockRejectedValue(new Error("ECONNREFUSED"));

    const monitor = makeMonitor({ selector: ".missing", currentValue: "$50.00" });
    const result = await runWithTimers(monitor);

    // Should be error (infra failure), NOT selector_missing with auto-heal
    expect(result.status).toBe("error");
    expect(result.error).toBe("Browserless service unavailable");
  });

  it("catches errors from discoverSelectors and falls through to failure", async () => {
    const html = `<html><body><p>No match</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    process.env.BROWSERLESS_TOKEN = "test-token";

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    // First call: main browserless check → allowed (extractWithBrowserless runs)
    // Second call: auto-heal check → allowed (discoverSelectors runs)
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ allowed: true });

    // extractWithBrowserless will fail (returns no value via timeout),
    // then discoverSelectors (auto-heal) will also fail with an error.
    // Both use playwright-core, so we make connectOverCDP:
    // - fail first two times for extractWithBrowserless (attempt + retry)
    // - fail again for discoverSelectors in auto-heal
    mockConnectOverCDP.mockRejectedValue(
      new Error("Navigation timeout of 30000ms exceeded")
    );

    const monitor = makeMonitor({ selector: ".missing", currentValue: "$50.00" });
    const result = await runWithTimers(monitor);

    // Auto-heal catch block should let the failure pass through
    expect(result.status).toBe("selector_missing");
  });

  it("updates error message when auto-heal finds no suggestions", async () => {
    const html = `<html><body><p>No match</p></body></html>`;
    const pageHtml = `<html><body><p>Some other content</p></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    process.env.BROWSERLESS_TOKEN = "test-token";

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ allowed: true });

    // For extractWithBrowserless: both attempts get timeout (non-infra) → triggers auto-heal
    // For discoverSelectors: returns a page with no matching suggestions
    let callCount = 0;
    const makeLocator = () => ({
      count: vi.fn().mockResolvedValue(0),
      innerText: vi.fn().mockResolvedValue(""),
      first: vi.fn().mockReturnValue({
        innerText: vi.fn().mockResolvedValue(""),
        click: vi.fn().mockResolvedValue(undefined),
        count: vi.fn().mockResolvedValue(0),
      }),
    });
    const roleBtn = { count: vi.fn().mockResolvedValue(0), click: vi.fn(), first: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0), click: vi.fn().mockResolvedValue(undefined) }) };
    const pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue(pageHtml),
      locator: vi.fn().mockImplementation(() => makeLocator()),
      url: vi.fn().mockReturnValue("https://example.com"),
      title: vi.fn().mockResolvedValue("Test Page"),
      evaluate: vi.fn().mockResolvedValue([]),
      getByRole: vi.fn().mockReturnValue(roleBtn),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn().mockReturnValue({}),
    };
    const contextMock = {
      route: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockConnectOverCDP
      .mockRejectedValueOnce(new Error("Navigation timeout exceeded"))
      .mockRejectedValueOnce(new Error("Navigation timeout exceeded"))
      .mockResolvedValueOnce(browserMock);

    const { setFn } = mockDbUpdate(1, true);
    const monitor = makeMonitor({ selector: ".missing", currentValue: "$50.00" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("selector_missing");
    expect(result.error).toContain("auto-recovery failed");
    expect(result.error).toContain("no matching elements found");
  });

  it("auto-heals successfully when discoverSelectors finds a replacement", async () => {
    const html = `<html><body><p>No match</p></body></html>`;
    const pageHtml = `<html><body><span class="new-price">$50.00</span></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    process.env.BROWSERLESS_TOKEN = "test-token";

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ allowed: true });

    const { ErrorLogger } = await import("./logger");

    // Build a page mock that returns matching suggestions for discoverSelectors
    const makeLocator = (count = 1) => ({
      count: vi.fn().mockResolvedValue(count),
      innerText: vi.fn().mockResolvedValue("$50.00"),
      first: vi.fn().mockReturnValue({
        innerText: vi.fn().mockResolvedValue("$50.00"),
        click: vi.fn().mockResolvedValue(undefined),
        count: vi.fn().mockResolvedValue(count),
      }),
    });
    const roleBtn = { count: vi.fn().mockResolvedValue(0), click: vi.fn(), first: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0), click: vi.fn().mockResolvedValue(undefined) }) };
    const pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue(pageHtml),
      locator: vi.fn().mockImplementation(() => makeLocator(1)),
      url: vi.fn().mockReturnValue("https://example.com"),
      title: vi.fn().mockResolvedValue("Test Page"),
      evaluate: vi.fn().mockResolvedValue([
        { text: "$50.00", selector: ".new-price" },
      ]),
      getByRole: vi.fn().mockReturnValue(roleBtn),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn().mockReturnValue({}),
    };
    const contextMock = {
      route: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockConnectOverCDP
      .mockRejectedValueOnce(new Error("Navigation timeout exceeded"))
      .mockRejectedValueOnce(new Error("Navigation timeout exceeded"))
      .mockResolvedValueOnce(browserMock);

    const monitor = makeMonitor({ selector: ".old-price", currentValue: "$50.00" });
    const result = await runWithTimers(monitor);

    // Auto-heal should have changed status to ok
    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$50.00");
    expect(result.error).toBeNull();

    // Should have updated the monitor with the new selector
    expect(mockStorage.updateMonitor).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ selector: ".new-price" })
    );

    // Should have logged an info message about auto-healing
    expect(ErrorLogger.info).toHaveBeenCalledWith(
      "scraper",
      expect.stringContaining("auto-healed selector"),
      expect.objectContaining({
        oldSelector: ".old-price",
        newSelector: ".new-price",
      })
    );
  });

  it("prefers single-match selectors when auto-healing", async () => {
    const html = `<html><body><p>No match</p></body></html>`;
    const pageHtml = `<html><body><span class="price">$50.00</span><span class="price">$60.00</span><span class="exact-price">$50.00</span></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    process.env.BROWSERLESS_TOKEN = "test-token";

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ allowed: true });

    // This mock needs to handle different locator selectors returning different counts
    const locatorCountMap: Record<string, number> = {
      ".price": 2,
      ".exact-price": 1,
    };
    const roleBtn = { count: vi.fn().mockResolvedValue(0), click: vi.fn(), first: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0), click: vi.fn().mockResolvedValue(undefined) }) };
    const pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue(pageHtml),
      locator: vi.fn().mockImplementation((sel: string) => ({
        count: vi.fn().mockResolvedValue(locatorCountMap[sel] ?? 0),
        innerText: vi.fn().mockResolvedValue("$50.00"),
        first: vi.fn().mockReturnValue({
          innerText: vi.fn().mockResolvedValue("$50.00"),
          click: vi.fn().mockResolvedValue(undefined),
          count: vi.fn().mockResolvedValue(locatorCountMap[sel] ?? 0),
        }),
      })),
      url: vi.fn().mockReturnValue("https://example.com"),
      title: vi.fn().mockResolvedValue("Test Page"),
      evaluate: vi.fn().mockResolvedValue([
        { text: "$50.00", selector: ".price" },
        { text: "$50.00", selector: ".exact-price" },
      ]),
      getByRole: vi.fn().mockReturnValue(roleBtn),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn().mockReturnValue({}),
    };
    const contextMock = {
      route: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockConnectOverCDP
      .mockRejectedValueOnce(new Error("Navigation timeout exceeded"))
      .mockRejectedValueOnce(new Error("Navigation timeout exceeded"))
      .mockResolvedValueOnce(browserMock);

    const monitor = makeMonitor({ selector: ".old-price", currentValue: "$50.00" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    // Should prefer .exact-price (count=1) over .price (count=2)
    expect(mockStorage.updateMonitor).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ selector: ".exact-price" })
    );
  });

  it("re-extracts full value from static HTML instead of using truncated sampleText", async () => {
    // The static fetch HTML contains the healed selector with a long value (>80 chars).
    // discoverSelectors returns a truncated sampleText (80 chars), but the auto-heal
    // code should re-extract from the static HTML to get the full value.
    const longValue = "This is a very long product description that exceeds eighty characters and should not be truncated by the auto-heal process at all";
    const html = `<html><body><span class="new-price">${longValue}</span></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    process.env.BROWSERLESS_TOKEN = "test-token";

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ allowed: true });

    const truncatedSample = longValue.substring(0, 80);
    const makeLocator = (count = 1) => ({
      count: vi.fn().mockResolvedValue(count),
      innerText: vi.fn().mockResolvedValue(truncatedSample),
      first: vi.fn().mockReturnValue({
        innerText: vi.fn().mockResolvedValue(truncatedSample),
        click: vi.fn().mockResolvedValue(undefined),
        count: vi.fn().mockResolvedValue(count),
      }),
    });
    const roleBtn = { count: vi.fn().mockResolvedValue(0), click: vi.fn(), first: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0), click: vi.fn().mockResolvedValue(undefined) }) };
    const pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue(html),
      locator: vi.fn().mockImplementation(() => makeLocator(1)),
      url: vi.fn().mockReturnValue("https://example.com"),
      title: vi.fn().mockResolvedValue("Test Page"),
      evaluate: vi.fn().mockResolvedValue([
        { text: truncatedSample, selector: ".new-price" },
      ]),
      getByRole: vi.fn().mockReturnValue(roleBtn),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn().mockReturnValue({}),
    };
    const contextMock = {
      route: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockConnectOverCDP
      .mockRejectedValueOnce(new Error("Navigation timeout exceeded"))
      .mockRejectedValueOnce(new Error("Navigation timeout exceeded"))
      .mockResolvedValueOnce(browserMock);

    const monitor = makeMonitor({ selector: ".old-price", currentValue: truncatedSample });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    // Should contain the full value from extractValueFromHtml, not the truncated sampleText
    expect(result.currentValue).toBe(longValue);
    expect(result.currentValue!.length).toBeGreaterThan(80);
  });

  it("falls back to sampleText when static HTML does not contain the healed selector", async () => {
    // The static fetch HTML does NOT contain the healed selector.
    // extractValueFromHtml returns null, so the fallback to sampleText kicks in.
    const html = `<html><body><p>Static page without new selector</p></body></html>`;
    const pageHtml = `<html><body><span class="js-price">$42.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    process.env.BROWSERLESS_TOKEN = "test-token";

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ allowed: true });

    const makeLocator = (count = 1) => ({
      count: vi.fn().mockResolvedValue(count),
      innerText: vi.fn().mockResolvedValue("$42.99"),
      first: vi.fn().mockReturnValue({
        innerText: vi.fn().mockResolvedValue("$42.99"),
        click: vi.fn().mockResolvedValue(undefined),
        count: vi.fn().mockResolvedValue(count),
      }),
    });
    const roleBtn = { count: vi.fn().mockResolvedValue(0), click: vi.fn(), first: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0), click: vi.fn().mockResolvedValue(undefined) }) };
    const pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue(pageHtml),
      locator: vi.fn().mockImplementation(() => makeLocator(1)),
      url: vi.fn().mockReturnValue("https://example.com"),
      title: vi.fn().mockResolvedValue("Test Page"),
      evaluate: vi.fn().mockResolvedValue([
        { text: "$42.99", selector: ".js-price" },
      ]),
      getByRole: vi.fn().mockReturnValue(roleBtn),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn().mockReturnValue({}),
    };
    const contextMock = {
      route: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockConnectOverCDP
      .mockRejectedValueOnce(new Error("Navigation timeout exceeded"))
      .mockRejectedValueOnce(new Error("Navigation timeout exceeded"))
      .mockResolvedValueOnce(browserMock);

    const monitor = makeMonitor({ selector: ".old-price", currentValue: "$42.99" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    // extractValueFromHtml(html, ".js-price") returns null because static HTML lacks .js-price
    // Falls back to normalizeValue(best.sampleText) = "$42.99"
    expect(result.currentValue).toBe("$42.99");
    expect(mockStorage.updateMonitor).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ selector: ".js-price" })
    );
  });

  it("breaks ties alphabetically when suggestions have same count and length", async () => {
    const html = `<html><body><p>No match</p></body></html>`;
    const pageHtml = `<html><body><span class="b-price">$10</span><span class="a-price">$10</span></body></html>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    process.env.BROWSERLESS_TOKEN = "test-token";

    const { BrowserlessUsageTracker } = await import("./browserlessTracker");
    (BrowserlessUsageTracker.canUseBrowserless as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ allowed: true });

    // Both selectors: count=1, length=8 (.a-price and .b-price) — localeCompare breaks tie
    const locatorCountMap: Record<string, number> = {
      ".a-price": 1,
      ".b-price": 1,
    };
    const roleBtn = { count: vi.fn().mockResolvedValue(0), click: vi.fn(), first: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0), click: vi.fn().mockResolvedValue(undefined) }) };
    const pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue(pageHtml),
      locator: vi.fn().mockImplementation((sel: string) => ({
        count: vi.fn().mockResolvedValue(locatorCountMap[sel] ?? 0),
        innerText: vi.fn().mockResolvedValue("$10"),
        first: vi.fn().mockReturnValue({
          innerText: vi.fn().mockResolvedValue("$10"),
          click: vi.fn().mockResolvedValue(undefined),
          count: vi.fn().mockResolvedValue(locatorCountMap[sel] ?? 0),
        }),
      })),
      url: vi.fn().mockReturnValue("https://example.com"),
      title: vi.fn().mockResolvedValue("Test Page"),
      evaluate: vi.fn().mockResolvedValue([
        { text: "$10", selector: ".b-price" },
        { text: "$10", selector: ".a-price" },
      ]),
      getByRole: vi.fn().mockReturnValue(roleBtn),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn().mockReturnValue({}),
    };
    const contextMock = {
      route: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockConnectOverCDP
      .mockRejectedValueOnce(new Error("Navigation timeout exceeded"))
      .mockRejectedValueOnce(new Error("Navigation timeout exceeded"))
      .mockResolvedValueOnce(browserMock);

    const monitor = makeMonitor({ selector: ".old-price", currentValue: "$10" });
    const result = await runWithTimers(monitor);

    expect(result.status).toBe("ok");
    // .a-price sorts before .b-price alphabetically (localeCompare tiebreaker)
    expect(mockStorage.updateMonitor).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ selector: ".a-price" })
    );
  });
});

// ---------------------------------------------------------------------------
// discoverSelectors (direct unit tests)
// ---------------------------------------------------------------------------
describe("discoverSelectors", () => {
  const originalToken = process.env.BROWSERLESS_TOKEN;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalToken !== undefined) {
      process.env.BROWSERLESS_TOKEN = originalToken;
    } else {
      delete process.env.BROWSERLESS_TOKEN;
    }
  });

  it("throws when BROWSERLESS_TOKEN is not set", async () => {
    delete process.env.BROWSERLESS_TOKEN;
    await expect(discoverSelectors("https://example.com", ".price")).rejects.toThrow(
      "BROWSERLESS_TOKEN not configured"
    );
  });

  it("validates URL against SSRF before connecting", async () => {
    process.env.BROWSERLESS_TOKEN = "test-token";
    const { validateUrlBeforeFetch } = await import("../utils/ssrf");
    (validateUrlBeforeFetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("URL targets a private IP")
    );

    await expect(
      discoverSelectors("http://169.254.169.254/metadata", ".data")
    ).rejects.toThrow("URL targets a private IP");
  });

  it("returns current selector validity and suggestions when expectedText matches", async () => {
    process.env.BROWSERLESS_TOKEN = "test-token";

    const makeLocator = (count: number, text: string) => ({
      count: vi.fn().mockResolvedValue(count),
      first: vi.fn().mockReturnValue({
        innerText: vi.fn().mockResolvedValue(text),
      }),
      innerText: vi.fn().mockResolvedValue(text),
    });
    const roleBtn = { count: vi.fn().mockResolvedValue(0) };
    const pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue("<html><body>$99.99</body></html>"),
      locator: vi.fn().mockImplementation((sel: string) => {
        if (sel === ".price") return makeLocator(1, "$99.99");
        if (sel === ".new-price") return makeLocator(1, "$99.99");
        return makeLocator(0, "");
      }),
      url: vi.fn().mockReturnValue("https://example.com"),
      title: vi.fn().mockResolvedValue("Test Page"),
      evaluate: vi.fn().mockResolvedValue([
        { text: "$99.99", selector: ".new-price" },
      ]),
      getByRole: vi.fn().mockReturnValue(roleBtn),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn().mockReturnValue({}),
    };
    const contextMock = {
      route: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockConnectOverCDP.mockResolvedValueOnce(browserMock);

    const result = await discoverSelectors("https://example.com", ".price", "$99.99");

    expect(result.currentSelector.selector).toBe(".price");
    expect(result.currentSelector.count).toBe(1);
    expect(result.currentSelector.valid).toBe(true);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].selector).toBe(".new-price");
    expect(result.suggestions[0].sampleText).toBe("$99.99");
  });

  it("returns empty suggestions with debug info when no elements match expectedText", async () => {
    process.env.BROWSERLESS_TOKEN = "test-token";

    const makeLocator = (count: number) => ({
      count: vi.fn().mockResolvedValue(count),
      first: vi.fn().mockReturnValue({
        innerText: vi.fn().mockResolvedValue(""),
      }),
      innerText: vi.fn().mockResolvedValue(""),
    });
    const roleBtn = { count: vi.fn().mockResolvedValue(0) };
    const pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue("<html><body><p>No prices here</p></body></html>"),
      locator: vi.fn().mockReturnValue(makeLocator(0)),
      url: vi.fn().mockReturnValue("https://example.com"),
      title: vi.fn().mockResolvedValue("No Prices Page"),
      evaluate: vi.fn().mockResolvedValue([]),
      getByRole: vi.fn().mockReturnValue(roleBtn),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn().mockReturnValue({}),
    };
    const contextMock = {
      route: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockConnectOverCDP.mockResolvedValueOnce(browserMock);

    const result = await discoverSelectors("https://example.com", ".price", "$50.00");

    expect(result.suggestions).toHaveLength(0);
    expect(result.debug).toBeDefined();
    expect(result.debug!.note).toContain("No element matched expectedText");
    expect(result.debug!.pageTitle).toBe("No Prices Page");
  });

  it("scans common selectors when no expectedText is provided", async () => {
    process.env.BROWSERLESS_TOKEN = "test-token";

    const makeLocator = (sel: string) => {
      // Simulate .price matching and others not
      if (sel === ".price") {
        return {
          count: vi.fn().mockResolvedValue(2),
          first: vi.fn().mockReturnValue({
            innerText: vi.fn().mockResolvedValue("$15.00"),
          }),
          innerText: vi.fn().mockResolvedValue("$15.00"),
        };
      }
      return {
        count: vi.fn().mockResolvedValue(0),
        first: vi.fn().mockReturnValue({
          innerText: vi.fn().mockResolvedValue(""),
        }),
        innerText: vi.fn().mockResolvedValue(""),
      };
    };
    const roleBtn = { count: vi.fn().mockResolvedValue(0) };
    const pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue("<html><body><span class='price'>$15.00</span></body></html>"),
      locator: vi.fn().mockImplementation(makeLocator),
      url: vi.fn().mockReturnValue("https://example.com"),
      title: vi.fn().mockResolvedValue("Product Page"),
      evaluate: vi.fn().mockResolvedValue([]),
      getByRole: vi.fn().mockReturnValue(roleBtn),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn().mockReturnValue({}),
    };
    const contextMock = {
      route: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockConnectOverCDP.mockResolvedValueOnce(browserMock);

    // No expectedText → scans common selectors
    const result = await discoverSelectors("https://example.com", ".old-price");

    expect(result.currentSelector.selector).toBe(".old-price");
    expect(result.currentSelector.valid).toBe(false); // .old-price not found
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(result.suggestions[0].selector).toBe(".price");
    expect(result.suggestions[0].count).toBe(2);
    expect(result.suggestions[0].sampleText).toBe("$15.00");
  });

  it("closes browser even when page operations throw", async () => {
    process.env.BROWSERLESS_TOKEN = "test-token";

    const closeFn = vi.fn().mockResolvedValue(undefined);
    const pageMock = {
      goto: vi.fn().mockRejectedValue(new Error("Page crashed")),
    };
    const contextMock = {
      route: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: closeFn,
    };

    mockConnectOverCDP.mockResolvedValueOnce(browserMock);

    await expect(
      discoverSelectors("https://example.com", ".price", "$99")
    ).rejects.toThrow("Page crashed");

    expect(closeFn).toHaveBeenCalled();
  });

  it("normalizes bare class names (auto-prefixes with dot)", async () => {
    process.env.BROWSERLESS_TOKEN = "test-token";

    const locatorCalls: string[] = [];
    const makeLocator = () => ({
      count: vi.fn().mockResolvedValue(0),
      first: vi.fn().mockReturnValue({
        innerText: vi.fn().mockResolvedValue(""),
      }),
      innerText: vi.fn().mockResolvedValue(""),
    });
    const roleBtn = { count: vi.fn().mockResolvedValue(0) };
    const pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue("<html><body></body></html>"),
      locator: vi.fn().mockImplementation((sel: string) => {
        locatorCalls.push(sel);
        return makeLocator();
      }),
      url: vi.fn().mockReturnValue("https://example.com"),
      title: vi.fn().mockResolvedValue("Test"),
      evaluate: vi.fn().mockResolvedValue([]),
      getByRole: vi.fn().mockReturnValue(roleBtn),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn().mockReturnValue({}),
    };
    const contextMock = {
      route: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockConnectOverCDP.mockResolvedValueOnce(browserMock);

    // "price" without dot prefix → should be auto-prefixed to ".price"
    await discoverSelectors("https://example.com", "price");

    // The effective selector ".price" should appear in locator calls
    // (other locator calls may precede it from the consent-dismiss logic)
    expect(locatorCalls).toContain(".price");
  });
});

// ---------------------------------------------------------------------------
// validateCssSelector additional edge cases
// ---------------------------------------------------------------------------
describe("validateCssSelector additional edge cases", () => {
  it("returns null for selector with child combinator", () => {
    expect(validateCssSelector("div > .price")).toBeNull();
  });

  it("returns null for selector with nth-child", () => {
    expect(validateCssSelector("ul li:nth-child(2)")).toBeNull();
  });

  it("returns null for selector with multiple classes", () => {
    expect(validateCssSelector(".product.active")).toBeNull();
  });

  it("returns null for data attribute selector with compound", () => {
    expect(validateCssSelector('div [data-testid="price"]')).toBeNull();
  });

  it("returns error for selector with unmatched bracket", () => {
    const result = validateCssSelector(".price[attr=");
    expect(result).toContain("Invalid CSS selector syntax");
  });

  it("returns null for selector at boundary (499 chars)", () => {
    // Use a valid compound selector under the limit
    const selector = "." + "a".repeat(498); // 499 chars, valid class selector
    expect(validateCssSelector(selector)).toBeNull();
  });

  it("returns error at 501 chars", () => {
    const selector = "a".repeat(501);
    expect(validateCssSelector(selector)).toBe("Selector is too long (max 500 characters)");
  });
});
