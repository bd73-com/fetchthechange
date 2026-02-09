import { db } from "../db";
import { browserlessUsage, errorLogs } from "@shared/schema";
import { BROWSERLESS_CAPS, users, type UserTier } from "@shared/models/auth";
import { sql, eq, and, gte, count, desc } from "drizzle-orm";

function getMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getMonthEnd(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function getMonthResetDate(): string {
  const end = getMonthEnd();
  return end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export class BrowserlessUsageTracker {
  static async getUserMonthlyUsage(userId: string): Promise<number> {
    const monthStart = getMonthStart();
    const result = await db
      .select({ total: count() })
      .from(browserlessUsage)
      .where(
        and(
          eq(browserlessUsage.userId, userId),
          gte(browserlessUsage.timestamp, monthStart)
        )
      );
    return result[0]?.total ?? 0;
  }

  static async getSystemMonthlyUsage(): Promise<number> {
    const monthStart = getMonthStart();
    const result = await db
      .select({ total: count() })
      .from(browserlessUsage)
      .where(gte(browserlessUsage.timestamp, monthStart));
    return result[0]?.total ?? 0;
  }

  static async canUseBrowserless(userId: string, tier: UserTier): Promise<{ allowed: boolean; reason?: string }> {
    const tierCap = BROWSERLESS_CAPS[tier] ?? 0;
    if (tierCap === 0) {
      return { allowed: false, reason: "free_tier" };
    }

    const systemUsage = await this.getSystemMonthlyUsage();
    if (systemUsage >= BROWSERLESS_CAPS.system) {
      return { allowed: false, reason: "system_cap" };
    }

    const userUsage = await this.getUserMonthlyUsage(userId);
    if (userUsage >= tierCap) {
      return { allowed: false, reason: "user_cap" };
    }

    return { allowed: true };
  }

  static async recordUsage(
    userId: string,
    monitorId: number | undefined,
    durationMs: number,
    success: boolean
  ): Promise<void> {
    await db.insert(browserlessUsage).values({
      userId,
      monitorId: monitorId ?? null,
      sessionDurationMs: durationMs,
      success,
    });

    this.checkThresholdAlerts().catch(() => {});
  }

  private static async checkThresholdAlerts(): Promise<void> {
    const systemUsage = await this.getSystemMonthlyUsage();
    const systemCap = BROWSERLESS_CAPS.system;
    const pct = systemUsage / systemCap;

    const thresholds = [
      { key: "95", pct: 0.95, label: "95%" },
      { key: "80", pct: 0.80, label: "80%" },
    ];

    for (const t of thresholds) {
      if (pct >= t.pct) {
        const alertKey = `browserless_alert_${t.key}`;
        const cooldownMs = 6 * 60 * 60 * 1000;
        const cooldownStart = new Date(Date.now() - cooldownMs);

        const recentAlert = await db
          .select({ id: errorLogs.id })
          .from(errorLogs)
          .where(
            and(
              eq(errorLogs.source, "browserless"),
              eq(errorLogs.message, alertKey),
              gte(errorLogs.timestamp, cooldownStart)
            )
          )
          .limit(1);

        if (recentAlert.length === 0) {
          await db.insert(errorLogs).values({
            level: "info",
            source: "browserless",
            message: alertKey,
            context: { threshold: t.label, usage: systemUsage, cap: systemCap },
          });
          await this.sendThresholdEmail(t.label, systemUsage, systemCap);
        }
        break;
      }
    }
  }

  private static async sendThresholdEmail(threshold: string, usage: number, cap: number): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM;
    if (!apiKey || !from) {
      console.log(`[BrowserlessTracker] ${threshold} threshold reached (${usage}/${cap}) — no email configured`);
      return;
    }

    try {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);

      const ownerEmail = process.env.ADMIN_ALERT_EMAIL || from;

      await resend.emails.send({
        from,
        to: ownerEmail,
        subject: `Browserless usage at ${threshold} (${usage}/${cap})`,
        html: `
          <h2>Browserless Usage Alert</h2>
          <p>System usage has reached <strong>${threshold}</strong> of the monthly cap.</p>
          <p><strong>${usage}</strong> of <strong>${cap}</strong> sessions used this month.</p>
          <p>Resets at the end of the current billing month.</p>
        `,
      });
      console.log(`[BrowserlessTracker] Sent ${threshold} threshold alert email`);
    } catch (err) {
      console.error("[BrowserlessTracker] Failed to send threshold alert:", err);
    }
  }

  static async getTopConsumers(limit: number = 10): Promise<Array<{ userId: string; callCount: number }>> {
    const monthStart = getMonthStart();
    const result = await db
      .select({
        userId: browserlessUsage.userId,
        callCount: count(),
      })
      .from(browserlessUsage)
      .where(gte(browserlessUsage.timestamp, monthStart))
      .groupBy(browserlessUsage.userId)
      .orderBy(sql`count(*) DESC`)
      .limit(limit);
    return result.map(r => ({ userId: r.userId, callCount: r.callCount }));
  }

  static async getTierBreakdown(): Promise<Record<string, { users: number; totalCalls: number }>> {
    const monthStart = getMonthStart();
    const result = await db
      .select({
        tier: users.tier,
        userId: browserlessUsage.userId,
        callCount: count(),
      })
      .from(browserlessUsage)
      .innerJoin(users, eq(browserlessUsage.userId, users.id))
      .where(gte(browserlessUsage.timestamp, monthStart))
      .groupBy(users.tier, browserlessUsage.userId);

    const breakdown: Record<string, { users: Set<string>; totalCalls: number }> = {
      free: { users: new Set(), totalCalls: 0 },
      pro: { users: new Set(), totalCalls: 0 },
      power: { users: new Set(), totalCalls: 0 },
    };

    for (const row of result) {
      const tier = row.tier || "free";
      if (!breakdown[tier]) breakdown[tier] = { users: new Set(), totalCalls: 0 };
      breakdown[tier].users.add(row.userId);
      breakdown[tier].totalCalls += row.callCount;
    }

    const output: Record<string, { users: number; totalCalls: number }> = {};
    for (const [tier, data] of Object.entries(breakdown)) {
      output[tier] = { users: data.users.size, totalCalls: data.totalCalls };
    }
    return output;
  }
}
