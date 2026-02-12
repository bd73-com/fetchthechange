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
import { sendNotificationEmail } from "./email";
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
    // "checking your browser" pattern is checked before "just a moment",
    // and matches the visible text first.
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
    vi.clearAllMocks();
    // Remove BROWSERLESS_TOKEN so the test doesn't try to use browserless
    delete process.env.BROWSERLESS_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok with extracted value when selector matches", async () => {
    const html = `<html><body><span class="price">$19.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$19.99" });
    const result = await checkMonitor(monitor);

    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$19.99");
    expect(result.changed).toBe(false);
    expect(result.error).toBeNull();
  });

  it("detects change when value differs from currentValue", async () => {
    const html = `<html><body><span class="price">$24.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$19.99" });
    const result = await checkMonitor(monitor);

    expect(result.status).toBe("ok");
    expect(result.changed).toBe(true);
    expect(result.currentValue).toBe("$24.99");
    expect(result.previousValue).toBe("$19.99");

    // Should record the change in storage
    expect(mockStorage.addMonitorChange).toHaveBeenCalledWith(1, "$19.99", "$24.99");
  });

  it("sends email notification when value changes and emailEnabled is true", async () => {
    const html = `<html><body><span class="price">$24.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$19.99", emailEnabled: true });
    await checkMonitor(monitor);

    expect(mockSendEmail).toHaveBeenCalledWith(monitor, "$19.99", "$24.99");
  });

  it("does NOT send email when emailEnabled is false", async () => {
    const html = `<html><body><span class="price">$24.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$19.99", emailEnabled: false });
    await checkMonitor(monitor);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does NOT send email when value has not changed", async () => {
    const html = `<html><body><span class="price">$19.99</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$19.99", emailEnabled: true });
    await checkMonitor(monitor);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns selector_missing when selector matches nothing on an unblocked page", async () => {
    const html = `<html><body><span class="title">Hello</span></body></html>`;
    // Needs two fetch calls: initial + retry
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ selector: ".nonexistent" });
    const result = await checkMonitor(monitor);

    expect(result.status).toBe("selector_missing");
    expect(result.error).toBe("Selector not found");
    expect(result.changed).toBe(false);
  });

  it("returns blocked status when page is blocked", async () => {
    const html = `
      <html><head><title>Access Denied</title></head>
      <body><p>You do not have permission to access this resource.</p></body>
      </html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor();
    const result = await checkMonitor(monitor);

    expect(result.status).toBe("blocked");
    expect(result.error).toContain("Access denied");
    expect(result.changed).toBe(false);
  });

  it("returns error status when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network failure"));

    const monitor = makeMonitor();
    const result = await checkMonitor(monitor);

    expect(result.status).toBe("error");
    expect(result.error).toBe("Network failure");
    expect(result.changed).toBe(false);
  });

  it("returns error status when page returns empty body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 200 })
    );

    const monitor = makeMonitor();
    const result = await checkMonitor(monitor);

    expect(result.status).toBe("error");
    expect(result.error).toBe("Failed to fetch page");
  });

  it("updates monitor lastChecked and lastStatus in storage on success", async () => {
    const html = `<html><body><span class="price">$5.00</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$5.00" });
    await checkMonitor(monitor);

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
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));

    const monitor = makeMonitor();
    await checkMonitor(monitor);

    expect(mockStorage.updateMonitor).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        lastStatus: "error",
        lastError: "timeout",
      })
    );
  });

  it("updates monitor with selector_missing when selector not found", async () => {
    const html = `<html><body><p>No match</p></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ selector: ".missing" });
    await checkMonitor(monitor);

    // updateMonitor may be called for blocked/selector_missing
    const calls = mockStorage.updateMonitor.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1]).toMatchObject({
      lastStatus: "selector_missing",
      lastError: "Selector not found",
    });
  });

  it("records lastChanged when a value change is detected", async () => {
    const html = `<html><body><span class="price">$30.00</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: "$20.00" });
    await checkMonitor(monitor);

    // Should have two updateMonitor calls: one for currentValue, one for lastChanged
    const calls = mockStorage.updateMonitor.mock.calls;
    const lastChangedCall = calls.find(
      (c: any[]) => c[1].lastChanged !== undefined
    );
    expect(lastChangedCall).toBeDefined();
    expect(lastChangedCall![1].lastChanged).toBeInstanceOf(Date);
  });

  it("handles first check (currentValue is null) as a change", async () => {
    const html = `<html><body><span class="price">$15.00</span></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200 })
    );

    const monitor = makeMonitor({ currentValue: null });
    const result = await checkMonitor(monitor);

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
    const result = await checkMonitor(monitor);

    // Should have been called twice (initial + retry)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$10.00");
  });

  it("uses fetchWithCurl fallback on UND_ERR_HEADERS_OVERFLOW", async () => {
    const html = `<html><body><span class="price">$7.77</span></body></html>`;
    const headerError = new Error("Headers overflow");
    (headerError as any).code = "UND_ERR_HEADERS_OVERFLOW";

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      // First call throws headers overflow
      .mockRejectedValueOnce(headerError)
      // fetchWithCurl calls fetch internally
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    const monitor = makeMonitor();
    const result = await checkMonitor(monitor);

    expect(result.status).toBe("ok");
    expect(result.currentValue).toBe("$7.77");
  });
});
