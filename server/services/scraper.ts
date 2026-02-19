import * as cheerio from "cheerio";
import { storage } from "../storage";
import { sendNotificationEmail, sendAutoPauseEmail } from "./email";
import { ErrorLogger } from "./logger";
import { BrowserlessUsageTracker } from "./browserlessTracker";
import { validateUrlBeforeFetch, ssrfSafeFetch } from "../utils/ssrf";
import { type Monitor, monitorMetrics, monitors } from "@shared/schema";
import { type UserTier, PAUSE_THRESHOLDS } from "@shared/models/auth";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";

interface SelectorSuggestion {
  selector: string;
  count: number;
  sampleText: string;
}

/**
 * Validates that a CSS selector is syntactically correct.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateCssSelector(selector: string): string | null {
  const trimmed = selector.trim();
  if (!trimmed) return "Selector cannot be empty";
  if (trimmed.length > 500) return "Selector is too long (max 500 characters)";

  // Normalize bare class names the same way extractValueFromHtml does
  const isClassName = !trimmed.startsWith('.') && !trimmed.startsWith('#') && !trimmed.includes(' ');
  const effective = isClassName ? `.${trimmed}` : trimmed;

  try {
    const $ = cheerio.load("<div></div>");
    $(effective);
    return null;
  } catch {
    return `Invalid CSS selector syntax: "${selector}"`;
  }
}

async function recordMetric(
  monitorId: number,
  stage: string,
  durationMs: number,
  status: string,
  selectorCount?: number,
  blocked?: boolean,
  blockReason?: string | null
): Promise<void> {
  try {
    await db.insert(monitorMetrics).values({
      monitorId,
      stage,
      durationMs,
      status,
      selectorCount: selectorCount ?? null,
      blocked: blocked ?? false,
      blockReason: blockReason ?? null,
    });
  } catch (e) {
    // Metrics recording is best-effort; log for debugging schema/connection issues
    console.debug(`[Metrics] Failed to record metric for monitor ${monitorId}:`, e instanceof Error ? e.message : e);
  }
}

async function handleMonitorFailure(
  monitor: Monitor,
  finalStatus: "blocked" | "selector_missing" | "error",
  errorMsg: string,
  browserlessInfraFailure: boolean
): Promise<{ newFailureCount: number; paused: boolean }> {
  const shouldPenalize = !browserlessInfraFailure;

  // Truncate error message to prevent unbounded storage in pause_reason.
  // Use spread to operate on Unicode code points, not UTF-16 code units,
  // so surrogate pairs (e.g. emoji) are never split.
  const truncatedError = [...errorMsg].slice(0, 200).join('');

  // Look up the user's tier to determine the pause threshold BEFORE the atomic update,
  // so we can include the pause decision in the same UPDATE statement.
  const user = await storage.getUser(monitor.userId);
  const tier = (user?.tier || "free") as UserTier;
  const threshold = PAUSE_THRESHOLDS[tier] ?? PAUSE_THRESHOLDS.free;

  // Build the pause reason suffix as a standalone parameterized value
  const pauseSuffix = ` consecutive failures (last: ${truncatedError})`;

  // Single atomic UPDATE: increment failure count AND conditionally pause in one statement.
  // This prevents a concurrent successful check from resetting consecutiveFailures between
  // the increment and the pause, which would leave the monitor in an inconsistent state.
  const [updated] = await db.update(monitors)
    .set({
      lastChecked: new Date(),
      lastStatus: finalStatus,
      lastError: truncatedError,
      consecutiveFailures: shouldPenalize
        ? sql`${monitors.consecutiveFailures} + 1`
        : monitors.consecutiveFailures,
      active: shouldPenalize
        ? sql`CASE WHEN ${monitors.consecutiveFailures} + 1 >= ${threshold} THEN false ELSE ${monitors.active} END`
        : monitors.active,
      pauseReason: shouldPenalize
        ? sql`CASE WHEN ${monitors.consecutiveFailures} + 1 >= ${threshold} THEN 'Auto-paused after ' || (${monitors.consecutiveFailures} + 1)::text || ${pauseSuffix} ELSE ${monitors.pauseReason} END`
        : monitors.pauseReason,
    })
    .where(eq(monitors.id, monitor.id))
    .returning({
      consecutiveFailures: monitors.consecutiveFailures,
      active: monitors.active,
    });

  const fallbackCount = monitor.consecutiveFailures ?? 0;
  const newFailureCount = updated?.consecutiveFailures
    ?? (shouldPenalize ? fallbackCount + 1 : fallbackCount);
  const shouldPause = updated ? !updated.active : (newFailureCount >= threshold);

  if (shouldPause) {
    console.log(`Monitor ${monitor.id} auto-paused after ${newFailureCount} consecutive failures`);
  }

  if (shouldPause && monitor.emailEnabled) {
    await sendAutoPauseEmail(monitor, newFailureCount, truncatedError).catch(() => {});
  }

  return { newFailureCount, paused: shouldPause };
}

/**
 * Normalizes values by trimming, collapsing spaces, and removing invisible characters.
 */
export function normalizeValue(raw: string): string {
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

  // Patterns that are highly specific to block pages — no false-positive guard needed
  // for body text matching (they are unlikely to appear in normal content).
  const strictPatterns = [
    { pattern: /please enable cookies/i, reason: "Cookies required" },
    { pattern: /verify you are a human/i, reason: "Human verification (Captcha)" },
    { pattern: /checking your browser/i, reason: "Browser check (Cloudflare)" },
    { pattern: /unusual traffic/i, reason: "Rate limited" },
  ];

  // Patterns that commonly appear in legitimate content — only flag them
  // when the page is short (< 4000 chars visible text, typical of interstitials)
  // or when the pattern appears more than twice (indicating a block page, not
  // a passing mention).
  const fuzzyPatterns = [
    { pattern: /enable javascript/i, reason: "JavaScript required" },
    { pattern: /access denied/i, reason: "Access denied" },
    { pattern: /just a moment/i, reason: "Interstitial/Challenge" },
    { pattern: /captcha/i, reason: "Captcha detected" },
  ];

  // Title matches are always suspicious regardless of pattern type
  for (const { pattern, reason } of [...strictPatterns, ...fuzzyPatterns]) {
    if (pattern.test(title)) {
      return { blocked: true, reason: `${reason} (Matched in title: "${pattern.source}")` };
    }
  }

  // Strict patterns: flag on any body match
  for (const { pattern, reason } of strictPatterns) {
    if (pattern.test(visibleTextLower)) {
      return { blocked: true, reason: `${reason} (Matched in visible text, length=${visibleTextLength})` };
    }
  }

  // Fuzzy patterns: only flag on short pages or repeated occurrences
  for (const { pattern, reason } of fuzzyPatterns) {
    if (pattern.test(visibleTextLower)) {
      const isSuspicious = visibleTextLength < 4000 || (visibleTextLower.split(pattern).length - 1) > 2;
      if (!isSuspicious) continue;
      return { blocked: true, reason: `${reason} (Matched in visible text, length=${visibleTextLength})` };
    }
  }

  // Challenge element markers — use specific selectors that indicate actual
  // challenge widgets rather than incidental Cloudflare CDN classes.
  const challengeMarkers = [
    '[id*="captcha"]',
    '[class*="captcha"]',
    '[id*="challenge"]',
    '[class*="challenge"]',
    '[class*="cf-browser"]',
    '[class*="cf-error"]',
    '[class*="cf-challenge"]',
    '.turnstile',
    '.h-captcha',
    '.g-recaptcha',
  ];
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
export function extractValueFromHtml(html: string, selector: string): string | null {
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
export async function extractWithBrowserless(url: string, selector: string, monitorId?: number, monitorName?: string): Promise<{
  value: string | null,
  urlAfter: string,
  title: string,
  selectorCount: number,
  blocked: boolean,
  reason?: string
}> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error("BROWSERLESS_TOKEN not configured");

  // Validate URL before allowing headless navigation (SSRF gate)
  await validateUrlBeforeFetch(url);

  let browser;
  let chromium;
  try {
    const playwrightModule = await import("playwright-core");
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
    // Intercept all navigation requests (including redirects) to enforce SSRF validation
    await context.route('**/*', async (route) => {
      if (!route.request().isNavigationRequest()) return route.continue();
      try {
        await validateUrlBeforeFetch(route.request().url());
        return route.continue();
      } catch {
        return route.abort();
      }
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
    const label = monitorName ? `"${monitorName}" — browser` : "Browser";
    await ErrorLogger.error("scraper", `${label}-based extraction failed — the page may be unreachable or blocking automated access. Check that the URL loads in a normal browser.`, error instanceof Error ? error : null, { url, selector, ...(monitorId ? { monitorId } : {}), ...(monitorName ? { monitorName } : {}) });
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function fetchWithCurl(url: string, monitorId?: number, monitorName?: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await ssrfSafeFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return await response.text();
  } catch (error) {
    const label = monitorName ? `"${monitorName}" — page` : "Page";
    await ErrorLogger.error("scraper", `${label} fetch with curl failed — the site returned an error or is blocking the request. Verify the URL is correct and the site is accessible.`, error instanceof Error ? error : null, { url, ...(monitorId ? { monitorId } : {}), ...(monitorName ? { monitorName } : {}) });
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
      const response = await ssrfSafeFetch(monitor.url, {
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
        html = await fetchWithCurl(monitor.url, monitor.id, monitor.name);
      } else {
        throw e;
      }
    }

    if (!html) {
      await recordMetric(monitor.id, "static", 0, "error");
      await handleMonitorFailure(monitor, "error", "Failed to fetch page", false);
      return {
        changed: false,
        currentValue: monitor.currentValue,
        previousValue: monitor.currentValue,
        status: "error" as const,
        error: "Failed to fetch page"
      };
    }

    // Stage: Static
    const staticStart = Date.now();
    let newValue = extractValueFromHtml(html, monitor.selector);
    let block = detectPageBlockReason(html);
    const staticDuration = Date.now() - staticStart;
    const staticStatus = newValue ? "ok" : (block.blocked ? "blocked" : "selector_missing");
    await recordMetric(monitor.id, "static", staticDuration, staticStatus, newValue ? 1 : 0, block.blocked, block.reason);
    console.log(`stage=static selectorCount=${newValue ? 1 : 0} blocked=${block.blocked}${block.blocked ? ` reason="${block.reason}"` : ""}`);

    if (!newValue && !block.blocked) {
      console.log(`Retry: static extraction found no value, retrying fetch once...`);
      await new Promise(r => setTimeout(r, 2000));
      const retryStart = Date.now();
      try {
        let retryHtml = "";
        try {
          const retryResponse = await ssrfSafeFetch(monitor.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
              'Upgrade-Insecure-Requests': '1'
            },
            signal: AbortSignal.timeout(20000)
          });
          retryHtml = await retryResponse.text();
        } catch (e: any) {
          if (e.code === 'UND_ERR_HEADERS_OVERFLOW' || (e.cause && e.cause.code === 'UND_ERR_HEADERS_OVERFLOW')) {
            retryHtml = await fetchWithCurl(monitor.url, monitor.id, monitor.name);
          }
        }
        if (retryHtml) {
          const retryValue = extractValueFromHtml(retryHtml, monitor.selector);
          const retryBlock = detectPageBlockReason(retryHtml);
          const retryStatus = retryValue ? "ok" : (retryBlock.blocked ? "blocked" : "selector_missing");
          await recordMetric(monitor.id, "static_retry", Date.now() - retryStart, retryStatus, retryValue ? 1 : 0, retryBlock.blocked, retryBlock.reason);
          if (retryValue) {
            newValue = retryValue;
            block = retryBlock;
            console.log(`Retry: succeeded on second attempt`);
          } else if (retryBlock.blocked) {
            block = retryBlock;
          }
        } else {
          await recordMetric(monitor.id, "static_retry", Date.now() - retryStart, "error");
        }
      } catch (e) {
        await recordMetric(monitor.id, "static_retry", Date.now() - retryStart, "error");
        console.log(`Retry: second attempt failed, continuing with original result`);
      }
    }

    // Fallback to Rendered if static failed or blocked
    let browserlessInfraFailure = false;
    if ((!newValue || block.blocked) && process.env.BROWSERLESS_TOKEN) {
      const user = await storage.getUser(monitor.userId);
      const tier = (user?.tier || "free") as UserTier;
      const capCheck = await BrowserlessUsageTracker.canUseBrowserless(monitor.userId, tier);

      if (capCheck.allowed) {
        const startTime = Date.now();
        let browserlessSuccess = false;
        try {
          const result = await extractWithBrowserless(monitor.url, monitor.selector, monitor.id, monitor.name);
          browserlessSuccess = true;
          const bStatus = result.value ? "ok" : (result.blocked ? "blocked" : "selector_missing");
          await recordMetric(monitor.id, "browserless", Date.now() - startTime, bStatus, result.selectorCount, result.blocked, result.reason);
          newValue = result.value;
          block = { blocked: result.blocked, reason: result.reason };
          console.log(`stage=rendered selectorCount=${result.selectorCount} blocked=${block.blocked}${block.blocked ? ` reason="${block.reason}"` : ""}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          const isInfra = errMsg.includes("connectOverCDP") || errMsg.includes("websocket") || errMsg.includes("Playwright") || errMsg.includes("Browser is not connected") || errMsg.includes("Browser has been closed") || errMsg.includes("ECONNREFUSED") || errMsg.includes("Target page, context or browser has been closed");
          if (isInfra) {
            browserlessInfraFailure = true;
          }
          await recordMetric(monitor.id, "browserless", Date.now() - startTime, "error", undefined, false, errMsg);
          await ErrorLogger.error("scraper", `"${monitor.name}" — rendered page extraction failed. The site may block automated browsers or the page took too long to load. Try simplifying the selector or check if the site requires login.`, err instanceof Error ? err : null, { monitorId: monitor.id, monitorName: monitor.name, url: monitor.url, selector: monitor.selector });
        } finally {
          const durationMs = Date.now() - startTime;
          await BrowserlessUsageTracker.recordUsage(monitor.userId, monitor.id, durationMs, browserlessSuccess).catch(() => {});
        }
      } else {
        console.log(`Browserless skipped for monitor ${monitor.id}: ${capCheck.reason}`);
      }
    }

    const oldValue = monitor.currentValue;
    
    let finalStatus: "ok" | "blocked" | "selector_missing" | "error" = "ok";
    let finalError: string | null = null;

    if (!newValue) {
      if (browserlessInfraFailure) {
        finalStatus = "error";
        finalError = "Browserless service unavailable";
      } else if (block.blocked) {
        finalStatus = "blocked";
        finalError = block.reason || "Blocked";
      } else {
        finalStatus = "selector_missing";
        finalError = "Selector not found";
      }
    }

    // Auto-heal: when the selector is missing and we have a last known value,
    // try to discover a new selector that matches the old value on the page.
    if (finalStatus === "selector_missing" && oldValue && process.env.BROWSERLESS_TOKEN && !browserlessInfraFailure) {
      const user = await storage.getUser(monitor.userId);
      const tier = (user?.tier || "free") as UserTier;
      const capCheck = await BrowserlessUsageTracker.canUseBrowserless(monitor.userId, tier);

      if (capCheck.allowed) {
        try {
          console.log(`[AutoHeal] Monitor ${monitor.id}: selector "${monitor.selector}" missing, attempting auto-recovery with last value "${oldValue.substring(0, 50)}"`);
          const healStart = Date.now();
          const discovery = await discoverSelectors(monitor.url, monitor.selector, oldValue);
          const healDuration = Date.now() - healStart;
          await BrowserlessUsageTracker.recordUsage(monitor.userId, monitor.id, healDuration, true).catch(() => {});

          if (discovery.suggestions.length > 0) {
            // Pick the best suggestion: prefer single-match selectors, then shortest
            const best = discovery.suggestions
              .sort((a, b) => (a.count === 1 ? 0 : 1) - (b.count === 1 ? 0 : 1) || a.selector.length - b.selector.length)[0];

            console.log(`[AutoHeal] Monitor ${monitor.id}: found replacement selector "${best.selector}" (matches=${best.count}, sample="${best.sampleText}")`);
            await recordMetric(monitor.id, "auto_heal", healDuration, "ok", best.count);

            // Update the monitor with the new selector and re-extract the value
            await storage.updateMonitor(monitor.id, { selector: best.selector });
            newValue = normalizeValue(best.sampleText) || null;
            finalStatus = "ok";
            finalError = null;

            await ErrorLogger.info(
              "scraper",
              `"${monitor.name}" — auto-healed selector from "${monitor.selector}" to "${best.selector}". The page structure likely changed.`,
              { monitorId: monitor.id, monitorName: monitor.name, oldSelector: monitor.selector, newSelector: best.selector }
            );
          } else {
            console.log(`[AutoHeal] Monitor ${monitor.id}: no replacement selector found`);
            await recordMetric(monitor.id, "auto_heal", healDuration, "selector_missing", 0);
            finalError = "Selector not found on page (auto-recovery failed — no matching elements found for the last known value)";
          }
        } catch (healErr) {
          console.log(`[AutoHeal] Monitor ${monitor.id}: auto-recovery failed:`, healErr instanceof Error ? healErr.message : healErr);
          // Don't change finalStatus/finalError — fall through to normal failure path
        }
      }
    }

    if (finalStatus === "ok") {
      const changed = newValue !== oldValue;

      await storage.updateMonitor(monitor.id, {
        lastChecked: new Date(),
        currentValue: newValue,
        lastStatus: finalStatus,
        lastError: null,
        consecutiveFailures: 0,
      });

      if (changed) {
        await storage.addMonitorChange(monitor.id, oldValue, newValue);
        await storage.updateMonitor(monitor.id, { lastChanged: new Date() });
        if (monitor.emailEnabled) {
          await sendNotificationEmail(monitor, oldValue, newValue);
        }
      }

      return { 
        changed, 
        currentValue: newValue,
        previousValue: oldValue,
        status: finalStatus,
        error: null
      };
    } else {
      await handleMonitorFailure(monitor, finalStatus, finalError!, browserlessInfraFailure);

      return {
        changed: false,
        currentValue: oldValue,
        previousValue: oldValue,
        status: finalStatus,
        error: finalError
      };
    }
  } catch (error) {
    await ErrorLogger.error("scraper", `"${monitor.name}" failed to check — the page could not be fetched or parsed. Verify the URL is accessible and the CSS selector is correct.`, error instanceof Error ? error : null, { monitorId: monitor.id, monitorName: monitor.name, url: monitor.url, selector: monitor.selector });

    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await handleMonitorFailure(monitor, "error", errorMsg, false);

    return {
      changed: false,
      currentValue: monitor.currentValue,
      previousValue: monitor.currentValue,
      status: "error" as const,
      error: errorMsg
    };
  }
}

/**
 * Normalize text for matching: lowercase, remove whitespace/commas/currency symbols.
 */
export function normalizeTextForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s,]+/g, '')
    .replace(/[$€£¥₹]/g, '');
}

/**
 * Extract digits-only version for fallback matching.
 */
export function extractDigits(text: string): string {
  return text.replace(/[^\d.]/g, '');
}

/**
 * Check if candidate text matches expected text using normalized comparison.
 */
export function textMatches(candidateText: string, expectedText: string): boolean {
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

  // Validate URL before allowing headless navigation (SSRF gate)
  await validateUrlBeforeFetch(url);

  let browser;
  let chromium;
  try {
    const playwrightModule = await import("playwright-core");
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
    // Intercept all navigation requests (including redirects) to enforce SSRF validation
    await context.route('**/*', async (route) => {
      if (!route.request().isNavigationRequest()) return route.continue();
      try {
        await validateUrlBeforeFetch(route.request().url());
        return route.continue();
      } catch {
        return route.abort();
      }
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
