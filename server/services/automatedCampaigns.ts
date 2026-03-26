import { db } from "../db";
import { campaigns, automatedCampaignConfigs, type AutomatedCampaignConfig } from "@shared/schema";
import { triggerCampaignSend } from "./campaignEmail";
import { resolveRecipients } from "./campaignEmail";
import { ErrorLogger } from "./logger";
import { eq, and, isNull } from "drizzle-orm";

export const WELCOME_CAMPAIGN_DEFAULTS = {
  key: "welcome",
  name: "Welcome — New Members",
  subject: "Welcome to FetchTheChange — here's how to get started",
  htmlBody: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to FetchTheChange</title>
</head>
<body style="margin:0;padding:0;background:#0f0f11;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;color:#fafafa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f11;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Logo / wordmark -->
          <tr>
            <td style="padding-bottom:32px;">
              <span style="font-family:'DM Mono',monospace;font-size:18px;font-weight:600;color:#6366f1;letter-spacing:-0.5px;">FetchTheChange</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:40px 36px;">

              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#fafafa;">Hey,</p>

              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#fafafa;">
                Welcome to FetchTheChange. You're set up and ready to go.
              </p>

              <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#a1a1aa;">
                The fastest way to start: install the Chrome extension. Hover over any element on any page, click it, and your monitor is live — no CSS selectors needed.
              </p>

              <!-- CTA: Extension -->
              <table cellpadding="0" cellspacing="0" style="margin:20px 0;">
                <tr>
                  <td style="background:#6366f1;border-radius:8px;padding:12px 24px;">
                    <a href="https://ftc.bd73.com/docs/extension" style="color:#fff;text-decoration:none;font-size:15px;font-weight:600;">
                      → Get the Chrome extension
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#a1a1aa;">
                Or go straight to the dashboard and create a monitor manually if you already know your selector:
              </p>

              <!-- CTA: Dashboard -->
              <table cellpadding="0" cellspacing="0" style="margin:20px 0 32px;">
                <tr>
                  <td style="background:#27272a;border:1px solid #3f3f46;border-radius:8px;padding:12px 24px;">
                    <a href="https://ftc.bd73.com/dashboard" style="color:#fafafa;text-decoration:none;font-size:15px;font-weight:500;">
                      → Open your dashboard
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #27272a;margin:0 0 28px;" />

              <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.06em;">A few things worth knowing</p>
              <ul style="margin:0 0 28px;padding-left:20px;color:#a1a1aa;font-size:15px;line-height:1.8;">
                <li>Notifications go to email by default. You can also connect <strong style="color:#fafafa;">Slack</strong> or a <strong style="color:#fafafa;">webhook</strong> — per monitor, independently.</li>
                <li>Change history is always recorded, whether or not a notification fires.</li>
                <li>If a site uses Cloudflare Bot Management or similar, you'll see a <strong style="color:#fafafa;">"Bot blocked"</strong> badge. That's the site blocking automated access — not a bug on our end.</li>
              </ul>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #27272a;margin:0 0 28px;" />

              <p style="margin:0;font-size:15px;line-height:1.6;color:#a1a1aa;">
                If something's confusing or broken, just reply to this email.
              </p>
              <p style="margin:16px 0 0;font-size:15px;color:#fafafa;">
                — Christian<br />
                <span style="color:#6366f1;font-family:'DM Mono',monospace;font-size:13px;">FetchTheChange</span>
              </p>

            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  textBody: `Hey,

Welcome to FetchTheChange. You're set up and ready to go.

The fastest way to start: install the Chrome extension. Hover over any element on any page, click it, and your monitor is live — no CSS selectors needed.

→ Get the extension: https://ftc.bd73.com/docs/extension

Or go straight to the dashboard and create a monitor manually if you already know your selector:

→ Dashboard: https://ftc.bd73.com/dashboard

---

A few things worth knowing:

- Notifications go to email by default. You can also connect Slack or a webhook — per monitor, independently.
- Change history is always recorded, whether or not a notification fires.
- If a site uses Cloudflare Bot Management or similar, you'll see a "Bot blocked" badge. That's the site blocking automated access — not a bug on our end.

---

If something's confusing or broken, just reply to this email.

— Christian
FetchTheChange`,
};

/**
 * Compute the next scheduled run date (1st or 15th of a month, UTC midnight).
 * Given `fromDate`, returns the next occurrence of the 1st or 15th that is
 * strictly after `fromDate`.
 */
export function computeNextRunAt(fromDate: Date): Date {
  const year = fromDate.getUTCFullYear();
  const month = fromDate.getUTCMonth();
  const day = fromDate.getUTCDate();
  const hours = fromDate.getUTCHours();
  const minutes = fromDate.getUTCMinutes();
  const seconds = fromDate.getUTCSeconds();
  const ms = fromDate.getUTCMilliseconds();

  // Check if we're strictly before the 1st at midnight (impossible for valid dates, day >= 1)
  // If day < 15, next is the 15th of current month
  // If day >= 15, next is the 1st of next month
  // Special case: if exactly on the 1st at 00:00:00.000 or 15th at 00:00:00.000,
  // that means the run already fired, so advance to the next date

  const isExactlyMidnight = hours === 0 && minutes === 0 && seconds === 0 && ms === 0;

  if (day < 15) {
    // Could be the 1st at midnight (already fired) or any day before the 15th
    if (day === 1 && isExactlyMidnight) {
      // Already on schedule day, advance to 15th
      return new Date(Date.UTC(year, month, 15, 0, 0, 0));
    }
    // Next is the 15th of current month
    return new Date(Date.UTC(year, month, 15, 0, 0, 0));
  }

  if (day === 15 && isExactlyMidnight) {
    // Already on schedule day, advance to 1st of next month
    return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0));
  }

  // day >= 15, next is the 1st of next month
  return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0));
}

/**
 * Ensure the welcome config row exists in the DB. Idempotent.
 */
export async function ensureWelcomeConfig(): Promise<AutomatedCampaignConfig> {
  const [existing] = await db
    .select()
    .from(automatedCampaignConfigs)
    .where(eq(automatedCampaignConfigs.key, "welcome"))
    .limit(1);

  if (existing) return existing;

  await db
    .insert(automatedCampaignConfigs)
    .values({
      key: WELCOME_CAMPAIGN_DEFAULTS.key,
      name: WELCOME_CAMPAIGN_DEFAULTS.name,
      subject: WELCOME_CAMPAIGN_DEFAULTS.subject,
      htmlBody: WELCOME_CAMPAIGN_DEFAULTS.htmlBody,
      textBody: WELCOME_CAMPAIGN_DEFAULTS.textBody,
      enabled: true,
      nextRunAt: computeNextRunAt(new Date()),
    })
    .onConflictDoNothing();

  // Re-select to get the canonical row (handles concurrent inserts)
  const [inserted] = await db
    .select()
    .from(automatedCampaignConfigs)
    .where(eq(automatedCampaignConfigs.key, "welcome"))
    .limit(1);

  return inserted;
}

/**
 * Bootstrap the first welcome send on server startup.
 * Idempotent — only runs if lastRunAt IS NULL.
 */
export async function bootstrapWelcomeCampaign(): Promise<void> {
  const config = await ensureWelcomeConfig();

  if (config.lastRunAt) {
    console.log(`[Bootstrap] Welcome campaign already bootstrapped (lastRunAt=${config.lastRunAt.toISOString()}), skipping.`);
    return;
  }

  console.log("[Bootstrap] Running first welcome campaign for early adopters...");

  // Atomically claim bootstrap: only proceed if lastRunAt IS NULL (prevents concurrent deploys sending twice)
  const now = new Date();
  const nextRunAt = computeNextRunAt(now);

  const [claimed] = await db
    .update(automatedCampaignConfigs)
    .set({
      lastRunAt: now,
      nextRunAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(automatedCampaignConfigs.id, config.id),
        isNull(automatedCampaignConfigs.lastRunAt),
      )
    )
    .returning();

  if (!claimed) {
    console.log("[Bootstrap] Welcome campaign already claimed by another instance, skipping.");
    return;
  }

  const signupAfter = new Date("2025-03-19T00:00:00Z");
  const signupBefore = now;

  const result = await runWelcomeCampaign({
    signupAfter,
    signupBefore,
    configId: config.id,
  });

  if ("skipped" in result) {
    console.log("[Bootstrap] Welcome campaign bootstrap complete — no new recipients in window.");
  } else {
    console.log(`[Bootstrap] Welcome campaign bootstrap complete — sent campaign #${result.campaignId} to ${result.totalRecipients} recipients. Next run: ${nextRunAt.toISOString()}`);
  }
}

/**
 * Run the automated welcome campaign for a given window.
 * Creates a campaigns record (type='automated'), resolves recipients,
 * sends via triggerCampaignSend(), updates lastRunAt + nextRunAt.
 * Returns { skipped: true } if zero recipients found.
 */
export async function runWelcomeCampaign(opts: {
  signupAfter: Date;
  signupBefore: Date;
  configId: number;
}): Promise<{ campaignId: number; totalRecipients: number } | { skipped: true }> {
  const { signupAfter, signupBefore, configId } = opts;

  console.log(`[AutoCampaign] Running welcome campaign: signupAfter=${signupAfter.toISOString()}, signupBefore=${signupBefore.toISOString()}`);

  // Get the config for template content
  const [config] = await db
    .select()
    .from(automatedCampaignConfigs)
    .where(eq(automatedCampaignConfigs.id, configId))
    .limit(1);

  if (!config) throw new Error(`Automated campaign config not found: id=${configId}`);

  // Resolve recipients to check if there are any
  const filters = {
    signupAfter: signupAfter.toISOString(),
    signupBefore: signupBefore.toISOString(),
  };
  const recipients = await resolveRecipients(filters);

  if (recipients.length === 0) {
    console.log("[AutoCampaign] Skipped — no new recipients in window");
    return { skipped: true };
  }

  // Create campaign record in draft status (triggerCampaignSend expects draft)
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `${config.name} — ${signupAfter.toISOString().slice(0, 10)} to ${signupBefore.toISOString().slice(0, 10)}`,
      subject: config.subject,
      htmlBody: config.htmlBody,
      textBody: config.textBody,
      status: "draft",
      type: "automated",
      filters: filters as any,
    })
    .returning();

  // Use the existing triggerCampaignSend which handles batching, rate limiting, etc.
  const sendResult = await triggerCampaignSend(campaign.id);

  console.log(`[AutoCampaign] Sent welcome campaign #${campaign.id} to ${sendResult.totalRecipients} recipients.`);

  return { campaignId: campaign.id, totalRecipients: sendResult.totalRecipients };
}

/**
 * Called by the scheduler cron. Finds enabled configs where nextRunAt <= NOW(),
 * calls runWelcomeCampaign for each, handles errors per-config without throwing.
 */
export async function processAutomatedCampaigns(): Promise<void> {
  const now = new Date();

  const configs = await db
    .select()
    .from(automatedCampaignConfigs)
    .where(eq(automatedCampaignConfigs.enabled, true));

  for (const config of configs) {
    if (!config.nextRunAt || config.nextRunAt > now) continue;

    try {
      const signupAfter = config.lastRunAt || new Date("2025-03-19T00:00:00Z");
      const signupBefore = now;
      const nextRunAt = computeNextRunAt(now);

      // Atomically claim this run by updating nextRunAt + lastRunAt.
      // If another instance already claimed it, the WHERE won't match and we skip.
      const [claimed] = await db
        .update(automatedCampaignConfigs)
        .set({
          lastRunAt: now,
          nextRunAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(automatedCampaignConfigs.id, config.id),
            eq(automatedCampaignConfigs.nextRunAt, config.nextRunAt),
          )
        )
        .returning();

      if (!claimed) {
        console.log(`[AutoCampaign] Config '${config.key}' already claimed by another instance, skipping.`);
        continue;
      }

      const result = await runWelcomeCampaign({
        signupAfter,
        signupBefore,
        configId: config.id,
      });

      if (!("skipped" in result)) {
        console.log(`[AutoCampaign] Sent welcome campaign #${result.campaignId} to ${result.totalRecipients} recipients. Next run: ${nextRunAt.toISOString()}`);
      }
    } catch (error) {
      await ErrorLogger.error(
        "scheduler",
        `Automated campaign '${config.key}' failed`,
        error instanceof Error ? error : null,
        { configId: config.id, configKey: config.key, errorMessage: error instanceof Error ? error.message : String(error) }
      );
    }
  }
}
