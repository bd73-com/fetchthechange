import { createHmac, randomBytes } from "node:crypto";
import { isPrivateUrl } from "../utils/ssrf";
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

export interface WebhookPayload {
  event: "change.detected";
  monitorId: number;
  monitorName: string;
  url: string;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
  timestamp: string;
}

export function buildWebhookPayload(monitor: Monitor, change: MonitorChange): WebhookPayload {
  return {
    event: "change.detected",
    monitorId: monitor.id,
    monitorName: monitor.name,
    url: monitor.url,
    oldValue: change.oldValue,
    newValue: change.newValue,
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

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-FTC-Signature-256": signature,
    "User-Agent": "FetchTheChange-Webhook/1.0",
    ...(config.headers || {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      redirect: "manual",
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
