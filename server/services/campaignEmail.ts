import crypto from "crypto";
import { db } from "../db";
import { getResendClient } from "./resendClient";
import { users, campaigns, campaignRecipients, monitors } from "@shared/schema";
import { ResendUsageTracker } from "./resendTracker";
import { ErrorLogger } from "./logger";
import { eq, and, inArray, gte, lte, sql, count, SQL } from "drizzle-orm";
import { getAppUrl } from "../utils/appUrl";

export interface CampaignFilters {
  tier?: string[];
  signupBefore?: string;
  signupAfter?: string;
  minMonitors?: number;
  maxMonitors?: number;
  hasActiveMonitors?: boolean;
}

interface ResolvedRecipient {
  id: string;
  email: string;
  firstName: string | null;
  tier: string;
  monitorCount: number;
  unsubscribeToken: string;
}

/** Escape HTML special characters to prevent XSS in email templates. */
function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build a SQL query to resolve recipients matching the given filters,
 * excluding users who have unsubscribed from campaigns.
 */
export async function resolveRecipients(filters: CampaignFilters): Promise<ResolvedRecipient[]> {
  const conditions: ReturnType<typeof sql>[] = [];

  // Always exclude unsubscribed users
  conditions.push(sql`u.campaign_unsubscribed = false`);

  // Always require an email
  conditions.push(sql`u.email IS NOT NULL`);

  if (filters.tier && filters.tier.length > 0) {
    const placeholders = filters.tier.map((t) => sql`${t}`);
    conditions.push(sql`u.tier IN (${sql.join(placeholders, sql`, `)})`);
  }

  if (filters.signupAfter) {
    conditions.push(sql`u.created_at >= ${new Date(filters.signupAfter)}`);
  }

  if (filters.signupBefore) {
    conditions.push(sql`u.created_at <= ${new Date(filters.signupBefore)}`);
  }

  const havingConditions: ReturnType<typeof sql>[] = [];

  if (filters.minMonitors !== undefined && filters.minMonitors > 0) {
    havingConditions.push(sql`COUNT(m.id) >= ${filters.minMonitors}`);
  }

  if (filters.maxMonitors !== undefined) {
    havingConditions.push(sql`COUNT(m.id) <= ${filters.maxMonitors}`);
  }

  if (filters.hasActiveMonitors === true) {
    havingConditions.push(sql`COUNT(m.id) FILTER (WHERE m.active = true) > 0`);
  }

  const whereClause = conditions.length > 0
    ? sql.join(conditions, sql` AND `)
    : sql`true`;

  const havingClause = havingConditions.length > 0
    ? sql`HAVING ${sql.join(havingConditions, sql` AND `)}`
    : sql``;

  const result = await db.execute(sql`
    SELECT
      u.id,
      u.email,
      u.first_name as "firstName",
      u.tier,
      u.unsubscribe_token as "unsubscribeToken",
      COALESCE(u.notification_email, u.email) as "recipientEmail",
      COUNT(m.id)::int as "monitorCount"
    FROM users u
    LEFT JOIN monitors m ON m.user_id = u.id
    WHERE ${whereClause}
    GROUP BY u.id, u.email, u.first_name, u.tier, u.unsubscribe_token, u.notification_email
    ${havingClause}
    ORDER BY u.created_at DESC
  `);

  const recipients: ResolvedRecipient[] = [];

  for (const row of result.rows as any[]) {
    let token = row.unsubscribeToken;

    // Generate unsubscribe token if missing
    if (!token) {
      token = crypto.randomUUID();
      await db
        .update(users)
        .set({ unsubscribeToken: token })
        .where(eq(users.id, row.id));
    }

    recipients.push({
      id: row.id,
      email: row.recipientEmail || row.email,
      firstName: row.firstName,
      tier: row.tier,
      monitorCount: Number(row.monitorCount),
      unsubscribeToken: token,
    });
  }

  return recipients;
}

/**
 * Preview recipients matching the given filters.
 * Returns total count and first 50 users.
 */
export async function previewRecipients(
  filters: CampaignFilters
): Promise<{ count: number; users: Array<{ id: string; email: string; firstName: string | null; tier: string; monitorCount: number }> }> {
  const allRecipients = await resolveRecipients(filters);
  return {
    count: allRecipients.length,
    users: allRecipients.slice(0, 50).map(({ unsubscribeToken, ...rest }) => rest),
  };
}

// Track active sending campaigns to allow cancellation
const activeSends = new Map<number, { cancelled: boolean }>();

/**
 * Send a single campaign email to one recipient.
 */
async function sendSingleCampaignEmail(
  campaign: { id: number; subject: string; htmlBody: string; textBody: string | null },
  recipientId: number,
  recipientEmail: string,
  userId: string,
  unsubscribeToken: string
): Promise<{ success: boolean; resendId?: string; error?: string }> {
  const resend = getResendClient();
  if (!resend) {
    console.log(`[Campaign] RESEND_API_KEY not set. Skipping campaign email send.`);
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const fromAddress = process.env.RESEND_FROM || "onboarding@resend.dev";
  const appUrl = getAppUrl();

  const unsubscribeUrl = `${appUrl}/api/campaigns/unsubscribe/${encodeURIComponent(unsubscribeToken)}`;

  const unsubscribeFooter = `
    <hr style="margin-top:32px; border:none; border-top:1px solid #333;"/>
    <p style="color:#888; font-size:12px; text-align:center; margin-top:16px;">
      You received this email because you have an account on FetchTheChange.<br/>
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#888; text-decoration:underline;">Unsubscribe from campaign emails</a>
      &mdash; you will still receive monitor notifications.
    </p>
  `;

  const htmlWithFooter = /<\/body>/i.test(campaign.htmlBody)
    ? campaign.htmlBody.replace(/<\/body>/i, unsubscribeFooter + "</body>")
    : campaign.htmlBody + unsubscribeFooter;

  const textBody = campaign.textBody
    ? `${campaign.textBody}\n\n---\nUnsubscribe from campaign emails: ${unsubscribeUrl}\nYou will still receive monitor notifications.`
    : undefined;

  try {
    const response = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      subject: campaign.subject,
      html: htmlWithFooter,
      text: textBody,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (response.error) {
      await db
        .update(campaignRecipients)
        .set({
          status: "failed",
          failedAt: new Date(),
          failureReason: response.error.message,
        })
        .where(eq(campaignRecipients.id, recipientId));

      await ResendUsageTracker.recordUsage(userId, undefined, recipientEmail, undefined, false).catch(() => {});
      return { success: false, error: response.error.message };
    }

    const resendId = response.data?.id;
    // Guard: only update if still pending — a concurrent cancel may have marked
    // this row as 'failed' between the batch SELECT and this UPDATE.
    await db
      .update(campaignRecipients)
      .set({
        status: "sent",
        resendId: resendId ?? null,
        sentAt: new Date(),
      })
      .where(and(eq(campaignRecipients.id, recipientId), eq(campaignRecipients.status, "pending")));

    await ResendUsageTracker.recordUsage(userId, undefined, recipientEmail, resendId, true).catch(() => {});
    return { success: true, resendId };
  } catch (error: any) {
    await db
      .update(campaignRecipients)
      .set({
        status: "failed",
        failedAt: new Date(),
        failureReason: error.message,
      })
      .where(eq(campaignRecipients.id, recipientId));

    await ResendUsageTracker.recordUsage(userId, undefined, recipientEmail, undefined, false).catch(() => {});
    return { success: false, error: error.message };
  }
}

/**
 * Send a test email to the admin for previewing a campaign.
 */
export async function sendTestCampaignEmail(
  campaign: { id: number; subject: string; htmlBody: string; textBody: string | null },
  testEmail: string
): Promise<{ success: boolean; resendId?: string; error?: string }> {
  const resend = getResendClient();
  if (!resend) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const fromAddress = process.env.RESEND_FROM || "onboarding@resend.dev";

  const banner = `
    <div style="background:#fbbf24; color:#000; padding:8px 16px; text-align:center; font-weight:bold;">
      TEST EMAIL &mdash; This is a preview of campaign "${escapeHtml(campaign.subject)}"
    </div>`;
  const footer = `
    <hr style="margin-top:32px; border:none; border-top:1px solid #333;"/>
    <p style="color:#888; font-size:12px; text-align:center; margin-top:16px;">
      You received this email because you have an account on FetchTheChange.<br/>
      <a href="#" style="color:#888; text-decoration:underline;">Unsubscribe from campaign emails</a>
      &mdash; you will still receive monitor notifications.
    </p>`;
  const htmlWithBanner = /<\/body>/i.test(campaign.htmlBody)
    ? campaign.htmlBody
        .replace(/<body([^>]*)>/i, `<body$1>${banner}`)
        .replace(/<\/body>/i, footer + "</body>")
    : banner + campaign.htmlBody + footer;

  try {
    const response = await resend.emails.send({
      from: fromAddress,
      to: testEmail,
      subject: `[TEST] ${campaign.subject}`,
      html: htmlWithBanner,
      text: campaign.textBody ?? undefined,
    });

    if (response.error) {
      return { success: false, error: response.error.message };
    }

    return { success: true, resendId: response.data?.id };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Trigger a campaign send. Creates recipient rows and begins batch processing.
 */
export async function triggerCampaignSend(campaignId: number): Promise<{ totalRecipients: number }> {
  // Resolve recipients outside transaction to avoid long-held locks
  const [campaignCheck] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaignCheck) throw new Error("Campaign not found");
  if (campaignCheck.status !== "draft") throw new Error("Campaign must be in draft status to send");

  const filters = (campaignCheck.filters as CampaignFilters) || {};
  const recipients = await resolveRecipients(filters);

  if (recipients.length === 0) {
    throw new Error("No recipients match the campaign filters");
  }

  // Use a transaction with an atomic status guard to prevent double-sends
  const campaign = await db.transaction(async (tx) => {
    // Atomically claim the campaign: only one concurrent caller can succeed
    const [claimed] = await tx
      .update(campaigns)
      .set({
        status: "sending",
        totalRecipients: recipients.length,
        sentAt: new Date(),
      })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "draft")))
      .returning();

    if (!claimed) {
      throw new Error("Campaign must be in draft status to send");
    }

    // Create recipient rows in batches within the same transaction
    const CHUNK_SIZE = 100;
    const recipientRows = recipients.map((r) => ({
      campaignId,
      userId: r.id,
      recipientEmail: r.email,
      status: "pending" as const,
    }));
    for (let i = 0; i < recipientRows.length; i += CHUNK_SIZE) {
      await tx.insert(campaignRecipients).values(recipientRows.slice(i, i + CHUNK_SIZE));
    }

    return claimed;
  });

  // Start batch sending asynchronously (outside transaction)
  const sendControl = { cancelled: false };
  activeSends.set(campaignId, sendControl);
  sendCampaignBatch(campaignId, campaign, sendControl).catch(async (err) => {
    await ErrorLogger.error("email", `Campaign ${campaignId} batch send error`, err instanceof Error ? err : null, { campaignId });
    await finalizeCampaign(campaignId, "partially_sent");
    activeSends.delete(campaignId);
  });

  return { totalRecipients: recipients.length };
}

/**
 * Process pending recipients in batches.
 */
async function sendCampaignBatch(
  campaignId: number,
  campaign: { id: number; subject: string; htmlBody: string; textBody: string | null },
  control: { cancelled: boolean }
): Promise<void> {
  const BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 2000;
  const MAX_BATCHES = 1000;
  let batchCount = 0;

  while (true) {
    if (batchCount >= MAX_BATCHES) {
      console.log(`[Campaign] Campaign ${campaignId} hit max batch limit (${MAX_BATCHES}). Finalizing as partially_sent.`);
      await finalizeCampaign(campaignId, "partially_sent");
      activeSends.delete(campaignId);
      return;
    }
    batchCount++;
    if (control.cancelled) {
      await finalizeCampaign(campaignId, "cancelled");
      activeSends.delete(campaignId);
      return;
    }

    // Fetch next batch of pending recipients
    const pending = await db.execute(sql`
      SELECT cr.id, cr.user_id as "userId", cr.recipient_email as "recipientEmail",
             u.unsubscribe_token as "unsubscribeToken"
      FROM campaign_recipients cr
      JOIN users u ON u.id = cr.user_id
      WHERE cr.campaign_id = ${campaignId} AND cr.status = 'pending'
      LIMIT ${BATCH_SIZE}
    `);

    if (pending.rows.length === 0) {
      // All done
      await finalizeCampaign(campaignId, "sent");
      activeSends.delete(campaignId);
      return;
    }

    for (const row of pending.rows as any[]) {
      if (control.cancelled) {
        await finalizeCampaign(campaignId, "cancelled");
        activeSends.delete(campaignId);
        return;
      }

      // Check Resend caps before each send
      const capCheck = await ResendUsageTracker.canSendEmail();
      if (!capCheck.allowed) {
        console.log(`[Campaign] Resend cap reached during campaign ${campaignId}: ${capCheck.reason}`);
        await finalizeCampaign(campaignId, "partially_sent");
        activeSends.delete(campaignId);
        return;
      }

      const result = await sendSingleCampaignEmail(
        campaign,
        row.id,
        row.recipientEmail,
        row.userId,
        row.unsubscribeToken
      );

      // Update denormalized counters
      if (result.success) {
        await db.execute(sql`
          UPDATE campaigns SET sent_count = sent_count + 1
          WHERE id = ${campaignId}
        `);
      } else {
        await db.execute(sql`
          UPDATE campaigns SET failed_count = failed_count + 1
          WHERE id = ${campaignId}
        `);
      }
    }

    // Delay between batches
    await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
  }
}

/**
 * Finalize campaign status and set completedAt.
 * When cancelled, also marks remaining pending recipients as failed.
 */
async function finalizeCampaign(campaignId: number, status: string): Promise<void> {
  // Mark remaining pending recipients when cancelling or partially sending
  if (status === "cancelled" || status === "partially_sent") {
    await db.transaction(async (tx) => {
      // Atomically mark pending recipients as failed and count how many were updated
      const failedResult = await tx.execute(sql`
        UPDATE campaign_recipients
        SET status = 'failed',
            failed_at = NOW(),
            failure_reason = ${status === "cancelled" ? "Campaign cancelled" : "Campaign cap reached"}
        WHERE campaign_id = ${campaignId} AND status = 'pending'
        RETURNING id
      `);
      const failedCount = failedResult.rows.length;

      // Single campaign update: status + completedAt + failedCount in one statement
      // Guard against overwriting a terminal status (e.g., already finalized by batch loop)
      await tx.execute(sql`
        UPDATE campaigns
        SET status = ${status},
            completed_at = NOW()
            ${failedCount > 0 ? sql`, failed_count = COALESCE(failed_count, 0) + ${failedCount}` : sql``}
        WHERE id = ${campaignId}
          AND status NOT IN ('sent', 'cancelled', 'partially_sent')
      `);
    });
  } else {
    // Guard against overwriting a terminal status
    await db.execute(sql`
      UPDATE campaigns
      SET status = ${status},
          completed_at = NOW()
      WHERE id = ${campaignId}
        AND status NOT IN ('sent', 'cancelled', 'partially_sent')
    `);
  }

  console.log(`[Campaign] Campaign ${campaignId} finalized as '${status}'`);
}

/**
 * Cancel a sending campaign.
 */
export async function cancelCampaign(campaignId: number): Promise<{ sentSoFar: number; cancelled: number }> {
  const control = activeSends.get(campaignId);
  if (control) {
    control.cancelled = true;
  }

  // Count current state
  const sentResult = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked'))::int as "sentCount",
      COUNT(*) FILTER (WHERE status = 'pending')::int as "pendingCount"
    FROM campaign_recipients
    WHERE campaign_id = ${campaignId}
  `);
  const row = sentResult.rows[0] as any;
  const sentSoFar = Number(row?.sentCount ?? 0);
  const pendingCount = Number(row?.pendingCount ?? 0);

  // Mark remaining pending as cancelled (use failed status with reason)
  // Only proceed if the campaign is not already in a terminal state
  if (!control) {
    let skipped = false;
    let actualCancelled = 0;
    await db.transaction(async (tx) => {
      // Lock the campaign row and check terminal status atomically
      const statusResult = await tx.execute(sql`
        SELECT status FROM campaigns
        WHERE id = ${campaignId}
        FOR UPDATE
      `);
      const currentStatus = (statusResult.rows[0] as any)?.status;
      const terminalStatuses = ["sent", "cancelled", "partially_sent"];
      if (!currentStatus || terminalStatuses.includes(currentStatus)) {
        skipped = true;
        return;
      }

      // Atomically mark pending recipients as failed and count affected rows
      const failedResult = await tx.execute(sql`
        UPDATE campaign_recipients
        SET status = 'failed',
            failed_at = NOW(),
            failure_reason = 'Campaign cancelled'
        WHERE campaign_id = ${campaignId} AND status = 'pending'
        RETURNING id
      `);
      const failedCount = failedResult.rows.length;
      actualCancelled = failedCount;

      // Single campaign update with accurate failedCount — guard against terminal status
      await tx.execute(sql`
        UPDATE campaigns
        SET status = 'cancelled',
            completed_at = NOW()
            ${failedCount > 0 ? sql`, failed_count = COALESCE(failed_count, 0) + ${failedCount}` : sql``}
        WHERE id = ${campaignId}
          AND status NOT IN ('sent', 'cancelled', 'partially_sent')
      `);
    });

    if (skipped) {
      return { sentSoFar, cancelled: 0 };
    }

    return { sentSoFar, cancelled: actualCancelled };
  }

  // The batch loop will finalize the campaign asynchronously via finalizeCampaign().
  // We mark remaining pending recipients now so the response reflects the real
  // cancelled count. When finalizeCampaign() runs later, its UPDATE...WHERE status='pending'
  // will find zero rows (already marked here), so its failed_count increment is a no-op.
  let actualCancelled = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    const failedResult = await tx.execute(sql`
      UPDATE campaign_recipients
      SET status = 'failed',
          failed_at = NOW(),
          failure_reason = 'Campaign cancelled'
      WHERE campaign_id = ${campaignId} AND status = 'pending'
      RETURNING id
    `);
    actualCancelled = failedResult.rows.length;

    if (actualCancelled > 0) {
      await tx.execute(sql`
        UPDATE campaigns
        SET failed_count = COALESCE(failed_count, 0) + ${actualCancelled}
        WHERE id = ${campaignId}
          AND status NOT IN ('sent', 'cancelled', 'partially_sent')
      `);
    }
  });

  return { sentSoFar, cancelled: actualCancelled };
}

/**
 * Reconcile campaign counters from actual campaign_recipients rows.
 * Recomputes sentCount, failedCount, deliveredCount, openedCount, clickedCount
 * from the ground truth in the recipients table.
 */
export async function reconcileCampaignCounters(campaignId: number): Promise<{
  before: Record<string, number>;
  after: Record<string, number>;
}> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) throw new Error("Campaign not found");
  if (campaign.status === "sending") throw new Error("Cannot reconcile counters while campaign is actively sending");

  const before = {
    totalRecipients: campaign.totalRecipients,
    sentCount: campaign.sentCount,
    failedCount: campaign.failedCount,
    deliveredCount: campaign.deliveredCount,
    openedCount: campaign.openedCount,
    clickedCount: campaign.clickedCount,
  };

  // Compute actual counts from recipient rows
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS "totalRecipients",
      COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked'))::int AS "sentCount",
      COUNT(*) FILTER (WHERE status IN ('failed', 'bounced', 'complained'))::int AS "failedCount",
      COUNT(*) FILTER (WHERE status IN ('delivered', 'opened', 'clicked'))::int AS "deliveredCount",
      COUNT(*) FILTER (WHERE status IN ('opened', 'clicked'))::int AS "openedCount",
      COUNT(*) FILTER (WHERE status = 'clicked')::int AS "clickedCount"
    FROM campaign_recipients
    WHERE campaign_id = ${campaignId}
  `);

  const row = result.rows[0] as any;
  const after = {
    totalRecipients: Number(row?.totalRecipients ?? 0),
    sentCount: Number(row?.sentCount ?? 0),
    failedCount: Number(row?.failedCount ?? 0),
    deliveredCount: Number(row?.deliveredCount ?? 0),
    openedCount: Number(row?.openedCount ?? 0),
    clickedCount: Number(row?.clickedCount ?? 0),
  };

  await db
    .update(campaigns)
    .set(after)
    .where(eq(campaigns.id, campaignId));

  return { before, after };
}
