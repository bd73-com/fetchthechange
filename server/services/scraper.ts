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

  // Check for common challenge elements
  const challengeMarkers = ['[id*="captcha"]', '[class*="captcha"]', '[id*="challenge"]', '[class*="challenge"]', '[class*="cf-"]', '.turnstile', '.h-captcha', '.g-recaptcha'];
  for (const marker of challengeMarkers) {
    if ($(marker).length > 0) {
      return { blocked: true, reason: `Challenge element detected: ${marker}` };
    }
  }

  return { blocked: false };
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
 * Some sites require JS rendering; when configured with BROWSERLESS_TOKEN we retry using a remote headless browser.
 */
async function fetchRenderedHtml(url: string): Promise<string> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error("BROWSERLESS_TOKEN not configured");

  console.log(`[Scraper] Using Browserless JS rendering fallback for: ${url}`);
  
  let browser;
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.connectOverCDP(`wss://production-sfo.browserless.io?token=${token}`);
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const content = await page.content();
    return content;
  } catch (error) {
    console.error(`[Scraper] Browserless fallback failed:`, error);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Main monitor check function.
 * For selector-based monitors, do not fall back to page title; detect block/interstitial pages and return null.
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
          'Pragma': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Upgrade-Insecure-Requests': '1'
        },
        signal: AbortSignal.timeout(20000)
      });

      console.log(`Response status for ${monitor.url}: ${response.status}`);
      html = await response.text();
    } catch (e: any) {
      if (e.code === 'UND_ERR_HEADERS_OVERFLOW' || (e.cause && e.cause.code === 'UND_ERR_HEADERS_OVERFLOW')) {
        console.log(`Header overflow for ${monitor.id}, falling back to curl...`);
        html = await fetchWithCurl(monitor.url);
      } else {
        throw e;
      }
    }

    if (!html) return { changed: false, currentValue: null };

    const performExtraction = ($: cheerio.CheerioAPI, selector: string) => {
      let extracted: string | null = null;
      const isClassName = !selector.startsWith('.') && !selector.startsWith('#') && !selector.includes(' ');
      const effectiveSelector = isClassName ? `.${selector}` : selector;
      const elements = $(effectiveSelector);
      
      console.log(`Selector "${selector}" matches: ${elements.length}`);

      if (elements.length > 0) {
        const rawValue = elements.first().text() || elements.first().attr('content') || "";
        const normalized = normalizeValue(rawValue);
        
        if (normalized.length > 50) {
          extracted = extractFirstPrice(normalized);
        } else {
          extracted = normalized || null;
        }
      }

      if (!extracted) {
        // Strategy A: JSON-LD
        $('script[type="application/ld+json"]').each((_, el) => {
          try {
            const content = $(el).html();
            if (!content) return true;
            const data = JSON.parse(content);
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
              const val = item.offers?.price || item.offers?.[0]?.price || item.price;
              if (val) {
                extracted = normalizeValue(String(val));
                return false;
              }
            }
          } catch (e) {}
          return !extracted;
        });

        // Strategy B: Price Scripts
        if (!extracted) {
          $('script').each((_, el) => {
            const content = $(el).html();
            if (!content || !content.includes('price')) return true;
            const match = content.match(/"(?:final_)?price"\s*:\s*"?([0-9.,]+)"?/i);
            if (match) {
              extracted = match[1];
              return false;
            }
            return true;
          });
        }

        // Strategy C: Price Meta Tags
        if (!extracted) {
          extracted = $('meta[property$="price:amount"]').attr('content') || 
                     $('meta[name$="price:amount"]').attr('content') ||
                     $('meta[itemprop="price"]').attr('content') || null;
        }
        
        if (extracted) {
          extracted = normalizeValue(extracted);
          if (!extracted.includes('$') && !extracted.includes('€') && !extracted.includes('£')) {
             extracted = `$${extracted}`; 
          }
        }
      }
      return extracted;
    };

    let $ = cheerio.load(html);
    let block = detectPageBlockReason(html, $);
    let newValue: string | null = null;
    const selector = monitor.selector.trim();

    newValue = performExtraction($, selector);

    // If initial fetch failed to get a value or hit a block page, try Browserless fallback
    if ((!newValue || block.blocked) && process.env.BROWSERLESS_TOKEN) {
      console.log(`[Scraper] Monitor ${monitor.id} needs JS rendering. Retrying with Browserless...`);
      try {
        const renderedHtml = await fetchRenderedHtml(monitor.url);
        if (renderedHtml) {
          const $rendered = cheerio.load(renderedHtml);
          const renderedValue = performExtraction($rendered, selector);
          if (renderedValue) {
            newValue = renderedValue;
            console.log(`[Scraper] Successfully extracted value after JS rendering: ${newValue}`);
          }
        }
      } catch (fallbackError) {
        console.error(`[Scraper] JS rendering fallback failed for monitor ${monitor.id}:`, fallbackError);
      }
    } else if (!newValue && block.blocked) {
      console.warn(`Blocked page detected for monitor ${monitor.id}: ${block.reason} (Title: "${$("title").text().substring(0, 120)}")`);
      return { changed: false, currentValue: null };
    }

    const oldValue = monitor.currentValue;
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
