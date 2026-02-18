import { db } from "../db";
import { campaignRecipients, campaigns } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { ErrorLogger } from "./logger";

interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    [key: string]: any;
  };
}

/**
 * Verify and parse a Resend webhook payload.
 * Resend uses Svix for webhook signing. If RESEND_WEBHOOK_SECRET is set,
 * we verify the signature; otherwise we skip verification (dev mode).
 */
export async function verifyResendWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>
): Promise<ResendWebhookEvent> {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  if (webhookSecret) {
    const { Webhook } = await import("svix");
    const wh = new Webhook(webhookSecret);

    const svixHeaders: Record<string, string> = {};
    for (const key of ["svix-id", "svix-timestamp", "svix-signature"]) {
      const val = headers[key];
      svixHeaders[key] = Array.isArray(val) ? val[0] : (val || "");
    }

    const payload = wh.verify(rawBody.toString(), svixHeaders) as ResendWebhookEvent;
    return payload;
  }

  // No secret configured — parse without verification (development)
  return JSON.parse(rawBody.toString()) as ResendWebhookEvent;
}

/**
 * Process a verified Resend webhook event.
 * Updates campaign_recipients status and denormalized campaign counters.
 */
export async function handleResendWebhookEvent(event: ResendWebhookEvent): Promise<void> {
  const resendId = event.data.email_id;
  if (!resendId) return;

  // Look up the campaign recipient by resendId
  const [recipient] = await db
    .select()
    .from(campaignRecipients)
    .where(eq(campaignRecipients.resendId, resendId))
    .limit(1);

  if (!recipient) {
    // Not a campaign email — could be a notification email; ignore silently
    return;
  }

  const now = new Date();

  switch (event.type) {
    case "email.delivered":
      // Only upgrade status if not already opened/clicked
      if (recipient.status === "sent") {
        await db
          .update(campaignRecipients)
          .set({ status: "delivered", deliveredAt: now })
          .where(eq(campaignRecipients.id, recipient.id));

        await db.execute(sql`
          UPDATE campaigns SET delivered_count = delivered_count + 1
          WHERE id = ${recipient.campaignId}
        `);
      }
      break;

    case "email.opened":
      // Only count first open
      if (!recipient.openedAt) {
        await db
          .update(campaignRecipients)
          .set({ status: "opened", openedAt: now, deliveredAt: recipient.deliveredAt ?? now })
          .where(eq(campaignRecipients.id, recipient.id));

        await db.execute(sql`
          UPDATE campaigns SET opened_count = opened_count + 1
          ${recipient.deliveredAt ? sql`` : sql`, delivered_count = delivered_count + 1`}
          WHERE id = ${recipient.campaignId}
        `);
      }
      break;

    case "email.clicked":
      // Only count first click
      if (!recipient.clickedAt) {
        await db
          .update(campaignRecipients)
          .set({
            status: "clicked",
            clickedAt: now,
            openedAt: recipient.openedAt ?? now,
            deliveredAt: recipient.deliveredAt ?? now,
          })
          .where(eq(campaignRecipients.id, recipient.id));

        // Build counter updates
        let counterUpdates = sql`clicked_count = clicked_count + 1`;
        if (!recipient.openedAt) {
          counterUpdates = sql`${counterUpdates}, opened_count = opened_count + 1`;
        }
        if (!recipient.deliveredAt) {
          counterUpdates = sql`${counterUpdates}, delivered_count = delivered_count + 1`;
        }

        await db.execute(sql`
          UPDATE campaigns SET ${counterUpdates}
          WHERE id = ${recipient.campaignId}
        `);
      }
      break;

    case "email.bounced":
      await db
        .update(campaignRecipients)
        .set({
          status: "bounced",
          failedAt: now,
          failureReason: "bounced",
        })
        .where(eq(campaignRecipients.id, recipient.id));

      await db.execute(sql`
        UPDATE campaigns SET failed_count = failed_count + 1
        WHERE id = ${recipient.campaignId}
      `);
      break;

    case "email.complained":
      await db
        .update(campaignRecipients)
        .set({
          status: "bounced",
          failedAt: now,
          failureReason: "spam complaint",
        })
        .where(eq(campaignRecipients.id, recipient.id));
      break;

    default:
      // Unknown event type — log for debugging
      console.log(`[ResendWebhook] Unhandled event type: ${event.type}`);
  }
}
