import { Resend } from "resend";
import { type Monitor } from "@shared/schema";
import { authStorage } from "../replit_integrations/auth/storage";
import { type UserTier } from "@shared/models/auth";
import { ErrorLogger } from "./logger";
import { ResendUsageTracker } from "./resendTracker";
import { db } from "../db";
import { sql } from "drizzle-orm";

export interface EmailResult {
  success: boolean;
  id?: string;
  error?: string;
  to?: string;
  from?: string;
}

/** Escape HTML special characters to prevent XSS in email templates. */
function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sanitize text for plain-text email body to prevent header injection. */
function sanitizePlainText(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(/[\r\n]+/g, ' ').trim();
}

/** Sanitize a URL for use in an href attribute. Only allows http/https schemes. */
function safeHref(url: string | null | undefined): string {
  if (!url) return '';
  const escaped = escapeHtml(url);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
  } catch {
    return '';
  }
  return escaped;
}

async function canSendEmail(monitor: Monitor): Promise<{ allowed: boolean; reason?: string }> {
  const user = await authStorage.getUser(monitor.userId);
  const tier = (user?.tier || "free") as UserTier;

  if (tier !== "free") {
    return { allowed: true };
  }

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const recentChanges = await db.execute(sql`
    SELECT COUNT(*) as count 
    FROM monitor_changes 
    WHERE monitor_id = ${monitor.id} 
    AND detected_at > ${twentyFourHoursAgo}
  `);

  const count = Number(recentChanges.rows[0]?.count ?? 0);

  if (count >= 1) {
    return {
      allowed: false,
      reason: "Free tier: max 1 email per 24 hours per monitor. Upgrade to Pro for unlimited notifications."
    };
  }

  return { allowed: true };
}

export async function sendNotificationEmail(monitor: Monitor, oldValue: string | null, newValue: string | null): Promise<EmailResult> {
  const emailCheck = await canSendEmail(monitor);
  if (!emailCheck.allowed) {
    console.log(`[Email] Rate limited for monitor ${monitor.id}: ${emailCheck.reason}`);
    return { success: false, error: emailCheck.reason || "Email rate limit exceeded" };
  }

  const resendCapCheck = await ResendUsageTracker.canSendEmail();
  if (!resendCapCheck.allowed) {
    console.log(`[Email] Resend cap reached for monitor ${monitor.id}: ${resendCapCheck.reason}`);
    return { success: false, error: resendCapCheck.reason || "Resend usage cap reached" };
  }

  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set. Skipping email.");
    console.log(`[MOCK EMAIL] To: User of Monitor ${monitor.id}`);
    console.log(`[MOCK EMAIL] Subject: FetchTheChange: ${monitor.name}`);
    console.log(`[MOCK EMAIL] Body: Value changed from "${oldValue}" to "${newValue}"`);
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromAddress = process.env.RESEND_FROM || 'onboarding@resend.dev';

  try {
    const user = await authStorage.getUser(monitor.userId);
    if (!user || !user.email) {
      console.log(`User ${monitor.userId} has no email. Skipping.`);
      return { success: false, error: "User has no email address" };
    }

    const recipientEmail = user.notificationEmail || user.email;
    console.log(`[Email] Sending to ${recipientEmail} (custom: ${!!user.notificationEmail})`);

    const response = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      subject: `FetchTheChange: ${sanitizePlainText(monitor.name)}`,
      text: `
        Hello,

        A change was detected on your monitored page: ${sanitizePlainText(monitor.name)}
        URL: ${sanitizePlainText(monitor.url)}

        New Value: ${sanitizePlainText(newValue)}
        Old Value: ${sanitizePlainText(oldValue)}

        Check your dashboard for more details.

        We hope you enjoy our service!
        FetchTheChange Team
      `,
      html: `
        <h2>Change Detected</h2>
        <p><strong>Monitor:</strong> ${escapeHtml(monitor.name)}</p>
        <p><strong>URL:</strong> <a href="${safeHref(monitor.url)}">${escapeHtml(monitor.url)}</a></p>
        <hr/>
        <p><strong>New Value:</strong></p>
        <pre>${escapeHtml(newValue)}</pre>
        <p><strong>Old Value:</strong></p>
        <pre>${escapeHtml(oldValue)}</pre>
        <hr/>
        <p><a href="https://fetch-the-change.replit.app">View Dashboard</a></p>
        <br/>
        <p>We hope you enjoy our service!<br/>FetchTheChange Team</p>
      `
    });
    
    console.log(`[Email] Resend response:`, JSON.stringify(response));
    
    if (response.error) {
      console.error(`[Email] Resend error:`, response.error);
      await ResendUsageTracker.recordUsage(monitor.userId, monitor.id, recipientEmail, undefined, false).catch(() => {});
      return { success: false, error: response.error.message, to: recipientEmail, from: fromAddress };
    }
    
    await ResendUsageTracker.recordUsage(monitor.userId, monitor.id, recipientEmail, response.data?.id, true).catch(() => {});
    console.log(`[Email] Sent to ${recipientEmail} for monitor ${monitor.id}, id: ${response.data?.id}`);
    return { success: true, id: response.data?.id, to: recipientEmail, from: fromAddress };
  } catch (error: any) {
    await ErrorLogger.error("email", `"${monitor.name}" — notification email failed to send. Check that your email address is valid. If this keeps happening, contact support.`, error instanceof Error ? error : null, { monitorId: monitor.id, monitorName: monitor.name, url: monitor.url });
    return { success: false, error: error.message };
  }
}

export async function sendAutoPauseEmail(monitor: Monitor, failureCount: number, lastError: string | null): Promise<EmailResult> {
  const resendCapCheck = await ResendUsageTracker.canSendEmail();
  if (!resendCapCheck.allowed) {
    console.log(`[Email] Resend cap reached for auto-pause email, monitor ${monitor.id}: ${resendCapCheck.reason}`);
    return { success: false, error: resendCapCheck.reason || "Resend usage cap reached" };
  }

  if (!process.env.RESEND_API_KEY) {
    console.log(`[MOCK EMAIL] Auto-pause notification for monitor ${monitor.id} "${monitor.name}" after ${failureCount} failures`);
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromAddress = process.env.RESEND_FROM || 'onboarding@resend.dev';

  try {
    const user = await authStorage.getUser(monitor.userId);
    if (!user || !user.email) {
      return { success: false, error: "User has no email address" };
    }

    const recipientEmail = user.notificationEmail || user.email;

    const response = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      subject: `FetchTheChange: "${sanitizePlainText(monitor.name)}" has been paused`,
      text: `Hello,

Your monitor "${sanitizePlainText(monitor.name)}" has been automatically paused after ${failureCount} consecutive failures.

URL: ${sanitizePlainText(monitor.url)}
Last error: ${sanitizePlainText(lastError)}

To resume monitoring, visit your dashboard and re-enable the monitor after verifying the URL and selector are correct.

FetchTheChange Team`,
      html: `
        <h2>Monitor Auto-Paused</h2>
        <p>Your monitor <strong>${escapeHtml(monitor.name)}</strong> has been automatically paused after <strong>${failureCount}</strong> consecutive failures.</p>
        <p><strong>URL:</strong> <a href="${safeHref(monitor.url)}">${escapeHtml(monitor.url)}</a></p>
        <p><strong>Last error:</strong> ${escapeHtml(lastError)}</p>
        <hr/>
        <p>To resume monitoring, visit your <a href="https://fetch-the-change.replit.app">dashboard</a> and re-enable the monitor after verifying the URL and selector are correct.</p>
        <br/>
        <p>FetchTheChange Team</p>
      `
    });

    if (response.error) {
      await ResendUsageTracker.recordUsage(monitor.userId, monitor.id, recipientEmail, undefined, false).catch(() => {});
      return { success: false, error: response.error.message, to: recipientEmail, from: fromAddress };
    }

    await ResendUsageTracker.recordUsage(monitor.userId, monitor.id, recipientEmail, response.data?.id, true).catch(() => {});
    console.log(`[Email] Sent auto-pause notification to ${recipientEmail} for monitor ${monitor.id}`);
    return { success: true, id: response.data?.id, to: recipientEmail, from: fromAddress };
  } catch (error: any) {
    await ErrorLogger.error("email", `"${monitor.name}" — auto-pause email failed to send.`, error instanceof Error ? error : null, { monitorId: monitor.id, monitorName: monitor.name });
    return { success: false, error: error.message };
  }
}
