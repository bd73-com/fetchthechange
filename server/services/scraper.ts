import * as cheerio from "cheerio";
import { storage } from "../storage";
import { sendNotificationEmail } from "./email";
import { type Monitor } from "@shared/schema";
import { exec } from "child_process";
import { promisify } from "util";

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
  const priceRegex = /([$€£¥]\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s?[$€£¥])/;
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

  // 1. Selector-based extraction
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

  // 2. Generic fallbacks if selector fails
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
 * Retries extraction using Browserless to read the selector directly in the browser.
 */
async function extractWithBrowserless(url: string, selector: string): Promise<string | null> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error("BROWSERLESS_TOKEN not configured");

  console.log(`[Scraper] Using Browserless JS rendering for: ${url}`);
  
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
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => console.log("[Scraper] Network idle timeout (proceeding anyway)"));
    
    console.log(`[Scraper] Page loaded: ${page.url()} | Title: ${await page.title()}`);
    
    const isClassName = !selector.startsWith('.') && !selector.startsWith('#') && !selector.includes(' ');
    const effectiveSelector = isClassName ? `.${selector}` : selector;
    
    const locator = page.locator(effectiveSelector).first();
    const count = await page.locator(effectiveSelector).count();
    console.log(`[Scraper] Browserless selector matches: ${count}`);

    if (count > 0) {
      const text = await locator.innerText();
      return normalizeValue(text);
    }
    
    return null;
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
        const renderedValue = await extractWithBrowserless(monitor.url, monitor.selector);
        if (renderedValue) {
          newValue = renderedValue;
        }
      } catch (err) {
        console.error(`[Scraper] Browserless fallback failed:`, err);
      }
    }

    const oldValue = monitor.currentValue;
    const pageTitle = $("title").text().trim();
    const ogTitle = $('meta[property="og:title"]').attr('content');
    
    // If the scrape fails or returns a title-like value, and we had an old title-like value, clear it.
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
