import { createHmac, randomBytes } from "node:crypto";
import { isPrivateUrl, ssrfSafeFetch } from "../utils/ssrf";
import type { Monitor, MonitorChange } from "@shared/schema";

export interface WebhookConfig {
  url: string;
  secret: string;
  headers?: Record<string, string>;
}

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

/** Maximum length for oldValue/newValue in webhook payloads (100KB). */
const MAX_VALUE_LENGTH = 100_000;

export interface WebhookPayload {
  event: "change.detected";
  monitorId: number;
  monitorName: string;
  url: string;
  oldValue: string | null;
  newValue: string | null;
  oldValueTruncated?: boolean;
  newValueTruncated?: boolean;
  detectedAt: string;
  timestamp: string;
}

function truncateValue(value: string | null): { value: string | null; truncated: boolean } {
  if (value === null || value.length <= MAX_VALUE_LENGTH) return { value, truncated: false };
  let end = MAX_VALUE_LENGTH;
  // Avoid splitting a UTF-16 surrogate pair at the boundary
  const code = value.charCodeAt(end - 1);
  if (code >= 0xD800 && code <= 0xDBFF) end--;
  return { value: value.slice(0, end), truncated: true };
}

export function buildWebhookPayload(monitor: Monitor, change: MonitorChange): WebhookPayload {
  const old = truncateValue(change.oldValue);
  const cur = truncateValue(change.newValue);
  return {
    event: "change.detected",
    monitorId: monitor.id,
    monitorName: monitor.name,
    url: monitor.url,
    oldValue: old.value,
    newValue: cur.value,
    ...(old.truncated && { oldValueTruncated: true }),
    ...(cur.truncated && { newValueTruncated: true }),
    detectedAt: change.detectedAt.toISOString(),
    timestamp: new Date().toISOString(),
  };
}

export function signPayload(payload: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return `sha256=${hmac.digest("hex")}`;
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

export function redactSecret(secret: string): string {
  return "whsec_****...****";
}

export async function deliver(
  monitor: Monitor,
  change: MonitorChange,
  config: WebhookConfig
): Promise<WebhookDeliveryResult> {
  // SSRF check before every delivery (DNS rebinding protection)
  const ssrfError = await isPrivateUrl(config.url);
  if (ssrfError) {
    return { success: false, error: `SSRF blocked: ${ssrfError}` };
  }

  const payload = buildWebhookPayload(monitor, change);
  const body = JSON.stringify(payload);
  const signature = signPayload(body, config.secret);

  // Spread custom headers first so they cannot override security headers
  const headers: Record<string, string> = {
    ...(config.headers || {}),
    "Content-Type": "application/json",
    "X-FTC-Signature-256": signature,
    "User-Agent": "FetchTheChange-Webhook/1.0",
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    // Use ssrfSafeFetch to close the TOCTOU / DNS-rebinding gap
    const response = await ssrfSafeFetch(config.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    const urlDomain = new URL(config.url).hostname;
    if (response.ok) {
      console.log(`[Webhook] Delivered successfully (monitorId=${monitor.id}, domain=${urlDomain}, status=${response.status})`);
    }

    return {
      success: response.ok,
      statusCode: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes("abort");
    const urlDomain = new URL(config.url).hostname;
    console.warn(`[Webhook] Delivery failed (monitorId=${monitor.id}, domain=${urlDomain}, error=${isTimeout ? "timeout" : message})`);
    return {
      success: false,
      error: isTimeout ? "Request timed out (5s)" : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}
