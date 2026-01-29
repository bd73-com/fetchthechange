import * as cheerio from "cheerio";
import { storage } from "../storage";
import { sendNotificationEmail } from "./email";
import { type Monitor } from "@shared/schema";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";

const execAsync = promisify(exec);

/**
 * Normalizes values by trimming, collapsing spaces, and removing invisible characters.
 */
function normalizeValue(raw: string): string {
  return raw.replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts the first price-like string with currency symbols and numeric formats.
 */
function extractFirstPrice(text: string): string | null {
  const priceRegex = /([$€£¥]\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})\s?[$€£¥])/;
  const match = text.match(priceRegex);
  return match ? match[0] : null;
}

/**
 * Detects if the page is a block/interstitial based on common patterns.
 */
export function detectPageBlockReason(html: string): { blocked: boolean; reason?: string } {
  const $ = cheerio.load(html);
  const title = $("title").text().substring(0, 120);
  const bodyText = $("body").text().toLowerCase();

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
    if (pattern.test(title) || pattern.test(bodyText)) {
      return { blocked: true, reason: `${reason} (Matched: "${pattern.source}")` };
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
function extractValueFromHtml(html: string, monitor: Monitor): string | null {
  const $ = cheerio.load(html);
  const selector = monitor.selector.trim();
  const isClassName = !selector.startsWith('.') && !selector.startsWith('#') && !selector.includes(' ');
  const effectiveSelector = isClassName ? `.${selector}` : selector;
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
 * Captured rendered DOM snapshot for debugging.
 */
export async function getRenderedDomSnapshot(url: string): Promise<{
  finalUrl: string;
  title: string;
  htmlSnippet: string;
}> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error("BROWSERLESS_TOKEN not configured");

  let browser;
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.connectOverCDP(`wss://production-sfo.browserless.io?token=${token}`);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await tryDismissConsent(page);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    const content = await page.content();
    return {
      finalUrl: page.url(),
      title: await page.title(),
      htmlSnippet: content.substring(0, 3000)
    };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Retries extraction using Browserless.
 */
export async function extractWithBrowserless(url: string, selector: string): Promise<{ 
  value: string | null, 
  urlAfter: string, 
  title: string, 
  selectorCount: number,
  debugFiles: string[] 
}> {
  const token = process.env.BROWSERLESS_TOKEN;
  const debugFiles: string[] = [];
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
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    
    const isClassName = !selector.startsWith('.') && !selector.startsWith('#') && !selector.includes(' ');
    const effectiveSelector = isClassName ? `.${selector}` : selector;
    
    await tryDismissConsent(page);
    await page.waitForTimeout(1200);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    await page.waitForSelector(effectiveSelector, { timeout: 10000 }).catch(() => {});
    const countAfter = await page.locator(effectiveSelector).count();
    
    const urlAfter = page.url();
    const title = await page.title();
    
    if (countAfter > 0) {
      const text = await page.locator(effectiveSelector).first().innerText();
      return { 
        value: normalizeValue(text), 
        urlAfter, 
        title, 
        selectorCount: countAfter,
        debugFiles 
      };
    }
    
    return { value: null, urlAfter, title, selectorCount: countAfter, debugFiles };
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
export async function checkMonitor(monitor: Monitor): Promise<{ changed: boolean, currentValue: string | null }> {
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

    if (!html) return { changed: false, currentValue: null };

    let newValue = extractValueFromHtml(html, monitor);
    let block = detectPageBlockReason(html);
    
    if ((!newValue || block.blocked) && process.env.BROWSERLESS_TOKEN) {
      try {
        const result = await extractWithBrowserless(monitor.url, monitor.selector);
        newValue = result.value;
        block = detectPageBlockReason(await fs.readFile("/tmp/browserless-debug.html", "utf-8").catch(() => html));
      } catch (err) {}
    }

    if (!newValue) {
      const isClassName = !monitor.selector.startsWith('.') && !monitor.selector.startsWith('#') && !monitor.selector.includes(' ');
      const effectiveSelector = isClassName ? `.${monitor.selector}` : monitor.selector;
      console.log(`Extraction failed: selector=${monitor.selector}, count=0, blocked=${block.blocked}${block.blocked ? `, reason=${block.reason}` : ""}`);
    }

    const oldValue = monitor.currentValue;
    const changed = newValue !== null && newValue !== oldValue;

    await storage.updateMonitor(monitor.id, {
      lastChecked: new Date(),
      currentValue: newValue ?? (oldValue || null)
    });

    if (changed) {
      await storage.addMonitorChange(monitor.id, oldValue, newValue);
      await storage.updateMonitor(monitor.id, { lastChanged: new Date() });
      if (monitor.emailEnabled) {
        await sendNotificationEmail(monitor, oldValue, newValue);
      }
    }

    return { changed, currentValue: newValue };
  } catch (error) {
    console.error(`Scraping error for monitor ${monitor.id}:`, error);
    return { changed: false, currentValue: null };
  }
}
