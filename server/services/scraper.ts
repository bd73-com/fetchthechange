import * as cheerio from "cheerio";
import { storage } from "../storage";
import { sendNotificationEmail, sendAutoPauseEmail, sendHealthWarningEmail, sendRecoveryEmail } from "./email";
import { processChangeNotification } from "./notification";
import { ErrorLogger } from "./logger";
import { BrowserlessUsageTracker } from "./browserlessTracker";
import { browserlessCircuitBreaker } from "./browserlessCircuitBreaker";
import { isTransientDbError } from "../utils/dbErrors";
import { browserPool } from "./browserPool";
import { validateUrlBeforeFetch, ssrfSafeFetch } from "../utils/ssrf";
import { type Monitor, monitorMetrics, monitors } from "@shared/schema";
import { type UserTier, PAUSE_THRESHOLDS } from "@shared/models/auth";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";

/**
 * In-memory set of monitor IDs that need accelerated retry due to
 * Browserless infrastructure failures. Cleared on success or server restart.
 */
export const monitorsNeedingRetry = new Set<number>();

/** Pool of modern User-Agent profiles to rotate per request, reducing fingerprint-based blocking. */
const UA_PROFILES: Array<{ userAgent: string; secChUa?: string; secChUaPlatform?: string }> = [
  // Chrome 133 – Windows 10
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="133", "Not(A:Brand";v="99", "Google Chrome";v="133"',
    secChUaPlatform: '"Windows"',
  },
  // Chrome 133 – macOS
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="133", "Not(A:Brand";v="99", "Google Chrome";v="133"',
    secChUaPlatform: '"macOS"',
  },
  // Chrome 134 – Windows 10
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
    secChUaPlatform: '"Windows"',
  },
  // Chrome 134 – macOS
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
    secChUaPlatform: '"macOS"',
  },
  // Chrome 132 – Windows 11 (one version back for diversity)
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="132", "Not_A Brand";v="24", "Google Chrome";v="132"',
    secChUaPlatform: '"Windows"',
  },
  // Chrome 132 – macOS
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="132", "Not_A Brand";v="24", "Google Chrome";v="132"',
    secChUaPlatform: '"macOS"',
  },
  // Firefox 135 – Windows 10 (no Sec-CH-UA headers — omitted, not empty)
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
  },
  // Firefox 134 – macOS
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0',
  },
];

function pickUaProfile() {
  return UA_PROFILES[Math.floor(Math.random() * UA_PROFILES.length)];
}

/** Chrome-only profiles for Browserless contexts where stealthInitScript injects Chrome-specific
 *  JS stubs (window.chrome, navigator.plugins, mimeTypes). Using a Firefox UA in Chromium
 *  creates a contradictory fingerprint that is a stronger bot signal than no stealth at all. */
const CHROME_PROFILES = UA_PROFILES.filter(p => p.secChUa != null);

function pickChromeProfile() {
  return CHROME_PROFILES[Math.floor(Math.random() * CHROME_PROFILES.length)];
}

/** Returns browser-like headers with a randomly selected UA profile. */
function browserLikeHeaders(url: string) {
  const profile = pickUaProfile();
  const headers: Record<string, string> = {
    'User-Agent': profile.userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  };
  // No Referer on direct navigation — real browsers don't send one
  // Only send Client Hints headers for Chrome profiles — Firefox never sends them
  if (profile.secChUa) {
    headers['Sec-CH-UA'] = profile.secChUa;
    headers['Sec-CH-UA-Mobile'] = '?0';
    if (profile.secChUaPlatform) headers['Sec-CH-UA-Platform'] = profile.secChUaPlatform;
  }
  return headers;
}

/** Returns Browserless stealth context options with a Chrome-only UA profile.
 *  Browserless runs Chromium — Firefox UAs would contradict the Chrome-specific
 *  JS stubs injected by stealthInitScript(). */
function stealthContextOptions() {
  const profile = pickChromeProfile();
  const extraHTTPHeaders: Record<string, string> = {
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-CH-UA': profile.secChUa!,
    'Sec-CH-UA-Mobile': '?0',
  };
  if (profile.secChUaPlatform) extraHTTPHeaders['Sec-CH-UA-Platform'] = profile.secChUaPlatform;
  return {
    userAgent: profile.userAgent,
    locale: "en-US",
    viewport: { width: 1920, height: 1080 },
    screen: { width: 1920, height: 1080 },
    extraHTTPHeaders,
  };
}

/** Attributes to check for values when innerText is empty. */
const VALUE_ATTRIBUTES = ['content', 'data-price', 'value', 'data-value'] as const;

/** Pattern matching known tracking/analytics domains to block in Browserless sessions. */
const BLOCKED_TRACKING_PATTERN = /google-analytics|googletagmanager|facebook\.net|doubleclick|hotjar|segment\.io|newrelic|datadoghq/i;

/** Resource types to block in Browserless sessions to speed up page load.
 *  Images and fonts are intentionally allowed — anti-bot systems (DataDome, Akamai)
 *  fingerprint pages that load zero images/fonts as headless. This increases bandwidth
 *  but is necessary for evasion on retail sites. Only media (video/audio) is blocked. */
const BLOCKED_RESOURCE_TYPES = ['media'];

/** Base delay for exponential backoff on Browserless retry. */
export const BASE_RETRY_MS = 2000;
/** Maximum random jitter added to retry delay. */
export const JITTER_CAP_MS = 1500;

// Re-export pool types for backward compatibility with tests/index.ts
export { BrowserPool, browserPool } from "./browserPool";

/**
 * Opens a Browserless page with stealth settings, resource blocking, and SSRF
 * validation, then passes the ready page to a callback. Handles browser lifecycle
 * (connection, context, cleanup) so callers only provide page-interaction logic.
 */
async function withBrowserlessPage<T>(
  url: string,
  callback: (page: any, consentDismissed: boolean) => Promise<T>,
  options?: { pageTimeoutMs?: number },
): Promise<T> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error("BROWSERLESS_TOKEN not configured");

  await validateUrlBeforeFetch(url);

  let browser: any;
  let reusable = false;
  let context: any;
  try {
    const playwrightModule = await import("playwright-core");
    const chromium = playwrightModule.chromium;
    if (!chromium || typeof chromium.connectOverCDP !== 'function') {
      throw new Error("Playwright browser automation is not available");
    }

    const wsUrl = `wss://production-sfo.browserless.io/stealth?token=${encodeURIComponent(token)}`;
    const connectFn = async () => {
      try {
        return await chromium.connectOverCDP(wsUrl, { timeout: 30000 });
      } catch (err: any) {
        // Strip the token from error messages/stack to prevent secret leakage
        if (err?.message) err.message = err.message.replaceAll(token, '[REDACTED]');
        if (err?.stack) err.stack = err.stack.replaceAll(token, '[REDACTED]');
        throw err;
      }
    };
    ({ browser, reusable } = await browserPool.acquire(connectFn));

    context = await browser.newContext(stealthContextOptions());
    await context.route('**/*', async (route: any) => {
      if (BLOCKED_RESOURCE_TYPES.includes(route.request().resourceType())) {
        return route.abort();
      }
      if (BLOCKED_TRACKING_PATTERN.test(route.request().url())) {
        return route.abort();
      }
      // Validate all HTTP(S) requests against SSRF rules, not just navigations.
      // Non-HTTP schemes (about:, data:, blob:) are safe to pass through.
      const requestUrl = route.request().url();
      if (/^https?:/i.test(requestUrl)) {
        try {
          await validateUrlBeforeFetch(requestUrl);
        } catch {
          return route.abort();
        }
      }
      return route.continue();
    });
    const page = await context.newPage();

    const pageTimeout = options?.pageTimeoutMs ?? 30000;
    await page.addInitScript(stealthInitScript);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: pageTimeout });
    await page.waitForLoadState("networkidle", { timeout: Math.min(pageTimeout, 15000) }).catch(() => {});

    const consentDismissed = await tryDismissConsent(page);
    if (consentDismissed) {
      await page.waitForTimeout(800);
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    }

    return await callback(page, consentDismissed);
  } finally {
    // Always close the context first to release its renderer process, cookies,
    // and localStorage — prevents cross-monitor data bleed on pooled browsers.
    if (context?.close) await context.close().catch(() => {});
    if (browser) {
      browserPool.release(browser, reusable);
      if (!reusable) {
        await browser.close();
      }
    }
  }
}

/** Stealth init script injected into browser pages before navigation to evade bot detection. */
function stealthInitScript() {
  // 1. Hide webdriver flag — headless Chrome sets this to true; real browsers have it undefined
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // 2. navigator.plugins — realistic Chrome plugin array
  const pluginData = [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
  ];
  const pluginArray = Object.create(PluginArray.prototype);
  Object.defineProperty(pluginArray, 'length', { get: () => pluginData.length });
  pluginData.forEach((p, i) => {
    const plugin = Object.create(Plugin.prototype);
    Object.defineProperty(plugin, 'name', { get: () => p.name });
    Object.defineProperty(plugin, 'filename', { get: () => p.filename });
    Object.defineProperty(plugin, 'description', { get: () => p.description });
    Object.defineProperty(plugin, 'length', { get: () => 0 });
    Object.defineProperty(pluginArray, i, { get: () => plugin });
    Object.defineProperty(pluginArray, p.name, { get: () => plugin });
  });
  Object.defineProperty(navigator, 'plugins', { get: () => pluginArray });

  // 3. navigator.languages
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  }

  // 4. window.chrome — absent in headless, present in real Chrome
  if (!(window as any).chrome) {
    (window as any).chrome = {
      runtime: {
        connect: function() {
          return {
            onMessage: { addListener: function() {}, removeListener: function() {} },
            onDisconnect: { addListener: function() {}, removeListener: function() {} },
            postMessage: function() {},
            name: '',
          };
        },
        sendMessage: function() {},
        id: undefined,
        onMessage: { addListener: function() {}, removeListener: function() {} },
        onConnect: { addListener: function() {}, removeListener: function() {} },
        getManifest: function() { return {}; },
      },
      csi: function() { return {}; },
      loadTimes: function() {
        const t = Date.now() / 1000;
        return {
          requestTime: t,
          startLoadTime: t + 0.01,
          commitLoadTime: t + 0.05,
          finishDocumentLoadTime: t + 0.15,
          finishLoadTime: t + 0.2,
          firstPaintTime: t + 0.18,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: false,
          wasNpnNegotiated: false,
          npnNegotiatedProtocol: 'unknown',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        };
      },
    };
  }

  // 5. WebGL — spoof renderer/vendor away from SwiftShader
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
      if (parameter === 37445) return 'Intel Inc.';   // UNMASKED_VENDOR_WEBGL
      if (parameter === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
      return getParameter.call(this, parameter);
    };
  } catch (_) { /* WebGL may be unavailable */ }

  // 6. Permissions API — spoof notifications as 'prompt'
  try {
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    window.navigator.permissions.query = (params: any) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: 'prompt', onchange: null } as PermissionStatus)
        : originalQuery(params);
  } catch (_) { /* permissions API may be unavailable */ }

  // 7. navigator.connection — spoof realistic NetworkInformation object
  // Headless Chrome often lacks this or returns unrealistic values
  try {
    if (!(navigator as any).connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false,
          onchange: null,
        }),
      });
    }
  } catch (_) { /* may be read-only in some contexts */ }

  // 8. Remove cdc_ prefixed properties injected by Chrome DevTools Protocol
  // These are a dead giveaway that the browser is being automated
  try {
    for (const key of Object.keys(window)) {
      if (key.startsWith('cdc_')) {
        delete (window as any)[key];
      }
    }
    // Also clean up document-level cdc_ properties
    for (const key of Object.keys(document)) {
      if (key.startsWith('cdc_')) {
        delete (document as any)[key];
      }
    }
  } catch (_) { /* best-effort cleanup */ }

  // 9. Notification.permission — override to 'default' instead of 'denied'
  // Real browsers return 'default' until the user grants or denies; headless returns 'denied'
  try {
    Object.defineProperty(Notification, 'permission', {
      get: () => 'default',
    });
  } catch (_) { /* Notification API may be unavailable */ }

  // 10. navigator.mimeTypes — realistic Chrome MIME types
  try {
    const mimeData = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ];
    const mimeArray = Object.create(MimeTypeArray.prototype);
    Object.defineProperty(mimeArray, 'length', { get: () => mimeData.length });
    mimeData.forEach((m, i) => {
      const mimeType = Object.create(MimeType.prototype);
      Object.defineProperty(mimeType, 'type', { get: () => m.type });
      Object.defineProperty(mimeType, 'suffixes', { get: () => m.suffixes });
      Object.defineProperty(mimeType, 'description', { get: () => m.description });
      Object.defineProperty(mimeArray, i, { get: () => mimeType });
      Object.defineProperty(mimeArray, m.type, { get: () => mimeType });
    });
    Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeArray });
  } catch (_) { /* mimeTypes may be read-only */ }

  // 11. WebGL2 — same spoof as WebGL1 to prevent detection via WebGL2 fallback
  try {
    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(parameter: number) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter2.call(this, parameter);
    };
  } catch (_) { /* WebGL2 may be unavailable */ }
}

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

/**
 * Classifies a non-2xx HTTP response status into a user-facing message
 * and indicates whether the error is transient (should fall through to
 * browserless/retry) or permanent (should skip retries).
 */
export function classifyHttpStatus(status: number): {
  status: number;
  message: string;
  transient: boolean;
} {
  if (status === 401) return { status, message: "Access denied by the target site (HTTP 401). The page may require authentication", transient: false };
  if (status === 403) return { status, message: "Access denied by the target site (HTTP 403)", transient: false };
  if (status === 404) return { status, message: "Page not found (HTTP 404). Check that the URL is correct", transient: false };
  if (status === 410) return { status, message: "Page no longer exists (HTTP 410)", transient: false };
  if (status === 429) return { status, message: "Rate limited by the target site (HTTP 429)", transient: true };
  if (status >= 400 && status < 500) return { status, message: `Target site rejected the request (HTTP ${status})`, transient: false };
  if (status === 502) return { status, message: "Target site is temporarily unavailable (HTTP 502)", transient: true };
  if (status === 503) return { status, message: "Target site is temporarily unavailable (HTTP 503)", transient: true };
  if (status === 504) return { status, message: "Target site took too long to respond (HTTP 504)", transient: true };
  if (status >= 500) return { status, message: `Target site returned a server error (HTTP ${status})`, transient: true };
  return { status, message: `Unexpected HTTP status ${status}`, transient: false };
}

/**
 * Extracts an HTTP status code from an error message string.
 * Returns null if no HTTP status code pattern is found.
 */
function extractHttpStatus(message: string): number | null {
  const match = message.match(/\bHTTP\s+([45]\d{2})\b/i);
  return match ? Number(match[1]) : null;
}

/**
 * Sanitizes raw error messages before they are stored in the DB or returned to clients.
 * Strips internal hostnames, IP addresses, file paths, and stack traces that could
 * leak infrastructure details.
 */
function sanitizeErrorForClient(raw: string): string {
  if (/abort|timeout/i.test(raw)) return "Page took too long to respond";
  if (/ECONNREFUSED/i.test(raw)) return "Could not connect to the target site";
  if (/ENOTFOUND|EAI_AGAIN/i.test(raw)) return "Could not resolve the target hostname";
  if (/ECONNRESET|socket hang up/i.test(raw)) return "Connection was reset by the target site";
  if (/SSRF blocked.*Too many redirects/i.test(raw)) return "Too many redirects while fetching the page";
  if (/SSRF blocked/i.test(raw)) return "URL is not allowed";
  if (/certificate|ssl|tls/i.test(raw)) return "SSL/TLS error connecting to the target site";
  if (/UND_ERR_HEADERS_OVERFLOW/i.test(raw)) return "Response headers from the target site were too large";
  const httpStatus = extractHttpStatus(raw);
  if (httpStatus !== null) return classifyHttpStatus(httpStatus).message;
  return "Failed to fetch page";
}

/**
 * Classifies errors caught by the outer checkMonitor catch block.
 * Unlike sanitizeErrorForClient (which handles fetch errors specifically),
 * this handles the full range of errors including DB and parsing failures.
 */
export function classifyOuterError(error: unknown): { userMessage: string; logContext: string } {
  if (!(error instanceof Error)) {
    return { userMessage: "An unexpected error occurred", logContext: "non-Error thrown" };
  }

  const msg = error.message;

  // DB / storage errors (Drizzle, pg)
  if (/relation|column|constraint|violates|duplicate key|deadlock|pg_|drizzle/i.test(msg)) {
    return { userMessage: "A temporary server error occurred. The check will be retried automatically.", logContext: "database error" };
  }
  if (/ECONNREFUSED.*5432|connection.*postgres|connection.*database/i.test(msg)) {
    return { userMessage: "A temporary server error occurred. The check will be retried automatically.", logContext: "database connection error" };
  }

  // SSRF blocks — security-relevant, must stay at error level (not transient)
  if (/SSRF blocked/i.test(msg)) {
    return { userMessage: sanitizeErrorForClient(msg), logContext: "ssrf_blocked" };
  }

  // Network errors — delegate to the existing fetch-error sanitizer
  if (/abort|timeout|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|socket hang up|certificate|ssl|tls|UND_ERR_HEADERS_OVERFLOW/i.test(msg)) {
    return { userMessage: sanitizeErrorForClient(msg), logContext: "network error" };
  }

  // HTTP status errors (from classifyHttpStatus messages)
  const httpStatus = extractHttpStatus(msg);
  if (httpStatus !== null) {
    return { userMessage: classifyHttpStatus(httpStatus).message, logContext: "http status error" };
  }

  // Cheerio / parsing errors
  if (/cheerio|parse|SyntaxError|Unexpected token/i.test(msg)) {
    return { userMessage: "Failed to parse the page content. The page structure may be incompatible.", logContext: "parsing error" };
  }

  return { userMessage: "Failed to fetch or parse the page. Verify the URL is accessible and the selector is correct.", logContext: "unclassified error" };
}

/** Permanent error patterns that should never trigger auto-retry. */
const PERMANENT_ERROR_RE = /ENOTFOUND|certificate|ssl|tls|SSRF blocked|Could not resolve|SSL\/TLS error|URL is not allowed/i;

/**
 * Schedule a single auto-retry 35 minutes from now for transient scrape errors.
 * Skips if the monitor was just paused, has a pending retry, the error is permanent,
 * or the next normal check is imminent (within 45 minutes).
 */
async function maybeScheduleAutoRetry(
  monitor: Monitor,
  errorMessage: string,
  wasPaused: boolean,
): Promise<void> {
  if (
    !monitor.active ||
    wasPaused ||
    monitor.pendingRetryAt ||
    PERMANENT_ERROR_RE.test(errorMessage)
  ) {
    return;
  }

  const frequencyMinutes = monitor.frequency === "hourly" ? 60 : 1440;
  // Use Date.now() as the effective lastChecked since handleMonitorFailure
  // already updated it in the DB — avoids using the stale in-memory value.
  const minsUntilNormal = frequencyMinutes - 0; // just checked → full interval ahead
  // More precisely: since we just failed, lastChecked was just set to now,
  // so the next normal check is ~frequencyMinutes from now.

  if (minsUntilNormal > 45) {
    try {
      const retryAt = new Date(Date.now() + 35 * 60 * 1000);
      await db.update(monitors)
        .set({ pendingRetryAt: retryAt })
        .where(eq(monitors.id, monitor.id));
      console.log(`[AutoRetry] Monitor ${monitor.id} — retry scheduled at ${retryAt.toISOString()}`);
    } catch (err) {
      console.error(`[AutoRetry] Failed to set pendingRetryAt for monitor ${monitor.id}:`,
        err instanceof Error ? err.message : err);
    }
  } else {
    console.log(`[AutoRetry] Monitor ${monitor.id} — skipped (next normal check in ${Math.round(minsUntilNormal)} min)`);
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
  const truncatedError = Array.from(errorMsg).slice(0, 200).join('');

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
      healthAlertSentAt: shouldPenalize
        ? sql`CASE WHEN ${monitors.consecutiveFailures} + 1 >= ${threshold} THEN NULL ELSE ${monitors.healthAlertSentAt} END`
        : monitors.healthAlertSentAt,
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

  // Early warning: fire at halfway point before auto-pause (Power tier only).
  // NOTE: Health warning emails bypass the processChangeNotification pipeline
  // (no delivery_log, no quiet hours, no webhook/Slack) — they are operational
  // alerts sent directly via email. See recovery-email comment in checkMonitor.
  if (shouldPenalize && !shouldPause) {
    const warningThreshold = Math.floor(threshold / 2);
    if (newFailureCount === warningThreshold && monitor.healthAlertSentAt === null) {
      if (tier === "power") {
        const nextPauseIn = threshold - newFailureCount;
        try {
          await sendHealthWarningEmail(monitor, newFailureCount, nextPauseIn, truncatedError);
          await storage.setHealthAlertSent(monitor.id);
        } catch (warningErr) {
          console.error(`[Scraper] Health warning email failed for monitor ${monitor.id}:`, warningErr);
        }
      }
    }
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
    let rawValue = elements.first().text();
    if (!rawValue) {
      for (const attr of VALUE_ATTRIBUTES) {
        rawValue = elements.first().attr(attr) || "";
        if (rawValue) break;
      }
    }
    return normalizeValue(rawValue || "") || null;
  }
  return null;
}

/**
 * Extracts a price/value from JSON-LD structured data embedded in the page.
 * Many e-commerce sites include `<script type="application/ld+json">` blocks
 * with Product schema data, allowing extraction without a headless browser.
 */
export function extractFromJsonLd(html: string): string | null {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]');
  if (scripts.length === 0) return null;

  for (let i = 0; i < scripts.length; i++) {
    const raw = $(scripts[i]).html();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const objects = Array.isArray(parsed) ? parsed : [parsed];
    for (const obj of objects) {
      const price = extractPriceFromSchema(obj);
      if (price) return price;
    }
  }

  return null;
}

function extractPriceFromSchema(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;

  const rawType = obj["@type"];
  const types: string[] = Array.isArray(rawType) ? rawType : [rawType];

  if (types.includes("Product") || types.includes("IndividualProduct")) {
    const offers = obj.offers;
    if (!offers) return null;

    // Single offer object
    if (!Array.isArray(offers)) {
      return extractPriceFromOffer(offers);
    }
    // Array of offers — take the first with a price
    for (const offer of offers) {
      const price = extractPriceFromOffer(offer);
      if (price) return price;
    }
    return null;
  }

  if (types.includes("Offer") || types.includes("AggregateOffer")) {
    return extractPriceFromOffer(obj);
  }

  // Recurse into @graph arrays (common in JSON-LD)
  if (Array.isArray(obj["@graph"])) {
    for (const node of obj["@graph"]) {
      const price = extractPriceFromSchema(node);
      if (price) return price;
    }
  }

  return null;
}

function extractPriceFromOffer(offer: any): string | null {
  if (!offer || typeof offer !== "object") return null;

  // AggregateOffer: prefer lowPrice
  const raw = offer.price ?? offer.lowPrice ?? offer.highPrice;
  if (raw == null) return null;

  const str = String(raw);
  const normalized = normalizeValue(str);
  if (!normalized) return null;

  // Format with currency if available
  const currency = offer.priceCurrency;
  if (currency && typeof currency === "string") {
    return normalizeValue(`${currency} ${normalized}`);
  }
  return normalized;
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
 * Classifies Browserless errors into user-friendly messages.
 */
export function classifyBrowserlessError(errMsg: string): string {
  if (/timeout|Timeout|timed out/.test(errMsg)) {
    return "Page took too long to load — the site may be slow or blocking headless browsers";
  }
  if (/net::ERR_NAME_NOT_RESOLVED|getaddrinfo|ENOTFOUND/.test(errMsg)) {
    return "The domain could not be resolved — check the URL is correct";
  }
  if (/net::ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(errMsg)) {
    return "The site refused the connection — it may be down";
  }
  if (/net::ERR_TOO_MANY_REDIRECTS/.test(errMsg)) {
    return "Too many redirects — the page may require a login or cookie";
  }
  if (/403|Forbidden|access denied|bot detection|challenge/i.test(errMsg)) {
    return "The site is actively blocking automated access — try a less frequent check interval";
  }
  return "Rendered page extraction failed — the site may block automated browsers";
}

/**
 * Retries extraction using Browserless.
 */
export async function extractWithBrowserless(url: string, selector: string, monitorId?: number, monitorName?: string, pageTimeoutMs?: number): Promise<{
  value: string | null,
  urlAfter: string,
  title: string,
  selectorCount: number,
  blocked: boolean,
  reason?: string
}> {
  try {
    return await withBrowserlessPage(url, async (page) => {
      const content = await page.content();
      let block = detectPageBlockReason(content);

      // Wait for Cloudflare JS challenge to auto-resolve (typically 3-8s).
      // Check title only — avoids expensive full-DOM innerText traversal on each poll tick.
      if (block.blocked && block.reason && /cloudflare|interstitial|just a moment/i.test(block.reason)) {
        await page.waitForFunction(
          () => {
            const t = document.title?.toLowerCase() ?? '';
            return !t.includes('just a moment') && !t.includes('checking');
          },
          { timeout: 15000 }
        ).catch(() => {});
        const resolvedContent = await page.content();
        block = detectPageBlockReason(resolvedContent);
      }

      const trimmedSelector = selector.trim();
      const isClassName = !trimmedSelector.startsWith('.') && !trimmedSelector.startsWith('#') && !trimmedSelector.includes(' ');
      const effectiveSelector = isClassName ? `.${trimmedSelector}` : trimmedSelector;

      // Small random delay before selector access to mimic human reading behavior.
      // Deduct from waitForSelector timeout to avoid pushing total beyond page budget.
      const humanDelay = 800 + Math.floor(Math.random() * 1200);
      await page.waitForTimeout(humanDelay);
      await page.waitForSelector(effectiveSelector, { timeout: Math.max(10000 - humanDelay, 3000) }).catch(() => {});
      const count = await page.locator(effectiveSelector).count();

      let value: string | null = null;
      if (count > 0) {
        const text = await page.locator(effectiveSelector).first().innerText();
        value = normalizeValue(text);
        // Fallback: check common value-bearing attributes if innerText is empty
        if (!value) {
          const attrs = VALUE_ATTRIBUTES as readonly string[];
          const attrValue = await page.locator(effectiveSelector).first().evaluate(
            (el: Element, attrNames: string[]) => {
              for (const name of attrNames) {
                const v = el.getAttribute(name);
                if (v) return v;
              }
              return null;
            },
            [...attrs],
          );
          if (attrValue) value = normalizeValue(attrValue);
        }
      }

      return {
        value,
        urlAfter: page.url(),
        title: await page.title(),
        selectorCount: count,
        blocked: block.blocked,
        reason: block.reason
      };
    }, { pageTimeoutMs });
  } catch (error) {
    // Don't log here — the caller (checkMonitor) logs with fuller context.
    // Logging here too would create duplicate error entries for every failure.
    throw error;
  }
}

async function fetchWithCurl(url: string, monitorId?: number, monitorName?: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await ssrfSafeFetch(url, {
      headers: browserLikeHeaders(url),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(classifyHttpStatus(response.status).message);
    }
    return await response.text();
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    const rethrow = isAbort
      ? new Error("Page took too long to respond (15s timeout)")
      : error;
    // Don't log here — this is a fallback fetch. The caller decides
    // whether to log based on the overall pipeline outcome.
    throw rethrow;
  } finally {
    clearTimeout(timeout);
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
    let staticFetchError: string | null = null;
    let httpStatusClassification: { status: number; message: string; transient: boolean } | null = null;
    let retryDelayMs = 2000;
    try {
      const response = await ssrfSafeFetch(monitor.url, {
        headers: browserLikeHeaders(monitor.url),
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) {
        httpStatusClassification = classifyHttpStatus(response.status);
        staticFetchError = httpStatusClassification.message;
        // Respect Retry-After header on 429 responses
        if (response.status === 429) {
          const retryAfterSec = parseInt(response.headers.get('retry-after') || '', 10);
          if (!isNaN(retryAfterSec) && retryAfterSec > 0 && retryAfterSec <= 30) {
            retryDelayMs = retryAfterSec * 1000;
          }
        }
        console.log(`[Scraper] Monitor ${monitor.id}: HTTP ${response.status} — ${httpStatusClassification.message}`);
        // Don't parse error page HTML as content for permanent errors
        html = "";
      } else {
        html = await response.text();
      }
    } catch (e: any) {
      if (e.code === 'UND_ERR_HEADERS_OVERFLOW' || (e.cause && e.cause.code === 'UND_ERR_HEADERS_OVERFLOW')) {
        try {
          html = await fetchWithCurl(monitor.url, monitor.id, monitor.name);
        } catch (curlErr: any) {
          staticFetchError = sanitizeErrorForClient(curlErr instanceof Error ? curlErr.message : "Fallback fetch failed");
        }
      } else {
        // Don't re-throw: let the pipeline continue to browserless fallback
        const rawError = e instanceof Error ? e.message : "Fetch failed";
        staticFetchError = sanitizeErrorForClient(rawError);
        console.log(`[Scraper] Monitor ${monitor.id}: static fetch failed — ${staticFetchError}`);
      }
    }

    let newValue: string | null = null;
    let block: { blocked: boolean; reason?: string } = { blocked: false };

    if (html) {
      // Stage: Static extraction
      const staticStart = Date.now();
      newValue = extractValueFromHtml(html, monitor.selector);
      block = detectPageBlockReason(html);
      const staticDuration = Date.now() - staticStart;
      const staticStatus = newValue ? "ok" : (block.blocked ? "blocked" : "selector_missing");
      await recordMetric(monitor.id, "static", staticDuration, staticStatus, newValue ? 1 : 0, block.blocked, block.reason);
      console.log(`stage=static selectorCount=${newValue ? 1 : 0} blocked=${block.blocked}${block.blocked ? ` reason="${block.reason}"` : ""}`);
    } else if (staticFetchError) {
      // Static fetch failed (timeout, network error, etc.) — record metric and continue to fallbacks
      await recordMetric(monitor.id, "static", 0, "error", undefined, false, staticFetchError);
      console.log(`stage=static fetch_failed reason="${staticFetchError}"`);
    } else {
      // Fetch returned empty body — record metric and continue to fallbacks
      staticFetchError = "Page returned empty response";
      await recordMetric(monitor.id, "static", 0, "error", undefined, false, staticFetchError);
      console.log(`stage=static empty_response`);
    }

    // Retry static fetch only when re-fetching might help:
    // - Transient HTTP errors (429, 5xx) — server may recover
    // - Network/fetch errors with no HTTP response at all — connection may succeed on retry
    // Skip retry when page loaded fine (200 OK with HTML) but selector wasn't found —
    // re-fetching the same content won't help; proceed directly to Browserless.
    // Also skip retry for permanent HTTP errors (404, 410, etc.) — server gave a definitive answer.
    const isTransientHttpError = httpStatusClassification?.transient === true;
    const isNetworkError = staticFetchError && !html && !httpStatusClassification;
    const shouldRetryFetch = isTransientHttpError || isNetworkError;
    if (shouldRetryFetch) {
      console.log(`Retry: ${isTransientHttpError ? "transient HTTP error" : "fetch error (no HTML)"}, retrying fetch once after ${retryDelayMs}ms...`);
      await new Promise(r => setTimeout(r, retryDelayMs));
      const retryStart = Date.now();
      try {
        let retryHtml = "";
        try {
          const retryResponse = await ssrfSafeFetch(monitor.url, {
            headers: browserLikeHeaders(monitor.url),
            signal: AbortSignal.timeout(20000)
          });
          if (!retryResponse.ok) {
            httpStatusClassification = classifyHttpStatus(retryResponse.status);
            staticFetchError = httpStatusClassification.message;
            console.log(`[Scraper] Monitor ${monitor.id}: retry also got HTTP ${retryResponse.status} — ${staticFetchError}`);
            retryHtml = "";
          } else {
            retryHtml = await retryResponse.text();
          }
        } catch (e: any) {
          if (e.code === 'UND_ERR_HEADERS_OVERFLOW' || (e.cause && e.cause.code === 'UND_ERR_HEADERS_OVERFLOW')) {
            retryHtml = await fetchWithCurl(monitor.url, monitor.id, monitor.name);
          }
        }
        if (retryHtml) {
          html = retryHtml;
          staticFetchError = null;
          httpStatusClassification = null;
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

    // JSON-LD structured data fallback (before Browserless)
    if (!newValue && !block.blocked && html) {
      const jsonLdValue = extractFromJsonLd(html);
      if (jsonLdValue) {
        newValue = jsonLdValue;
        await recordMetric(monitor.id, "json_ld", 0, "ok", 1);
        console.log(`stage=json_ld value="${jsonLdValue.substring(0, 50)}"`);
      }
    }

    // Fallback to Rendered if static failed or blocked.
    // Skip browserless for permanent HTTP errors (404, 410) where rendering won't help,
    // but allow it for 403 (often bot detection that browserless can bypass).
    const isPermanentHttpError = httpStatusClassification && !httpStatusClassification.transient
      && ![401, 403].includes(httpStatusClassification.status);
    let browserlessInfraFailure = false;
    if ((!newValue || block.blocked) && process.env.BROWSERLESS_TOKEN && !isPermanentHttpError) {
      // Circuit breaker: skip Browserless entirely when the service is known-down
      if (!browserlessCircuitBreaker.isAvailable()) {
        browserlessInfraFailure = true;
        console.log(`[Browserless] Monitor ${monitor.id}: circuit breaker OPEN, skipping Browserless`);
        await recordMetric(monitor.id, "browserless", 0, "error", undefined, false, "Circuit breaker open — Browserless skipped");
      }

      const user = !browserlessInfraFailure ? await storage.getUser(monitor.userId) : null;
      const tier = (user?.tier || "free") as UserTier;
      const capCheck = !browserlessInfraFailure
        ? await BrowserlessUsageTracker.canUseBrowserless(monitor.userId, tier)
        : { allowed: false, reason: "circuit breaker open" };

      if (capCheck.allowed) {
        const startTime = Date.now();
        let browserlessSuccess = false;
        let lastBrowserlessErr: unknown = null;

        // Attempt Browserless extraction with one retry for transient failures
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (attempt > 0) {
              console.log(`[Browserless] Monitor ${monitor.id}: retrying after transient failure (attempt ${attempt + 1})`);
              const delay = BASE_RETRY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * JITTER_CAP_MS);
              await new Promise(r => setTimeout(r, delay));
            }
            // First attempt uses default 30s timeout; retries get 60s for slow-loading pages
            const pageTimeout = attempt > 0 ? 60000 : 30000;
            const result = await extractWithBrowserless(monitor.url, monitor.selector, monitor.id, monitor.name, pageTimeout);
            browserlessSuccess = true;
            browserlessCircuitBreaker.recordSuccess();
            const bStatus = result.value ? "ok" : (result.blocked ? "blocked" : "selector_missing");
            await recordMetric(monitor.id, attempt === 0 ? "browserless" : "browserless_retry", Date.now() - startTime, bStatus, result.selectorCount, result.blocked, result.reason);
            newValue = result.value;
            block = { blocked: result.blocked, reason: result.reason };
            console.log(`stage=rendered attempt=${attempt + 1} selectorCount=${result.selectorCount} blocked=${block.blocked}${block.blocked ? ` reason="${block.reason}"` : ""}`);
            lastBrowserlessErr = null;
            break;
          } catch (err) {
            lastBrowserlessErr = err;
            const errMsg = err instanceof Error ? err.message : "Unknown error";
            const isInfra = errMsg.includes("connectOverCDP") || errMsg.includes("websocket") || errMsg.includes("Playwright") || errMsg.includes("Browser is not connected") || errMsg.includes("Browser has been closed") || errMsg.includes("ECONNREFUSED") || errMsg.includes("Target page, context or browser has been closed");
            if (isInfra) {
              browserlessInfraFailure = true;
              browserlessCircuitBreaker.recordInfraFailure();
              // Don't retry infra failures — the service itself is down
              await recordMetric(monitor.id, "browserless", Date.now() - startTime, "error", undefined, false, errMsg);
              break;
            }
            // For non-infra failures (timeouts, page blocks), retry once
            if (attempt === 0) {
              await recordMetric(monitor.id, "browserless", Date.now() - startTime, "error", undefined, false, errMsg);
              console.log(`[Browserless] Monitor ${monitor.id}: transient failure, will retry — ${errMsg.substring(0, 100)}`);
            } else {
              await recordMetric(monitor.id, "browserless_retry", Date.now() - startTime, "error", undefined, false, errMsg);
            }
          }
        }

        if (lastBrowserlessErr) {
          const rawBrowserlessMsg = lastBrowserlessErr instanceof Error ? lastBrowserlessErr.message : "Unknown error";
          if (/SSRF blocked/i.test(rawBrowserlessMsg)) {
            // SSRF blocks are security-relevant — keep at error level
            await ErrorLogger.error(
              "scraper",
              `"${monitor.name}" — rendered page extraction blocked by SSRF protection`,
              lastBrowserlessErr instanceof Error ? lastBrowserlessErr : null,
              { monitorId: monitor.id, monitorName: monitor.name, url: monitor.url, selector: monitor.selector },
            ).catch(() => {});
          } else {
            // Downgrade to warning: Browserless failures are expected for sites that
            // block headless browsers. The circuit breaker and retry logic handle recovery.
            const classified = classifyBrowserlessError(rawBrowserlessMsg);
            await ErrorLogger.warning("scraper", `"${monitor.name}" — rendered page extraction failed: ${classified}`, { monitorId: monitor.id, monitorName: monitor.name, url: monitor.url, selector: monitor.selector });
          }
        }

        const durationMs = Date.now() - startTime;
        await BrowserlessUsageTracker.recordUsage(monitor.userId, monitor.id, durationMs, browserlessSuccess).catch(() => {});
      } else {
        console.log(`Browserless skipped for monitor ${monitor.id}: ${capCheck.reason}`);
      }
    }

    const oldValue = monitor.currentValue;
    
    let finalStatus: "ok" | "blocked" | "selector_missing" | "error" = "ok";
    let finalError: string | null = null;

    if (!newValue) {
      if (browserlessInfraFailure && monitor.currentValue) {
        // Graceful degradation: preserve last known good state when Browserless
        // is temporarily down. The monitor stays "healthy" with its cached value
        // and gets retried sooner via the accelerated retry set.
        monitorsNeedingRetry.add(monitor.id);
        await storage.updateMonitor(monitor.id, { lastChecked: new Date() });
        console.log(`[SelfHeal] Monitor ${monitor.id}: Browserless unavailable, preserving last known value`);
        await ErrorLogger.info(
          "scraper",
          `"${monitor.name}" — Browserless temporarily unavailable, preserving last known value. Will retry shortly.`,
          { monitorId: monitor.id, monitorName: monitor.name, circuitState: browserlessCircuitBreaker.getState() }
        );
        return {
          changed: false,
          currentValue: monitor.currentValue,
          previousValue: monitor.currentValue,
          status: (monitor.lastStatus as "ok" | "blocked" | "selector_missing" | "error") || "ok",
          error: null
        };
      } else if (browserlessInfraFailure) {
        // First check (no previous value) — fall through to underlying status
        // but note that Browserless was a factor
        monitorsNeedingRetry.add(monitor.id);
        if (block.blocked) {
          finalStatus = "blocked";
          finalError = block.reason || "Blocked";
        } else if (staticFetchError) {
          finalStatus = "error";
          finalError = staticFetchError;
        } else {
          finalStatus = "selector_missing";
          finalError = "Selector not found (rendering service temporarily unavailable)";
        }
      } else if (block.blocked) {
        finalStatus = "blocked";
        finalError = block.reason || "Blocked";
      } else if (staticFetchError) {
        finalStatus = "error";
        finalError = staticFetchError;
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
              .sort((a, b) => (a.count === 1 ? 0 : 1) - (b.count === 1 ? 0 : 1) || a.selector.length - b.selector.length || a.selector.localeCompare(b.selector))[0];

            console.log(`[AutoHeal] Monitor ${monitor.id}: found replacement selector "${best.selector}" (matches=${best.count}, sample="${best.sampleText}")`);
            await recordMetric(monitor.id, "auto_heal", healDuration, "ok", best.count);

            // Update the monitor with the new selector and re-extract the full (untruncated) value
            await storage.updateMonitor(monitor.id, { selector: best.selector });
            // Re-extract from the already-fetched HTML to get the full text,
            // since best.sampleText is truncated to 80 chars by discoverSelectors
            const healedValue = extractValueFromHtml(html, best.selector);
            newValue = healedValue ?? (normalizeValue(best.sampleText) || null);
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

    // Clear accelerated retry when the check ran without Browserless infra failure,
    // regardless of outcome. This prevents permanent 5-minute polling after outage clears.
    if (!browserlessInfraFailure) {
      monitorsNeedingRetry.delete(monitor.id);
    }

    if (finalStatus === "ok") {
      const changed = newValue !== oldValue;

      // --- Critical DB write: updateMonitor (with single retry) ---
      // This is the only operation that retries. Post-save operations
      // (health tracking, change recording, notifications) each have their
      // own try/catch so a failure in one doesn't cascade to the retry path.
      let saveFailed = false;
      try {
        await storage.updateMonitor(monitor.id, {
          lastChecked: new Date(),
          currentValue: newValue,
          lastStatus: finalStatus,
          lastError: null,
          consecutiveFailures: 0,
          pendingRetryAt: null,
        });
      } catch (dbError) {
        // Retry once after a short delay for transient DB errors.
        try {
          await new Promise(r => setTimeout(r, 1000));
          await storage.updateMonitor(monitor.id, {
            lastChecked: new Date(),
            currentValue: newValue,
            lastStatus: finalStatus,
            lastError: null,
            consecutiveFailures: 0,
            pendingRetryAt: null,
          });
        } catch (retryError) {
          // Both attempts failed. Transient DB errors (connection drops) are
          // expected and will self-heal via accelerated retry — log as warning.
          // Non-transient errors (schema/constraint) indicate a real problem — log as error.
          const dbErrMsg = dbError instanceof Error ? dbError.message : String(dbError);
          const retryErrMsg = retryError instanceof Error ? retryError.message : String(retryError);
          const isTransientSave = isTransientDbError(retryError);
          const saveContext = {
            monitorId: monitor.id,
            monitorName: monitor.name,
            extractedValue: newValue?.substring(0, 200) ?? null,
            previousValue: oldValue?.substring(0, 200) ?? null,
            changed,
            dbError: dbErrMsg,
            retryError: retryErrMsg,
          };
          if (isTransientSave) {
            await ErrorLogger.warning(
              "scraper",
              `"${monitor.name}" check succeeded but failed to save result (will retry)`,
              saveContext,
            ).catch(() => {});
          } else {
            await ErrorLogger.error(
              "scraper",
              `"${monitor.name}" check succeeded but failed to save result`,
              retryError instanceof Error ? retryError : null,
              saveContext,
            ).catch(() => {});
          }

          saveFailed = true;
        }
      }

      if (saveFailed) {
        // Mark for accelerated retry so the scheduler rechecks sooner than the
        // normal hourly/daily interval (uses the same backoff as Browserless failures).
        monitorsNeedingRetry.add(monitor.id);
        return {
          changed,
          currentValue: newValue,
          previousValue: oldValue,
          status: "ok" as const,
          error: "Check succeeded but a server error prevented saving the result. Marked for accelerated retry."
        };
      }

      // --- Post-save operations (each isolated, no retry cascade) ---

      // Update lastHealthyAt on every successful check
      try {
        await storage.updateLastHealthyAt(monitor.id);
      } catch (healthErr) {
        console.error(`[Scraper] Failed to update lastHealthyAt for monitor ${monitor.id}:`, healthErr);
      }

      // Send recovery email if we previously sent a health warning.
      // NOTE: Health/recovery emails are sent directly (not via the
      // processChangeNotification → notification queue → delivery log pipeline)
      // because they are operational alerts, not content-change notifications.
      // This means they won't appear in delivery_log, don't respect quiet
      // hours/digest mode, and are email-only (no webhook/Slack).
      // Re-check healthAlertSentAt from DB to avoid duplicate recovery emails
      // if two concurrent checks both see a stale in-memory value.
      if (monitor.healthAlertSentAt !== null) {
        try {
          const freshMonitor = await storage.getMonitor(monitor.id);
          if (freshMonitor?.healthAlertSentAt !== null) {
            // Send first, then clear — if the email fails the flag stays set
            // so the next successful check retries the recovery notification.
            await sendRecoveryEmail(monitor, newValue ?? "");
            await storage.clearHealthAlert(monitor.id);
          }
        } catch (recoveryErr) {
          console.error(`[Scraper] Recovery email failed for monitor ${monitor.id}:`, recoveryErr);
        }
      }

      if (changed) {
        try {
          const change = await storage.addMonitorChange(monitor.id, oldValue, newValue);
          await storage.updateMonitor(monitor.id, { lastChanged: new Date() });
          const changeCount = await storage.countMonitorChanges(monitor.id);
          const isFirstChange = changeCount <= 1;
          try {
            await processChangeNotification(monitor, change, isFirstChange);
          } catch (notificationError) {
            console.error(`[Scraper] Notification failed for monitor ${monitor.id}, change still recorded:`, notificationError);
          }
        } catch (changeErr) {
          console.error(`[Scraper] Failed to record change for monitor ${monitor.id}:`, changeErr);
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
      let wasPaused = false;
      try {
        const result = await handleMonitorFailure(monitor, finalStatus, finalError!, browserlessInfraFailure);
        wasPaused = result.paused;
      } catch (failureErr) {
        console.error(`[Scraper] handleMonitorFailure threw for monitor ${monitor.id}:`, failureErr);
      }

      // Self-heal: schedule a single auto-retry for transient errors
      if (finalStatus === "error") {
        await maybeScheduleAutoRetry(monitor, finalError ?? "", wasPaused);
      }

      return {
        changed: false,
        currentValue: oldValue,
        previousValue: oldValue,
        status: finalStatus,
        error: finalError
      };
    }
  } catch (error) {
    const { userMessage, logContext } = classifyOuterError(error);

    // Transient network/connection errors are expected and retried automatically —
    // log as warnings to avoid polluting the error log with recoverable conditions.
    // Note: "database error" (schema/constraint issues) is NOT transient and stays at error level.
    // Note: ENOTFOUND, certificate/ssl/tls errors are permanent misconfigurations, not transient.
    // Note: EAI_AGAIN is transient (temporary DNS resolver failure), so it is NOT in this list.
    const errMsg = error instanceof Error ? error.message : "";
    const isPermanentNetworkError = /ENOTFOUND|certificate|ssl|tls/i.test(errMsg);
    const isTransient = (logContext === "network error" && !isPermanentNetworkError) || logContext === "database connection error";
    const logMessage = `"${monitor.name}" check failed (${logContext}): ${error instanceof Error ? error.message : "Unknown error"}`;
    if (isTransient) {
      await ErrorLogger.warning("scraper", logMessage, { monitorId: monitor.id, monitorName: monitor.name, url: monitor.url, selector: monitor.selector }).catch(() => {});
    } else {
      await ErrorLogger.error(
        "scraper",
        logMessage,
        error instanceof Error ? error : null,
        { monitorId: monitor.id, monitorName: monitor.name, url: monitor.url, selector: monitor.selector }
      ).catch(() => {});
    }

    let wasPaused = false;
    try {
      const result = await handleMonitorFailure(monitor, "error", userMessage, false);
      wasPaused = result.paused;
    } catch (failureErr) {
      console.error(`[Scraper] handleMonitorFailure threw in outer catch for monitor ${monitor.id}:`, failureErr);
    }

    // Self-heal: schedule a single auto-retry for transient errors
    await maybeScheduleAutoRetry(monitor, userMessage, wasPaused);

    return {
      changed: false,
      currentValue: monitor.currentValue,
      previousValue: monitor.currentValue,
      status: "error" as const,
      error: userMessage
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
  return withBrowserlessPage(url, async (page, consentClicked) => {
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
  });
}
