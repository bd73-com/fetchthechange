import { Resend } from "resend";
import { type Monitor } from "@shared/schema";
import { authStorage } from "../replit_integrations/auth/storage";
import { type UserTier } from "@shared/models/auth";
import { ErrorLogger } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

export interface EmailResult {
  success: boolean;
  id?: string;
  error?: string;
  to?: string;
  from?: string;
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

  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set. Skipping email.");
    console.log(`[MOCK EMAIL] To: User of Monitor ${monitor.id}`);
    console.log(`[MOCK EMAIL] Subject: Change detected on ${monitor.name}`);
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

    // Use custom notification email if set, otherwise fall back to account email
    const recipientEmail = user.notificationEmail || user.email;
    console.log(`[Email] Sending to ${recipientEmail} (custom: ${!!user.notificationEmail})`);

    const response = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      subject: `Change detected: ${monitor.name}`,
      text: `
        Hello,

        A change was detected on your monitored page: ${monitor.name}
        URL: ${monitor.url}

        Old Value: ${oldValue}
        New Value: ${newValue}

        Check your dashboard for more details.
      `,
      html: `
        <h2>Change Detected</h2>
        <p><strong>Monitor:</strong> ${monitor.name}</p>
        <p><strong>URL:</strong> <a href="${monitor.url}">${monitor.url}</a></p>
        <hr/>
        <p><strong>Old Value:</strong></p>
        <pre>${oldValue}</pre>
        <p><strong>New Value:</strong></p>
        <pre>${newValue}</pre>
        <hr/>
        <p><a href="https://fetch-the-change.replit.app">View Dashboard</a></p>
      `
    });
    
    console.log(`[Email] Resend response:`, JSON.stringify(response));
    
    if (response.error) {
      console.error(`[Email] Resend error:`, response.error);
      return { success: false, error: response.error.message, to: recipientEmail, from: fromAddress };
    }
    
    console.log(`[Email] Sent to ${recipientEmail} for monitor ${monitor.id}, id: ${response.data?.id}`);
    await ErrorLogger.info("email", `Email sent for monitor ${monitor.id}`, { monitorId: monitor.id, to: recipientEmail, emailId: response.data?.id });
    return { success: true, id: response.data?.id, to: recipientEmail, from: fromAddress };
  } catch (error: any) {
    await ErrorLogger.error("email", `Failed to send email for monitor ${monitor.id}`, error instanceof Error ? error : null, { monitorId: monitor.id });
    return { success: false, error: error.message };
  }
}
