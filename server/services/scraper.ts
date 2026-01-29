import * as cheerio from "cheerio";
import { storage } from "../storage";
import { sendNotificationEmail } from "./email";
import { type Monitor } from "@shared/schema";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";

const execAsync = promisify(exec);

interface SelectorSuggestion {
  selector: string;
  count: number;
  sampleText: string;
}

/**
 * Normalizes values by trimming, collapsing spaces, and removing invisible characters.
 */
function normalizeValue(raw: string): string {
  return raw.replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detects if the page is a block/interstitial based on common patterns.
 */
export function detectPageBlockReason(html: string): { blocked: boolean; reason?: string } {
  const $ = cheerio.load(html);
  
  // Clone and remove non-visible/noise content to avoid false positives (like noscript)
  const $clean = $.load($.html());
  $clean("script, style, noscript, iframe, link, meta").remove();
  const visibleText = $clean("body").text().replace(/\s+/g, " ").trim();
  const visibleTextLower = visibleText.toLowerCase();
  const visibleTextLength = visibleText.length;
  
  const title = $("title").text().substring(0, 120);

  const blockPatterns = [
    { pattern: /enable javascript/i, reason: "JavaScript required" },
    { pattern: /please enable cookies/i, reason: "Cookies required" },
    { pattern: /access denied/i, reason: "Access denied" },
    { pattern: /verify you are a human/i, reason: "Human verification (Captcha)" },
    { pattern: /checking your browser/i, reason: "Browser check (Cloudflare)" },
    { pattern: /just a moment/i, reason: "Interstitial/Challenge" },
    { pattern: /unusual traffic/i, reason: "Rate limited" },
    { pattern: /captcha/i, reason: "Captcha detected" }
  ];

  for (const { pattern, reason } of blockPatterns) {
    if (pattern.test(title)) {
      return { blocked: true, reason: `${reason} (Matched in title: "${pattern.source}")` };
    }
    
    if (pattern.test(visibleTextLower)) {
      // Special logic for "enable javascript" to avoid false positives
      if (reason === "JavaScript required") {
        const isSuspicious = visibleTextLength < 4000 || (visibleTextLower.split(pattern).length - 1) > 2;
        if (!isSuspicious) continue;
      }
      return { blocked: true, reason: `${reason} (Matched in visible text, length=${visibleTextLength})` };
    }
  }

  const challengeMarkers = ['[id*="captcha"]', '[class*="captcha"]', '[id*="challenge"]', '[class*="challenge"]', '[class*="cf-"]', '.turnstile', '.h-captcha', '.g-recaptcha'];
  for (const marker of challengeMarkers) {
    if ($(marker).length > 0) {
      return { blocked: true, reason: `Challenge element detected: ${marker}` };
    }
  }

  return { blocked: false };
}

/**
 * Extracts value from HTML using a generic approach.
 */
function extractValueFromHtml(html: string, selector: string): string | null {
  const $ = cheerio.load(html);
  const trimmedSelector = selector.trim();
  const isClassName = !trimmedSelector.startsWith('.') && !trimmedSelector.startsWith('#') && !trimmedSelector.includes(' ');
  const effectiveSelector = isClassName ? `.${trimmedSelector}` : trimmedSelector;
  const elements = $(effectiveSelector);
  
  if (elements.length > 0) {
    const rawValue = elements.first().text() || elements.first().attr('content') || "";
    return normalizeValue(rawValue) || null;
  }
  return null;
}

/**
 * Attempts to dismiss cookie consent banners generically.
 */
async function tryDismissConsent(page: any): Promise<boolean> {
  const selectors = [
    '#onetrust-accept-btn-handler',
    '.onetrust-accept-btn-handler',
    'button#onetrust-accept-btn-handler',
    'button[aria-label*="accept" i]',
    'button:has-text("Accept All")',
    'button:has-text("Accept all")',
    'button:has-text("I Agree")',
    'button:has-text("Agree")',
    'button:has-text("OK")'
  ];

  async function attemptClick(context: any): Promise<boolean> {
    for (const selector of selectors) {
      try {
        const loc = context.locator(selector);
        if (await loc.count() > 0) {
          await loc.first().click({ timeout: 2000, force: true });
          return true;
        }
      } catch (e) {}
    }
    return false;
  }

  try {
    if (await attemptClick(page)) return true;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      if (await attemptClick(frame)) return true;
    }
    const btn = page.getByRole("button", { name: /accept|agree|allow|ok|consent/i }).first();
    if (await btn.count() > 0) {
      await btn.click({ timeout: 2000, force: true });
      return true;
    }
  } catch (err) {}
  return false;
}

/**
 * Retries extraction using Browserless.
 */
export async function extractWithBrowserless(url: string, selector: string): Promise<{ 
  value: string | null, 
  urlAfter: string, 
  title: string, 
  selectorCount: number,
  blocked: boolean,
  reason?: string
}> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error("BROWSERLESS_TOKEN not configured");

  let browser;
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.connectOverCDP(`wss://production-sfo.browserless.io?token=${token}`, {
      timeout: 30000
    });
    
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      locale: "en-US"
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    
    await tryDismissConsent(page);
    await page.waitForTimeout(1200);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    const content = await page.content();
    const block = detectPageBlockReason(content);
    
    const trimmedSelector = selector.trim();
    const isClassName = !trimmedSelector.startsWith('.') && !trimmedSelector.startsWith('#') && !trimmedSelector.includes(' ');
    const effectiveSelector = isClassName ? `.${trimmedSelector}` : trimmedSelector;

    await page.waitForSelector(effectiveSelector, { timeout: 5000 }).catch(() => {});
    const count = await page.locator(effectiveSelector).count();
    
    let value: string | null = null;
    if (count > 0) {
      const text = await page.locator(effectiveSelector).first().innerText();
      value = normalizeValue(text);
    }
    
    return { 
      value, 
      urlAfter: page.url(), 
      title: await page.title(), 
      selectorCount: count,
      blocked: block.blocked,
      reason: block.reason
    };
  } catch (error) {
    console.error(`[Scraper] Browserless failed:`, error);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function fetchWithCurl(url: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`curl -L -s -m 15 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36" "${url}"`);
    return stdout;
  } catch (error) {
    console.error(`Curl fallback failed:`, error);
    throw error;
  }
}

/**
 * Main monitor check function.
 */
export async function checkMonitor(monitor: Monitor): Promise<{ 
  changed: boolean; 
  currentValue: string | null;
  previousValue: string | null | undefined;
  status: "ok" | "blocked" | "selector_missing" | "error";
  error: string | null;
}> {
  try {
    console.log(`Checking monitor ${monitor.id}: ${monitor.url}`);
    
    let html = "";
    try {
      const response = await fetch(monitor.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Upgrade-Insecure-Requests': '1'
        },
        signal: AbortSignal.timeout(20000)
      });
      html = await response.text();
    } catch (e: any) {
      if (e.code === 'UND_ERR_HEADERS_OVERFLOW' || (e.cause && e.cause.code === 'UND_ERR_HEADERS_OVERFLOW')) {
        html = await fetchWithCurl(monitor.url);
      } else {
        throw e;
      }
    }

    if (!html) return { 
      changed: false, 
      currentValue: null, 
      previousValue: monitor.currentValue, 
      status: "error" as const, 
      error: "Failed to fetch page" 
    };

    // Stage: Static
    let newValue = extractValueFromHtml(html, monitor.selector);
    let block = detectPageBlockReason(html);
    console.log(`stage=static selectorCount=${newValue ? 1 : 0} blocked=${block.blocked}${block.blocked ? ` reason="${block.reason}"` : ""}`);

    // Fallback to Rendered if static failed or blocked
    if ((!newValue || block.blocked) && process.env.BROWSERLESS_TOKEN) {
      try {
        const result = await extractWithBrowserless(monitor.url, monitor.selector);
        newValue = result.value;
        block = { blocked: result.blocked, reason: result.reason };
        console.log(`stage=rendered selectorCount=${result.selectorCount} blocked=${block.blocked}${block.blocked ? ` reason="${block.reason}"` : ""}`);
      } catch (err) {
        console.error(`[Scraper] Browserless fallback failed:`, err);
      }
    }

    const oldValue = monitor.currentValue;
    
    // Determine final status
    let finalValue: string | null = newValue;
    let finalStatus: "ok" | "blocked" | "selector_missing" | "error" = "ok";
    let finalError: string | null = null;

    if (!newValue) {
      if (block.blocked) {
        finalValue = null;
        finalStatus = "blocked";
        finalError = block.reason || "Blocked";
      } else {
        finalValue = null;
        finalStatus = "selector_missing";
        finalError = "Selector not found";
      }
    }

    // Only detect changes if status is OK
    const changed = finalStatus === "ok" && finalValue !== oldValue;

    await storage.updateMonitor(monitor.id, {
      lastChecked: new Date(),
      currentValue: finalStatus === "ok" ? finalValue : null,
      lastStatus: finalStatus,
      lastError: finalError
    } as any);

    if (changed) {
      await storage.addMonitorChange(monitor.id, oldValue, finalValue);
      await storage.updateMonitor(monitor.id, { lastChanged: new Date() } as any);
      if (monitor.emailEnabled) {
        await sendNotificationEmail(monitor, oldValue, finalValue);
      }
    }

    return { 
      changed, 
      currentValue: finalStatus === "ok" ? finalValue : null,
      previousValue: oldValue,
      status: finalStatus,
      error: finalError
    };
  } catch (error) {
    console.error(`Scraping error for monitor ${monitor.id}:`, error);
    return { 
      changed: false, 
      currentValue: null,
      previousValue: monitor.currentValue,
      status: "error" as const,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Discover selector suggestions for a given page.
 */
export async function discoverSelectors(
  url: string, 
  currentSelector: string, 
  expectedText?: string
): Promise<{
  currentSelector: { selector: string; count: number; valid: boolean };
  suggestions: SelectorSuggestion[];
}> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error("BROWSERLESS_TOKEN not configured");

  let browser;
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.connectOverCDP(`wss://production-sfo.browserless.io?token=${token}`, {
      timeout: 30000
    });
    
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      locale: "en-US"
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    
    await tryDismissConsent(page);
    await page.waitForTimeout(1200);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    // Check current selector validity
    const trimmedSelector = currentSelector.trim();
    const isClassName = !trimmedSelector.startsWith('.') && !trimmedSelector.startsWith('#') && !trimmedSelector.includes(' ');
    const effectiveSelector = isClassName ? `.${trimmedSelector}` : trimmedSelector;
    
    const currentCount = await page.locator(effectiveSelector).count();
    const currentValid = currentCount > 0;

    const suggestions: SelectorSuggestion[] = [];

    // If expectedText is provided, find elements containing that text
    if (expectedText) {
      const normalizedExpected = expectedText.toLowerCase().trim();
      
      // Find all elements and filter by text content
      const elements = await page.locator('*').all();
      const seen = new Set<string>();
      
      for (const el of elements.slice(0, 500)) { // Limit to first 500 elements for performance
        try {
          const text = await el.innerText({ timeout: 100 }).catch(() => "");
          if (!text.toLowerCase().includes(normalizedExpected)) continue;
          
          // Generate selector for this element
          const selector = await el.evaluate((node: Element) => {
            // Prefer data attributes
            const dataTestId = node.getAttribute('data-testid');
            if (dataTestId) return `[data-testid="${dataTestId}"]`;
            
            const dataTest = node.getAttribute('data-test');
            if (dataTest) return `[data-test="${dataTest}"]`;
            
            const dataQa = node.getAttribute('data-qa');
            if (dataQa) return `[data-qa="${dataQa}"]`;
            
            const itemProp = node.getAttribute('itemprop');
            if (itemProp) return `[itemprop="${itemProp}"]`;
            
            const ariaLabel = node.getAttribute('aria-label');
            if (ariaLabel && ariaLabel.length < 50) return `[aria-label="${ariaLabel}"]`;
            
            // Use id if stable-looking
            const id = node.id;
            if (id && !id.match(/\d{5,}/) && !id.includes('react') && !id.includes('ember')) {
              return `#${id}`;
            }
            
            // Build class-based selector
            const tag = node.tagName.toLowerCase();
            const classes = Array.from(node.classList)
              .filter(c => !c.match(/\d{4,}/) && c.length < 30 && !c.includes('active') && !c.includes('hover'))
              .slice(0, 2);
            
            if (classes.length > 0) {
              return `${tag}.${classes.join('.')}`;
            }
            
            return tag;
          });
          
          if (seen.has(selector)) continue;
          seen.add(selector);
          
          // Verify selector matches and get count
          const count = await page.locator(selector).count();
          if (count === 0) continue;
          
          const sampleText = text.substring(0, 80).replace(/\s+/g, ' ').trim();
          
          suggestions.push({ selector, count, sampleText });
          
          if (suggestions.length >= 10) break;
        } catch (e) {
          // Skip elements that can't be processed
        }
      }
    } else {
      // No expected text - suggest common price/value selectors
      const commonSelectors = [
        '.price', '.price-now', '.product-price', '[data-price]',
        '.amount', '.value', '.cost', '.total',
        '[itemprop="price"]', '[data-testid*="price"]',
        '.sale-price', '.current-price', '.final-price'
      ];
      
      for (const selector of commonSelectors) {
        try {
          const count = await page.locator(selector).count();
          if (count === 0) continue;
          
          const text = await page.locator(selector).first().innerText({ timeout: 500 }).catch(() => "");
          const sampleText = text.substring(0, 80).replace(/\s+/g, ' ').trim();
          
          suggestions.push({ selector, count, sampleText });
          
          if (suggestions.length >= 10) break;
        } catch (e) {}
      }
    }

    return {
      currentSelector: {
        selector: currentSelector,
        count: currentCount,
        valid: currentValid
      },
      suggestions
    };
  } finally {
    if (browser) await browser.close();
  }
}
