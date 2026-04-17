import { db } from "../db";
import { campaigns, campaignRecipients, automatedCampaignConfigs, users, type AutomatedCampaignConfig } from "@shared/schema";
import { triggerCampaignSend, resolveRecipients, TERMINAL_RECIPIENT_STATUSES } from "./campaignEmail";
import { ErrorLogger } from "./logger";
import { eq, and, isNull, inArray, gte, lte, sql } from "drizzle-orm";

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
                    <a href="https://ftc.bd73.com/support" style="color:#fff;text-decoration:none;font-size:15px;font-weight:600;">
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

→ Get the extension: https://ftc.bd73.com/support

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
 * One-time patch: update the welcome campaign config row if its html_body or
 * text_body still contains the deprecated /docs/extension URL. Idempotent —
 * once the bad URL is gone from both bodies, this is a no-op, so it's safe to
 * call on every deployment.
 *
 * Does a targeted string replacement rather than overwriting with defaults, so
 * any admin customizations to the rest of the template are preserved.
 *
 * Only patches the config template row; already-sent campaign records are left
 * untouched.
 */
export async function patchWelcomeCampaignUrls(): Promise<void> {
  const LEGACY_URL = "ftc.bd73.com/docs/extension";
  const NEW_URL = "ftc.bd73.com/support";

  const [config] = await db
    .select()
    .from(automatedCampaignConfigs)
    .where(eq(automatedCampaignConfigs.key, "welcome"))
    .limit(1);

  if (!config) return;

  const htmlNeedsPatch = config.htmlBody.includes(LEGACY_URL);
  const textNeedsPatch = config.textBody?.includes(LEGACY_URL) ?? false;

  if (!htmlNeedsPatch && !textNeedsPatch) return;

  const patchedHtmlBody = htmlNeedsPatch
    ? config.htmlBody.split(LEGACY_URL).join(NEW_URL)
    : config.htmlBody;
  const patchedTextBody = textNeedsPatch
    ? config.textBody!.split(LEGACY_URL).join(NEW_URL)
    : config.textBody;

  const [patched] = await db
    .update(automatedCampaignConfigs)
    .set({
      htmlBody: patchedHtmlBody,
      textBody: patchedTextBody,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(automatedCampaignConfigs.key, "welcome"),
        eq(automatedCampaignConfigs.updatedAt, config.updatedAt),
      )
    )
    .returning();

  if (patched) {
    console.log("[Patch] Welcome campaign URLs updated: /docs/extension → /support");
  } else {
    console.warn("[Patch] Welcome campaign URL patch skipped — config row was modified concurrently.");
  }
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

  try {
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
  } catch (error) {
    // Roll back the atomic claim so a future bootstrap (on restart) re-attempts
    // the same early-adopter window. Without this, a transient failure during
    // the very first send would permanently drop the entire cohort, because
    // the next bootstrap call short-circuits on `config.lastRunAt` being set.
    // Guard the rollback on `lastRunAt === now` so we don't overwrite a
    // successful claim by a concurrent instance.
    try {
      const rolledBack = await db
        .update(automatedCampaignConfigs)
        .set({
          lastRunAt: null,
          nextRunAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(automatedCampaignConfigs.id, config.id),
            eq(automatedCampaignConfigs.lastRunAt, now),
          )
        )
        .returning();
      if (rolledBack.length === 0) {
        // Optimistic guard did not match — either another instance
        // claimed in between, or a PG timestamp-precision mismatch
        // defeated the equality check. Route through ErrorLogger so
        // this triggers alerting, not just a console warning.
        const msg = `Rollback WHERE guard matched zero rows for config ${config.id}; the config row may remain in a permanently advanced state. Recovery: UPDATE automated_campaign_configs SET last_run_at = NULL, next_run_at = NULL, updated_at = NOW() WHERE id = ${config.id};`;
        console.warn(`[Bootstrap] ${msg}`);
        try {
          await ErrorLogger.error("scheduler", msg, null, { configId: config.id, configKey: config.key });
        } catch { /* already logged to console */ }
      }
    } catch (rollbackError) {
      // Belt-and-suspenders: log to console too, in case ErrorLogger
      // itself is failing because the DB is the root cause of both.
      console.error(
        `[Bootstrap] Welcome campaign bootstrap rollback failed:`,
        rollbackError instanceof Error ? rollbackError.message : rollbackError,
      );
      try {
        await ErrorLogger.error(
          "scheduler",
          "Welcome campaign bootstrap rollback failed",
          rollbackError instanceof Error ? rollbackError : null,
          { configId: config.id, configKey: config.key }
        );
      } catch {
        // Logger itself failed — already logged to console above.
      }
    }

    // Re-throw so the caller (server startup) knows the bootstrap failed —
    // matches the pre-existing behavior where bootstrap errors propagated.
    throw error;
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

  // Exclude users who already received an automated campaign email (terminal
  // delivery statuses only). Guards against duplicates when a prior campaign in
  // the same signup window partially sent before failing and the cron rolled
  // back lastRunAt. See GitHub issue #428.
  //
  // Scope the lookup to users signed up within the current window — the
  // recipient resolution is already constrained by signupAfter/signupBefore on
  // users.created_at, so users outside that window cannot produce duplicates.
  // Without this scope the exclusion list grows unboundedly across runs and
  // would eventually breach pg's bind-parameter limit and balloon the
  // persisted filters jsonb.
  const alreadyReceived = await db
    .selectDistinct({ userId: campaignRecipients.userId })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .innerJoin(users, eq(users.id, campaignRecipients.userId))
    .where(and(
      eq(campaigns.type, "automated"),
      inArray(campaignRecipients.status, [...TERMINAL_RECIPIENT_STATUSES]),
      gte(users.createdAt, signupAfter),
      lte(users.createdAt, signupBefore),
    ));
  const excludeUserIds = alreadyReceived.map((r) => r.userId);

  // Resolve recipients to check if there are any
  const filters = {
    signupAfter: signupAfter.toISOString(),
    signupBefore: signupBefore.toISOString(),
    ...(excludeUserIds.length > 0 ? { excludeUserIds } : {}),
  };
  const recipients = await resolveRecipients(filters);

  if (recipients.length === 0) {
    console.log("[AutoCampaign] Skipped — no new recipients in window");
    return { skipped: true };
  }

  // Create campaign record in draft status (triggerCampaignSend expects draft).
  // Persist the full filters (including excludeUserIds) so triggerCampaignSend's
  // re-resolution applies the same exclusion.
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

  try {
    // Use the existing triggerCampaignSend which handles batching, rate limiting, etc.
    const sendResult = await triggerCampaignSend(campaign.id);

    console.log(`[AutoCampaign] Sent welcome campaign #${campaign.id} to ${sendResult.totalRecipients} recipients.`);

    return { campaignId: campaign.id, totalRecipients: sendResult.totalRecipients };
  } catch (error) {
    // Clean up the orphaned campaign so a retry by the outer claim-rollback
    // path does not leave duplicate rows for the same signup window.
    // - If still in draft: delete it (no emails were sent).
    // - If in "sending": mark as "failed" so it is clearly an orphan, not a
    //   campaign that might still be in progress. This prevents the next cron
    //   run from creating a duplicate campaign record for the same window.
    try {
      await db
        .delete(campaigns)
        .where(
          and(
            eq(campaigns.id, campaign.id),
            eq(campaigns.status, "draft"),
          )
        );
    } catch (cleanupError) {
      console.error(
        `[AutoCampaign] Failed to clean up orphaned draft campaign #${campaign.id}:`,
        cleanupError instanceof Error ? cleanupError.message : cleanupError,
      );
    }
    // Mark a "sending" campaign as "failed" — it won't be deleted (it may
    // have partially sent), but the explicit status prevents confusion in
    // the admin view and avoids stale "sending" records accumulating.
    try {
      await db
        .update(campaigns)
        .set({ status: "failed" })
        .where(
          and(
            eq(campaigns.id, campaign.id),
            eq(campaigns.status, "sending"),
          )
        );
    } catch (markFailedError) {
      console.error(
        `[AutoCampaign] Failed to mark orphaned sending campaign #${campaign.id} as failed:`,
        markFailedError instanceof Error ? markFailedError.message : markFailedError,
      );
    }
    throw error;
  }
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

    // Capture the pre-claim values so we can roll them back if the send fails
    // after we have advanced lastRunAt/nextRunAt. Without rollback, users who
    // signed up during a failed run's window would be permanently excluded
    // from the welcome email (signupAfter would advance past their signup).
    const previousLastRunAt = config.lastRunAt;
    const previousNextRunAt = config.nextRunAt;
    let claimedThisRun = false;

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

      claimedThisRun = true;

      const result = await runWelcomeCampaign({
        signupAfter,
        signupBefore,
        configId: config.id,
      });

      if (!("skipped" in result)) {
        console.log(`[AutoCampaign] Sent welcome campaign #${result.campaignId} to ${result.totalRecipients} recipients. Next run: ${nextRunAt.toISOString()}`);
      }
    } catch (error) {
      // If we successfully claimed the run but then failed to send, restore
      // lastRunAt and nextRunAt so the next cron tick re-attempts the same
      // user window. (See comment above the try block.)
      //
      // Guard the rollback on `lastRunAt === now` so we don't overwrite a
      // successful claim by a concurrent instance that managed to claim
      // between our failure and this rollback.
      if (claimedThisRun) {
        try {
          const rolledBack = await db
            .update(automatedCampaignConfigs)
            .set({
              lastRunAt: previousLastRunAt,
              nextRunAt: previousNextRunAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(automatedCampaignConfigs.id, config.id),
                eq(automatedCampaignConfigs.lastRunAt, now),
              )
            )
            .returning();
          if (rolledBack.length === 0) {
            // Optimistic guard did not match — either a concurrent instance
            // claimed in between, or a PG timestamp-precision mismatch
            // defeated the equality check. Route through ErrorLogger so
            // this triggers alerting, not just a console warning.
            const msg = `Rollback WHERE guard matched zero rows for config '${config.key}' (id=${config.id}); the config row may remain in a permanently advanced state. Recovery: UPDATE automated_campaign_configs SET last_run_at = ${previousLastRunAt ? `'${previousLastRunAt.toISOString()}'` : 'NULL'}, next_run_at = ${previousNextRunAt ? `'${previousNextRunAt.toISOString()}'` : 'NULL'}, updated_at = NOW() WHERE id = ${config.id};`;
            console.warn(`[AutoCampaign] ${msg}`);
            try {
              await ErrorLogger.error("scheduler", msg, null, { configId: config.id, configKey: config.key });
            } catch { /* already logged to console */ }
          }
        } catch (rollbackError) {
          console.error(
            `[AutoCampaign] Automated campaign '${config.key}' rollback failed:`,
            rollbackError instanceof Error ? rollbackError.message : rollbackError,
          );
          try {
            await ErrorLogger.error(
              "scheduler",
              `Automated campaign '${config.key}' rollback failed`,
              rollbackError instanceof Error ? rollbackError : null,
              {
                configId: config.id,
                configKey: config.key,
                previousLastRunAt: previousLastRunAt?.toISOString() ?? null,
                previousNextRunAt: previousNextRunAt?.toISOString() ?? null,
              }
            );
          } catch {
            // Logger itself failed — already logged to console above.
          }
        }
      }

      // Wrap the outer error log in try/catch too: if the DB is the root
      // cause of the send failure, ErrorLogger.error will also throw and
      // abort this for-loop, preventing any remaining configs from being
      // processed. console.error ensures the error is always surfaced.
      try {
        await ErrorLogger.error(
          "scheduler",
          `Automated campaign '${config.key}' failed`,
          error instanceof Error ? error : null,
          { configId: config.id, configKey: config.key, errorMessage: error instanceof Error ? error.message : String(error) }
        );
      } catch (logError) {
        console.error(
          `[AutoCampaign] Automated campaign '${config.key}' failed (and error logger also failed):`,
          error instanceof Error ? error.message : error,
          "log error:",
          logError instanceof Error ? logError.message : logError,
        );
      }
    }
  }
}
