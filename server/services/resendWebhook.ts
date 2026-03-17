import { db } from "../db";
import { campaignRecipients, campaigns } from "@shared/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
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

  // No secret configured — only allow in development
  if (process.env.NODE_ENV === "production") {
    throw new Error("RESEND_WEBHOOK_SECRET must be configured in production — webhook signature verification is required.");
  }
  console.warn("[ResendWebhook] RESEND_WEBHOOK_SECRET is not set — skipping signature verification (development only).");
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
      // Atomically update only if status is still 'sent' — prevents double-counting
      // when duplicate webhooks race past the initial SELECT.
      // Note: if a bounce arrives before delivery (valid email pattern), the status
      // will already be 'bounced' and this guard correctly skips the delivery update.
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(campaignRecipients)
          .set({ status: "delivered", deliveredAt: now })
          .where(and(eq(campaignRecipients.id, recipient.id), eq(campaignRecipients.status, "sent")))
          .returning({ id: campaignRecipients.id });

        if (updated) {
          await tx.execute(sql`
            UPDATE campaigns SET delivered_count = delivered_count + 1
            WHERE id = ${recipient.campaignId}
          `);
        } else {
          console.debug(`[ResendWebhook] Duplicate or out-of-order ${event.type} for resendId=${resendId} — skipped`);
        }
      });
      break;

    case "email.opened":
      // Atomically update only if openedAt is still NULL
      await db.transaction(async (tx) => {
        // Lock the row and read fresh state inside the transaction to avoid
        // stale-read on deliveredAt when deciding which counters to increment.
        // Column names (delivered_at) must match the physical schema in shared/schema.ts.
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        const freshRows = await tx.execute(sql`
          SELECT delivered_at FROM campaign_recipients WHERE id = ${recipient.id} FOR UPDATE
        `);
        const fresh = freshRows.rows[0] as { delivered_at: Date | null } | undefined;

        const [updated] = await tx
          .update(campaignRecipients)
          .set({ status: "opened", openedAt: now, deliveredAt: fresh?.delivered_at ?? now })
          .where(and(eq(campaignRecipients.id, recipient.id), isNull(campaignRecipients.openedAt), isNull(campaignRecipients.failedAt)))
          .returning({ id: campaignRecipients.id });

        if (updated) {
          await tx.execute(sql`
            UPDATE campaigns SET opened_count = opened_count + 1
            ${fresh?.delivered_at ? sql.empty() : sql`, delivered_count = delivered_count + 1`}
            WHERE id = ${recipient.campaignId}
          `);
        } else {
          console.debug(`[ResendWebhook] Duplicate or out-of-order ${event.type} for resendId=${resendId} — skipped`);
        }
      });
      break;

    case "email.clicked":
      // Atomically update only if clickedAt is still NULL
      await db.transaction(async (tx) => {
        // Lock the row and read fresh state inside the transaction to avoid
        // stale-read on openedAt/deliveredAt when deciding which counters to increment.
        // Column names (delivered_at, opened_at) must match the physical schema in shared/schema.ts.
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        const freshRows = await tx.execute(sql`
          SELECT delivered_at, opened_at FROM campaign_recipients WHERE id = ${recipient.id} FOR UPDATE
        `);
        const fresh = freshRows.rows[0] as { delivered_at: Date | null; opened_at: Date | null } | undefined;

        const [updated] = await tx
          .update(campaignRecipients)
          .set({
            status: "clicked",
            clickedAt: now,
            openedAt: fresh?.opened_at ?? now,
            deliveredAt: fresh?.delivered_at ?? now,
          })
          .where(and(eq(campaignRecipients.id, recipient.id), isNull(campaignRecipients.clickedAt), isNull(campaignRecipients.failedAt)))
          .returning({ id: campaignRecipients.id });

        if (updated) {
          // Build counter updates using fresh state from inside the transaction
          let counterUpdates = sql`clicked_count = clicked_count + 1`;
          if (!fresh?.opened_at) {
            counterUpdates = sql`${counterUpdates}, opened_count = opened_count + 1`;
          }
          if (!fresh?.delivered_at) {
            counterUpdates = sql`${counterUpdates}, delivered_count = delivered_count + 1`;
          }

          await tx.execute(sql`
            UPDATE campaigns SET ${counterUpdates}
            WHERE id = ${recipient.campaignId}
          `);
        } else {
          console.debug(`[ResendWebhook] Duplicate or out-of-order ${event.type} for resendId=${resendId} — skipped`);
        }
      });
      break;

    case "email.bounced":
      // Atomically update only if failedAt is still NULL
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(campaignRecipients)
          .set({
            status: "bounced",
            failedAt: now,
            failureReason: "bounced",
          })
          .where(and(eq(campaignRecipients.id, recipient.id), isNull(campaignRecipients.failedAt)))
          .returning({
            id: campaignRecipients.id,
            deliveredAt: campaignRecipients.deliveredAt,
            openedAt: campaignRecipients.openedAt,
            clickedAt: campaignRecipients.clickedAt,
          });

        if (updated) {
          let counterUpdates = sql`failed_count = failed_count + 1`;
          if (updated.clickedAt) {
            counterUpdates = sql`${counterUpdates}, clicked_count = GREATEST(clicked_count - 1, 0)`;
          }
          if (updated.openedAt) {
            counterUpdates = sql`${counterUpdates}, opened_count = GREATEST(opened_count - 1, 0)`;
          }
          if (updated.deliveredAt) {
            counterUpdates = sql`${counterUpdates}, delivered_count = GREATEST(delivered_count - 1, 0)`;
          }
          await tx.execute(sql`
            UPDATE campaigns SET ${counterUpdates}
            WHERE id = ${recipient.campaignId}
          `);
        } else {
          console.debug(`[ResendWebhook] Duplicate or out-of-order ${event.type} for resendId=${resendId} — skipped`);
        }
      });
      break;

    case "email.complained":
      // Atomically update only if failedAt is still NULL
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(campaignRecipients)
          .set({
            status: "complained",
            failedAt: now,
            failureReason: "spam complaint",
          })
          .where(and(eq(campaignRecipients.id, recipient.id), isNull(campaignRecipients.failedAt)))
          .returning({
            id: campaignRecipients.id,
            deliveredAt: campaignRecipients.deliveredAt,
            openedAt: campaignRecipients.openedAt,
            clickedAt: campaignRecipients.clickedAt,
          });

        if (updated) {
          let counterUpdates = sql`failed_count = failed_count + 1`;
          if (updated.clickedAt) {
            counterUpdates = sql`${counterUpdates}, clicked_count = GREATEST(clicked_count - 1, 0)`;
          }
          if (updated.openedAt) {
            counterUpdates = sql`${counterUpdates}, opened_count = GREATEST(opened_count - 1, 0)`;
          }
          if (updated.deliveredAt) {
            counterUpdates = sql`${counterUpdates}, delivered_count = GREATEST(delivered_count - 1, 0)`;
          }
          await tx.execute(sql`
            UPDATE campaigns SET ${counterUpdates}
            WHERE id = ${recipient.campaignId}
          `);
        } else {
          console.debug(`[ResendWebhook] Duplicate or out-of-order ${event.type} for resendId=${resendId} — skipped`);
        }
      });
      break;

    default:
      // Unknown event type — log for debugging
      console.log(`[ResendWebhook] Unhandled event type: ${event.type}`);
  }
}
