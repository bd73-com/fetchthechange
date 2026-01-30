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
  let chromium;
  try {
    const playwrightModule = await import("playwright");
    chromium = playwrightModule.chromium;
    if (!chromium || typeof chromium.connectOverCDP !== 'function') {
      throw new Error("Playwright browser automation is not available");
    }
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
 * Normalize text for matching: lowercase, remove whitespace/commas/currency symbols.
 */
function normalizeTextForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s,]+/g, '')
    .replace(/[$€£¥₹]/g, '');
}

/**
 * Extract digits-only version for fallback matching.
 */
function extractDigits(text: string): string {
  return text.replace(/[^\d.]/g, '');
}

/**
 * Check if candidate text matches expected text using normalized comparison.
 */
function textMatches(candidateText: string, expectedText: string): boolean {
  const normCandidate = normalizeTextForMatch(candidateText);
  const normExpected = normalizeTextForMatch(expectedText);
  
  // Direct include match
  if (normCandidate.includes(normExpected)) return true;
  
  // Digits-only fallback for longer expected text
  if (expectedText.length >= 4) {
    const digitsExpected = extractDigits(expectedText);
    const digitsCandidate = extractDigits(candidateText);
    if (digitsExpected.length >= 3 && digitsCandidate.includes(digitsExpected)) return true;
  }
  
  return false;
}

/**
 * Generate a stable selector for an element.
 */
function generateStableSelector(node: Element): string | null {
  const tag = node.tagName.toLowerCase();
  
  // Skip html and body
  if (tag === 'html' || tag === 'body') return null;
  
  // Priority 1: data-testid, data-test, data-qa
  const dataTestId = node.getAttribute('data-testid');
  if (dataTestId) return `[data-testid="${dataTestId}"]`;
  
  const dataTest = node.getAttribute('data-test');
  if (dataTest) return `[data-test="${dataTest}"]`;
  
  const dataQa = node.getAttribute('data-qa');
  if (dataQa) return `[data-qa="${dataQa}"]`;
  
  // Priority 2: itemprop
  const itemProp = node.getAttribute('itemprop');
  if (itemProp) return `[itemprop="${itemProp}"]`;
  
  // Priority 3: stable ID
  const id = node.id;
  if (id && id.length < 50 && !id.match(/\d{6,}/) && !id.match(/^(react|ember|vue)/i)) {
    return `#${id}`;
  }
  
  // Priority 4: tag + stable classes
  const classes = Array.from(node.classList)
    .filter(c => 
      c.length > 1 && 
      c.length < 40 && 
      !c.match(/\d{5,}/) &&
      !c.match(/^(active|hover|focus|selected|open|closed|hidden|visible)/i) &&
      !c.match(/^(js-|_)/))
    .slice(0, 2);
  
  if (classes.length > 0) {
    // Try to scope under main/article if available
    const parent = node.closest('main, #main, [role="main"], article, #content');
    const prefix = parent ? (parent.id ? `#${parent.id} ` : 'main ') : '';
    return `${prefix}${tag}.${classes.join('.')}`;
  }
  
  // Priority 5: tag with aria-label
  const ariaLabel = node.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.length < 50) {
    return `${tag}[aria-label="${ariaLabel}"]`;
  }
  
  return null;
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
  debug?: { note: string; pageTitle: string; consentClicked: boolean };
}> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error("BROWSERLESS_TOKEN not configured");

  let browser;
  let chromium;
  try {
    const playwrightModule = await import("playwright");
    chromium = playwrightModule.chromium;
    if (!chromium || typeof chromium.connectOverCDP !== 'function') {
      throw new Error("Playwright browser automation is not available. Please try again later.");
    }
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
    
    // Dismiss consent and wait for content
    const consentClicked = await tryDismissConsent(page);
    await page.waitForTimeout(1200);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    
    // Logging
    const pageTitle = await page.title();
    const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => "");
    const bodyStartsWith = bodyText.substring(0, 120).replace(/\s+/g, ' ').trim();
    
    console.log(`[Suggest] consentClicked=${consentClicked}`);
    console.log(`[Suggest] pageTitle=${pageTitle}`);
    console.log(`[Suggest] bodyStartsWith=${bodyStartsWith}`);

    // Check current selector validity
    const trimmedSelector = currentSelector.trim();
    const isClassName = !trimmedSelector.startsWith('.') && !trimmedSelector.startsWith('#') && !trimmedSelector.includes(' ');
    const effectiveSelector = isClassName ? `.${trimmedSelector}` : trimmedSelector;
    
    const currentCount = await page.locator(effectiveSelector).count();
    const currentValid = currentCount > 0;

    const suggestions: SelectorSuggestion[] = [];
    const seen = new Set<string>();

    if (expectedText) {
      // Scan visible elements and compute selectors using raw JS string to avoid bundler issues
      const scanScript = `
        (function() {
          var results = [];
          
          function computeSelector(node) {
            var tag = node.tagName.toLowerCase();
            if (tag === 'html' || tag === 'body') return null;
            
            var dataTestId = node.getAttribute('data-testid');
            if (dataTestId) return '[data-testid="' + dataTestId + '"]';
            
            var dataTest = node.getAttribute('data-test');
            if (dataTest) return '[data-test="' + dataTest + '"]';
            
            var dataQa = node.getAttribute('data-qa');
            if (dataQa) return '[data-qa="' + dataQa + '"]';
            
            var itemProp = node.getAttribute('itemprop');
            if (itemProp) return '[itemprop="' + itemProp + '"]';
            
            var id = node.id;
            if (id && id.length < 50 && !/\\d{6,}/.test(id) && !/^(react|ember|vue)/i.test(id)) {
              return '#' + id;
            }
            
            var classList = node.classList;
            var classes = [];
            for (var i = 0; i < classList.length && classes.length < 2; i++) {
              var c = classList[i];
              if (c.length > 1 && c.length < 40 && 
                  !/\\d{5,}/.test(c) &&
                  !/^(active|hover|focus|selected|open|closed|hidden|visible)/i.test(c) &&
                  !/^(js-|_)/.test(c)) {
                classes.push(c);
              }
            }
            
            if (classes.length > 0) {
              var parent = node.closest('main, #main, [role="main"], article, #content');
              var prefix = parent ? (parent.id ? '#' + parent.id + ' ' : 'main ') : '';
              return prefix + tag + '.' + classes.join('.');
            }
            
            var ariaLabel = node.getAttribute('aria-label');
            if (ariaLabel && ariaLabel.length < 50) {
              return tag + '[aria-label="' + ariaLabel + '"]';
            }
            
            return null;
          }
          
          var walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
              acceptNode: function(node) {
                var tag = node.tagName.toLowerCase();
                if (['script', 'style', 'noscript', 'html', 'body'].indexOf(tag) !== -1) {
                  return NodeFilter.FILTER_SKIP;
                }
                return NodeFilter.FILTER_ACCEPT;
              }
            }
          );
          
          var count = 0;
          var current = walker.nextNode();
          while (current && count < 300) {
            var el = current;
            var text = el.innerText || '';
            if (text.length >= 1 && text.length <= 200) {
              var rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                var selector = computeSelector(el);
                if (selector) {
                  results.push({ text: text, selector: selector });
                  count++;
                }
              }
            }
            current = walker.nextNode();
          }
          return results;
        })()
      `;
      const candidatesWithSelectors: Array<{text: string; selector: string | null}> = await page.evaluate(scanScript);
      
      // Filter by text match
      for (const { text, selector } of candidatesWithSelectors) {
        if (!textMatches(text, expectedText)) continue;
        if (!selector || seen.has(selector)) continue;
        
        try {
          // Verify selector count
          const count = await page.locator(selector).count();
          if (count === 0) continue;
          
          seen.add(selector);
          const sampleText = text.substring(0, 80).replace(/\s+/g, ' ').trim();
          suggestions.push({ selector, count, sampleText });
          
          if (suggestions.length >= 10) break;
        } catch (e) {}
      }
      
      // If no matches found, try attribute-based scanning
      if (suggestions.length === 0) {
        const stableAttrSelectors = [
          '[data-testid]', '[data-test]', '[data-qa]', '[itemprop]',
          '[aria-label]', '.price', '[data-price]', '.product-price'
        ];
        
        for (const baseSelector of stableAttrSelectors) {
          try {
            // Get elements with their selectors using raw JS string to avoid bundler issues
            const attrScanScript = `
              (function() {
                var results = [];
                var elements = document.querySelectorAll('${baseSelector.replace(/'/g, "\\'")}');
                
                function computeSelector(node) {
                  var tag = node.tagName.toLowerCase();
                  if (tag === 'html' || tag === 'body') return null;
                  
                  var dataTestId = node.getAttribute('data-testid');
                  if (dataTestId) return '[data-testid="' + dataTestId + '"]';
                  
                  var dataTest = node.getAttribute('data-test');
                  if (dataTest) return '[data-test="' + dataTest + '"]';
                  
                  var dataQa = node.getAttribute('data-qa');
                  if (dataQa) return '[data-qa="' + dataQa + '"]';
                  
                  var itemProp = node.getAttribute('itemprop');
                  if (itemProp) return '[itemprop="' + itemProp + '"]';
                  
                  var id = node.id;
                  if (id && id.length < 50 && !/\\d{6,}/.test(id) && !/^(react|ember|vue)/i.test(id)) {
                    return '#' + id;
                  }
                  
                  var classList = node.classList;
                  var classes = [];
                  for (var i = 0; i < classList.length && classes.length < 2; i++) {
                    var c = classList[i];
                    if (c.length > 1 && c.length < 40 && 
                        !/\\d{5,}/.test(c) &&
                        !/^(active|hover|focus|selected|open|closed|hidden|visible)/i.test(c) &&
                        !/^(js-|_)/.test(c)) {
                      classes.push(c);
                    }
                  }
                  
                  if (classes.length > 0) {
                    var parent = node.closest('main, #main, [role="main"], article, #content');
                    var prefix = parent ? (parent.id ? '#' + parent.id + ' ' : 'main ') : '';
                    return prefix + tag + '.' + classes.join('.');
                  }
                  
                  var ariaLabel = node.getAttribute('aria-label');
                  if (ariaLabel && ariaLabel.length < 50) {
                    return tag + '[aria-label="' + ariaLabel + '"]';
                  }
                  
                  return null;
                }
                
                for (var i = 0; i < Math.min(elements.length, 20); i++) {
                  var el = elements[i];
                  var text = el.innerText || '';
                  var selector = computeSelector(el);
                  if (selector) {
                    results.push({ text: text, selector: selector });
                  }
                }
                return results;
              })()
            `;
            const attrCandidates: Array<{text: string; selector: string | null}> = await page.evaluate(attrScanScript);
            
            for (const { text, selector } of attrCandidates) {
              if (!text || !textMatches(text, expectedText)) continue;
              if (!selector || seen.has(selector)) continue;
              
              const count = await page.locator(selector).count();
              if (count === 0) continue;
              
              seen.add(selector);
              const sampleText = text.substring(0, 80).replace(/\s+/g, ' ').trim();
              suggestions.push({ selector, count, sampleText });
              
              if (suggestions.length >= 10) break;
            }
          } catch (e) {}
          if (suggestions.length >= 10) break;
        }
      }
      
      // Return debug info if no matches found
      if (suggestions.length === 0) {
        return {
          currentSelector: { selector: currentSelector, count: currentCount, valid: currentValid },
          suggestions: [],
          debug: {
            note: "No element matched expectedText after normalization",
            pageTitle,
            consentClicked
          }
        };
      }
    } else {
      // No expected text - suggest common price/value selectors that exist
      const commonSelectors = [
        '[itemprop="price"]', '[data-testid*="price"]', '[data-price]',
        '.price', '.price-now', '.product-price', '.sale-price', 
        '.current-price', '.final-price', '.amount', '.value'
      ];
      
      for (const selector of commonSelectors) {
        try {
          const count = await page.locator(selector).count();
          if (count === 0) continue;
          
          const text = await page.locator(selector).first().innerText({ timeout: 500 }).catch(() => "");
          const sampleText = text.substring(0, 80).replace(/\s+/g, ' ').trim();
          
          if (!seen.has(selector)) {
            seen.add(selector);
            suggestions.push({ selector, count, sampleText });
          }
          
          if (suggestions.length >= 10) break;
        } catch (e) {}
      }
    }

    return {
      currentSelector: { selector: currentSelector, count: currentCount, valid: currentValid },
      suggestions
    };
  } finally {
    if (browser) await browser.close();
  }
}
