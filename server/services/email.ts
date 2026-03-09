import { Resend } from "resend";
import { format } from "date-fns";
import { type Monitor, type MonitorChange } from "@shared/schema";
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

interface EmailInfra {
  resend: InstanceType<typeof Resend>;
  fromAddress: string;
}

/**
 * Shared preamble for all email-sending functions.
 * Checks the global Resend usage cap and ensures an API key is configured.
 * Returns either the Resend client + from address, or an early-exit EmailResult.
 */
async function prepareEmailInfra(
  monitorId: number,
  mockLabel: string,
): Promise<EmailInfra | EmailResult> {
  const resendCapCheck = await ResendUsageTracker.canSendEmail();
  if (!resendCapCheck.allowed) {
    console.log(`[Email] Resend cap reached for ${mockLabel}, monitor ${monitorId}: ${resendCapCheck.reason}`);
    return { success: false, error: resendCapCheck.reason || "Resend usage cap reached" };
  }

  if (!process.env.RESEND_API_KEY) {
    console.log(`[MOCK EMAIL] ${mockLabel} for monitor ${monitorId}`);
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  return {
    resend: new Resend(process.env.RESEND_API_KEY),
    fromAddress: process.env.RESEND_FROM || "onboarding@resend.dev",
  };
}

function isEmailResult(v: EmailInfra | EmailResult): v is EmailResult {
  return "success" in v;
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

export async function sendNotificationEmail(monitor: Monitor, oldValue: string | null, newValue: string | null, emailOverride?: string): Promise<EmailResult> {
  const emailCheck = await canSendEmail(monitor);
  if (!emailCheck.allowed) {
    console.log(`[Email] Rate limited for monitor ${monitor.id}: ${emailCheck.reason}`);
    return { success: false, error: emailCheck.reason || "Email rate limit exceeded" };
  }

  const infra = await prepareEmailInfra(monitor.id, "notification");
  if (isEmailResult(infra)) return infra;
  const { resend, fromAddress } = infra;

  try {
    const user = await authStorage.getUser(monitor.userId);
    if (!user || !user.email) {
      console.log(`User ${monitor.userId} has no email. Skipping.`);
      return { success: false, error: "User has no email address" };
    }

    const recipientEmail = emailOverride || user.notificationEmail || user.email;
    console.log(`[Email] Sending to ${recipientEmail} (override: ${!!emailOverride}, custom: ${!!user.notificationEmail})`);

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
  const infra = await prepareEmailInfra(monitor.id, "auto-pause");
  if (isEmailResult(infra)) return infra;
  const { resend, fromAddress } = infra;

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

export async function sendHealthWarningEmail(
  monitor: Monitor,
  consecutiveFailures: number,
  nextPauseIn: number,
  lastError: string
): Promise<EmailResult> {
  const user = await authStorage.getUser(monitor.userId);
  if (!user) {
    return { success: false, error: "User not found" };
  }

  const tier = (user.tier || "free") as UserTier;
  if (tier !== "power") {
    console.debug(`[Email] Health warning skipped (non-Power tier) for monitor ${monitor.id}`);
    return { success: false, error: "Health warning emails are Power-tier only" };
  }

  const infra = await prepareEmailInfra(monitor.id, "health warning");
  if (isEmailResult(infra)) return infra;
  const { resend, fromAddress } = infra;

  // Compute "last healthy" display string
  let lastHealthyDisplay = "never";
  if (monitor.lastHealthyAt) {
    const hoursAgo = Math.max(1, Math.round((Date.now() - new Date(monitor.lastHealthyAt).getTime()) / 3600000));
    if (hoursAgo < 24) {
      lastHealthyDisplay = `${hoursAgo} hour${hoursAgo === 1 ? "" : "s"} ago`;
    } else {
      const daysAgo = Math.round(hoursAgo / 24);
      lastHealthyDisplay = `${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`;
    }
  }

  try {
    const recipientEmail = user.notificationEmail || user.email;
    if (!recipientEmail) {
      return { success: false, error: "User has no email address" };
    }

    const dashboardUrl = "https://fetch-the-change.replit.app";

    const response = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      subject: `⚠️ Monitor struggling: ${sanitizePlainText(monitor.name)}`,
      text: `Hello,

Your monitor "${sanitizePlainText(monitor.name)}" is struggling.

URL: ${sanitizePlainText(monitor.url)}
Consecutive failures: ${consecutiveFailures}
Current error: ${sanitizePlainText(lastError)}
Failures until auto-pause: ${nextPauseIn}
Last successful check: ${lastHealthyDisplay}

Visit your dashboard to investigate: ${dashboardUrl}/monitors/${monitor.id}

FetchTheChange will keep retrying automatically.

FetchTheChange Team`,
      html: `
        <h2>Monitor Struggling</h2>
        <p>Your monitor <strong>${escapeHtml(monitor.name)}</strong> has failed <strong>${consecutiveFailures}</strong> consecutive time${consecutiveFailures === 1 ? "" : "s"}.</p>
        <p><strong>URL:</strong> <a href="${safeHref(monitor.url)}">${escapeHtml(monitor.url)}</a></p>
        <p><strong>Current error:</strong> ${escapeHtml(lastError)}</p>
        <p><strong>Failures until auto-pause:</strong> ${nextPauseIn}</p>
        <p><strong>Last successful check:</strong> ${escapeHtml(lastHealthyDisplay)}</p>
        <hr/>
        <p><a href="${safeHref(dashboardUrl + "/monitors/" + monitor.id)}">View Monitor Dashboard</a></p>
        <br/>
        <p>FetchTheChange will keep retrying automatically.</p>
        <p>FetchTheChange Team</p>
      `
    });

    if (response.error) {
      await ResendUsageTracker.recordUsage(monitor.userId, monitor.id, recipientEmail, undefined, false).catch(() => {});
      await ErrorLogger.warning("email", `Health warning email failed to send for monitor ${monitor.id}`, { monitorId: monitor.id, error: response.error.message });
      return { success: false, error: response.error.message, to: recipientEmail, from: fromAddress };
    }

    await ResendUsageTracker.recordUsage(monitor.userId, monitor.id, recipientEmail, response.data?.id, true).catch(() => {});
    await ErrorLogger.info("email", `Health warning email sent`, { monitorId: monitor.id, monitorName: monitor.name, consecutiveFailures, tier });
    return { success: true, id: response.data?.id, to: recipientEmail, from: fromAddress };
  } catch (error: any) {
    await ErrorLogger.warning("email", `Health warning email failed to send for monitor ${monitor.id}`, { monitorId: monitor.id, error: error.message });
    return { success: false, error: error.message };
  }
}

export async function sendRecoveryEmail(
  monitor: Monitor,
  recoveredValue: string
): Promise<EmailResult> {
  // Truncate for email display (full value is stored in DB)
  const displayValue = recoveredValue.length > 500
    ? recoveredValue.slice(0, 500) + "\u2026"
    : recoveredValue;

  const user = await authStorage.getUser(monitor.userId);
  if (!user) {
    return { success: false, error: "User not found" };
  }

  const tier = (user.tier || "free") as UserTier;
  if (tier !== "power") {
    console.debug(`[Email] Recovery email skipped (non-Power tier) for monitor ${monitor.id}`);
    return { success: false, error: "Recovery emails are Power-tier only" };
  }

  const infra = await prepareEmailInfra(monitor.id, "recovery");
  if (isEmailResult(infra)) return infra;
  const { resend, fromAddress } = infra;

  // Compute "was degraded for" display string
  let degradedDisplay = "";
  let degradedForMs = 0;
  if (monitor.healthAlertSentAt) {
    degradedForMs = Date.now() - new Date(monitor.healthAlertSentAt).getTime();
    const hours = Math.max(1, Math.round(degradedForMs / 3600000));
    if (hours >= 48) {
      const days = Math.round(hours / 24);
      degradedDisplay = `${days} day${days === 1 ? "" : "s"}`;
    } else {
      degradedDisplay = `${hours} hour${hours === 1 ? "" : "s"}`;
    }
  }

  try {
    const recipientEmail = user.notificationEmail || user.email;
    if (!recipientEmail) {
      return { success: false, error: "User has no email address" };
    }

    const dashboardUrl = "https://fetch-the-change.replit.app";

    const response = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      subject: `✅ Monitor recovered: ${sanitizePlainText(monitor.name)}`,
      text: `Hello,

Your monitor "${sanitizePlainText(monitor.name)}" has recovered and is healthy again.

URL: ${sanitizePlainText(monitor.url)}
Current value: ${sanitizePlainText(displayValue)}${degradedDisplay ? `\nWas degraded for: ${degradedDisplay}` : ""}

Visit your dashboard: ${dashboardUrl}/monitors/${monitor.id}

FetchTheChange Team`,
      html: `
        <h2>Monitor Recovered</h2>
        <p>Your monitor <strong>${escapeHtml(monitor.name)}</strong> has recovered and is healthy again.</p>
        <p><strong>URL:</strong> <a href="${safeHref(monitor.url)}">${escapeHtml(monitor.url)}</a></p>
        <p><strong>Current value:</strong></p>
        <pre>${escapeHtml(displayValue)}</pre>${degradedDisplay ? `
        <p><strong>Was degraded for:</strong> ${escapeHtml(degradedDisplay)}</p>` : ""}
        <hr/>
        <p><a href="${safeHref(dashboardUrl + "/monitors/" + monitor.id)}">View Monitor Dashboard</a></p>
        <br/>
        <p>FetchTheChange Team</p>
      `
    });

    if (response.error) {
      await ResendUsageTracker.recordUsage(monitor.userId, monitor.id, recipientEmail, undefined, false).catch(() => {});
      await ErrorLogger.warning("email", `Recovery email failed to send for monitor ${monitor.id}`, { monitorId: monitor.id, error: response.error.message });
      return { success: false, error: response.error.message, to: recipientEmail, from: fromAddress };
    }

    await ResendUsageTracker.recordUsage(monitor.userId, monitor.id, recipientEmail, response.data?.id, true).catch(() => {});
    await ErrorLogger.info("email", `Recovery email sent`, { monitorId: monitor.id, monitorName: monitor.name, recoveredValue: displayValue, degradedForMs });
    return { success: true, id: response.data?.id, to: recipientEmail, from: fromAddress };
  } catch (error: any) {
    await ErrorLogger.warning("email", `Recovery email failed to send for monitor ${monitor.id}`, { monitorId: monitor.id, error: error.message });
    return { success: false, error: error.message };
  }
}

export async function sendDigestEmail(monitor: Monitor, changes: MonitorChange[], emailOverride?: string): Promise<EmailResult> {
  if (changes.length === 0) {
    return { success: false, error: "No changes to include in digest" };
  }

  const emailCheck = await canSendEmail(monitor);
  if (!emailCheck.allowed) {
    console.log(`[Email] Rate limited for digest, monitor ${monitor.id}: ${emailCheck.reason}`);
    return { success: false, error: emailCheck.reason || "Email rate limit exceeded" };
  }

  const infra = await prepareEmailInfra(monitor.id, "digest");
  if (isEmailResult(infra)) return infra;
  const { resend, fromAddress } = infra;

  try {
    const user = await authStorage.getUser(monitor.userId);
    if (!user || !user.email) {
      return { success: false, error: "User has no email address" };
    }

    const recipientEmail = emailOverride || user.notificationEmail || user.email;

    const changesTextList = changes.map((c, i) => {
      const dateStr = format(new Date(c.detectedAt), "MMM d, yyyy HHmm");
      return `  ${i + 1}. [${dateStr}]\n     Old: ${sanitizePlainText(c.oldValue)}\n     New: ${sanitizePlainText(c.newValue)}`;
    }).join("\n\n");

    const changesHtmlList = changes.map((c) => {
      const dateStr = format(new Date(c.detectedAt), "MMM d, yyyy HHmm");
      return `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(dateStr)}</td>
          <td style="padding: 8px; border: 1px solid #ddd;"><pre style="margin:0;white-space:pre-wrap;">${escapeHtml(c.oldValue)}</pre></td>
          <td style="padding: 8px; border: 1px solid #ddd;"><pre style="margin:0;white-space:pre-wrap;">${escapeHtml(c.newValue)}</pre></td>
        </tr>`;
    }).join("");

    const response = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      subject: `FetchTheChange Digest: ${sanitizePlainText(monitor.name)} (${changes.length} change${changes.length === 1 ? "" : "s"})`,
      text: `Hello,

Here is your daily digest for "${sanitizePlainText(monitor.name)}".
URL: ${sanitizePlainText(monitor.url)}

${changes.length} change${changes.length === 1 ? " was" : "s were"} detected:

${changesTextList}

Check your dashboard for more details.

FetchTheChange Team`,
      html: `
        <h2>Daily Digest: ${escapeHtml(monitor.name)}</h2>
        <p><strong>URL:</strong> <a href="${safeHref(monitor.url)}">${escapeHtml(monitor.url)}</a></p>
        <p>${changes.length} change${changes.length === 1 ? " was" : "s were"} detected:</p>
        <table style="border-collapse: collapse; width: 100%;">
          <thead>
            <tr>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Time</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Old Value</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">New Value</th>
            </tr>
          </thead>
          <tbody>${changesHtmlList}</tbody>
        </table>
        <hr/>
        <p><a href="https://fetch-the-change.replit.app">View Dashboard</a></p>
        <br/>
        <p>FetchTheChange Team</p>
      `
    });

    if (response.error) {
      await ResendUsageTracker.recordUsage(monitor.userId, monitor.id, recipientEmail, undefined, false).catch(() => {});
      return { success: false, error: response.error.message, to: recipientEmail, from: fromAddress };
    }

    await ResendUsageTracker.recordUsage(monitor.userId, monitor.id, recipientEmail, response.data?.id, true).catch(() => {});
    console.log(`[Email] Sent digest to ${recipientEmail} for monitor ${monitor.id} (${changes.length} changes), id: ${response.data?.id}`);
    return { success: true, id: response.data?.id, to: recipientEmail, from: fromAddress };
  } catch (error: any) {
    await ErrorLogger.error("email", `"${monitor.name}" — digest email failed to send.`, error instanceof Error ? error : null, { monitorId: monitor.id, monitorName: monitor.name });
    return { success: false, error: error.message };
  }
}
