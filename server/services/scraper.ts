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
function detectPageBlockReason(html: string, $: cheerio.CheerioAPI): { blocked: boolean; reason?: string } {
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
  let value: string | null = null;
  const selector = monitor.selector.trim();

  const isClassName = !selector.startsWith('.') && !selector.startsWith('#') && !selector.includes(' ');
  const effectiveSelector = isClassName ? `.${selector}` : selector;
  const elements = $(effectiveSelector);
  
  console.log(`[Scraper] Selector "${selector}" matches in static/rendered html: ${elements.length}`);

  if (elements.length > 0) {
    const rawValue = elements.first().text() || elements.first().attr('content') || "";
    const normalized = normalizeValue(rawValue);
    
    if (normalized.length > 80) {
      value = extractFirstPrice(normalized);
    } else {
      value = normalized || null;
    }
  }

  if (!value) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const content = $(el).html();
        if (!content) return true;
        const data = JSON.parse(content);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const val = item.offers?.price || item.offers?.[0]?.price || item.price;
          if (val) {
            value = normalizeValue(String(val));
            return false;
          }
        }
      } catch (e) {}
      return !value;
    });

    if (!value) {
      $('script').each((_, el) => {
        const content = $(el).html();
        if (!content || !content.includes('price')) return true;
        const match = content.match(/"(?:final_)?price"\s*:\s*"?([0-9.,]+)"?/i);
        if (match) {
          value = match[1];
          return false;
        }
        return true;
      });
    }

    if (!value) {
      value = $('meta[property$="price:amount"]').attr('content') || 
              $('meta[name$="price:amount"]').attr('content') ||
              $('meta[itemprop="price"]').attr('content') || null;
    }
    
    if (value) {
      value = normalizeValue(value);
      if (!value.includes('$') && !value.includes('€') && !value.includes('£')) {
         value = `$${value}`; 
      }
    }
  }

  return value;
}

/**
 * Attempts to dismiss cookie consent banners generically.
 */
async function tryDismissConsent(page: any): Promise<boolean> {
  console.log("[Scraper] Attempting to dismiss cookie consent...");
  try {
    const acceptPatterns = [/accept/i, /agree/i, /ok/i, /allow/i, /got it/i];
    
    // Try role-based first
    for (const pattern of acceptPatterns) {
      const button = page.getByRole("button", { name: pattern });
      if (await button.count() > 0) {
        console.log(`[Scraper] Clicking consent button matching: ${pattern}`);
        await button.first().click({ timeout: 2000 });
        return true;
      }
    }

    // Try common selectors
    const selectors = [
      '#onetrust-accept-btn-handler', '.onetrust-accept-btn-handler',
      '[aria-label*="accept" i]', '[id*="accept" i]', '[class*="accept" i]',
      '[data-testid*="accept" i]', '[id*="cookie-accept" i]', '.cookie-accept'
    ];
    
    for (const selector of selectors) {
      const loc = page.locator(selector);
      if (await loc.count() > 0) {
        console.log(`[Scraper] Clicking consent selector: ${selector}`);
        await loc.first().click({ timeout: 2000 });
        return true;
      }
    }
  } catch (err) {
    console.warn("[Scraper] Consent dismissal attempt failed or timed out.");
  }
  return false;
}

/**
 * Retries extraction using Browserless with deep diagnostics.
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

  console.log(`[Scraper] Using Browserless JS rendering for: ${url}`);
  console.log(`[Scraper] BROWSERLESS_TOKEN present: true`);
  
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
    
    console.log(`[Scraper] Browserless navigating to ${url}...`);
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    
    const isClassName = !selector.startsWith('.') && !selector.startsWith('#') && !selector.includes(' ');
    const effectiveSelector = isClassName ? `.${selector}` : selector;
    
    let countBefore = await page.locator(effectiveSelector).count();
    console.log(`[Scraper] Selector count before consent handling: ${countBefore}`);

    const consentClicked = await tryDismissConsent(page);
    console.log(`[Scraper] consent clicked: ${consentClicked}`);

    if (consentClicked) {
      await page.waitForTimeout(1000);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    }

    const countAfter = await page.locator(effectiveSelector).count();
    console.log(`[Scraper] selectorCount after consent: ${countAfter}`);

    await page.waitForSelector(effectiveSelector, { timeout: 5000 }).catch(() => {});
    
    const urlAfter = page.url();
    const title = await page.title();
    const status = response?.status();
    const bodyText = (await page.locator("body").innerText()).substring(0, 200).trim();
    
    console.log(`[Scraper] page.url() after goto: ${urlAfter}`);
    console.log(`[Scraper] response.status(): ${status}`);
    console.log(`[Scraper] await page.title(): ${title}`);
    
    // Evidence Capture
    try {
      await page.screenshot({ path: "/tmp/browserless-debug.png", fullPage: true });
      debugFiles.push("/tmp/browserless-debug.png");
      
      const content = await page.content();
      await fs.writeFile("/tmp/browserless-debug.html", content);
      debugFiles.push("/tmp/browserless-debug.html");

      if (countAfter > 0) {
        const outerHTML = await page.locator(effectiveSelector).first().evaluate(el => el.outerHTML);
        await fs.writeFile("/tmp/browserless-selector.html", outerHTML);
        debugFiles.push("/tmp/browserless-selector.html");
      } else {
        await fs.writeFile("/tmp/browserless-preview.html", content.substring(0, 2000));
        debugFiles.push("/tmp/browserless-preview.html");
      }

      // Fallback selector search (price patterns) - Fixed Regex
      const priceMatches = content.match(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g);
      if (priceMatches) {
        console.log(`[Scraper] Debug Price Fallback Matches: ${priceMatches.slice(0, 3).join(", ")}`);
      }
    } catch (debugErr) {
      console.error("[Scraper] Debug capture failed:", debugErr);
    }

    if (countAfter > 0) {
      const text = await page.locator(effectiveSelector).first().innerText();
      const extracted = normalizeValue(text);
      console.log(`[Scraper] extracted value if found: ${extracted}`);
      return { 
        value: extracted, 
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
    console.log(`BROWSERLESS enabled: ${!!process.env.BROWSERLESS_TOKEN}`);
    
    let html = "";
    try {
      const response = await fetch(monitor.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
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

    let $ = cheerio.load(html);
    let newValue = extractValueFromHtml(html, monitor);
    let block = detectPageBlockReason(html, $);
    
    console.log(`blocked detected: ${block.blocked}${block.blocked ? ` reason=${block.reason}` : ""}`);

    if ((!newValue || block.blocked) && process.env.BROWSERLESS_TOKEN) {
      console.log(`[Scraper] Retrying with JS rendering via Browserless...`);
      try {
        const result = await extractWithBrowserless(monitor.url, monitor.selector);
        if (result.value) {
          newValue = result.value;
        }
      } catch (err) {
        console.error(`[Scraper] Browserless fallback failed:`, err);
      }
    }

    const oldValue = monitor.currentValue;
    const pageTitle = $("title").text().trim();
    const ogTitle = $('meta[property="og:title"]').attr('content');
    
    const isTitleLike = (val: string | null) => val && (val.length > 80 || val === pageTitle || val === ogTitle);
    
    if (!newValue || isTitleLike(newValue)) {
      if (isTitleLike(oldValue)) {
        console.log(`[Scraper] Old value was title-like, clearing to prevent garbage sticking.`);
        newValue = null;
      }
    }

    const changed = newValue !== null && newValue !== oldValue;

    await storage.updateMonitor(monitor.id, {
      lastChecked: new Date(),
      currentValue: newValue ?? (oldValue || undefined)
    });

    if (changed) {
      console.log(`Change detected for monitor ${monitor.id}!`);
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
