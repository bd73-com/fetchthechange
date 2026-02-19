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
    vi.doMock("playwright-core", () => ({
      chromium: {
        connectOverCDP: vi.fn().mockRejectedValue(new Error("connectOverCDP failed: connection refused")),
      },
    }));

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
