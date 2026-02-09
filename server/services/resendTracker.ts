import { db } from "../db";
import { resendUsage, errorLogs } from "@shared/schema";
import { RESEND_CAPS } from "@shared/models/auth";
import { sql, eq, and, gte, count, desc } from "drizzle-orm";

function getMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getDayStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getMonthEnd(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function getResendResetDate(): string {
  const end = getMonthEnd();
  return end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export class ResendUsageTracker {
  static async getDailyUsage(): Promise<number> {
    const dayStart = getDayStart();
    const result = await db
      .select({ total: count() })
      .from(resendUsage)
      .where(gte(resendUsage.timestamp, dayStart));
    return result[0]?.total ?? 0;
  }

  static async getMonthlyUsage(): Promise<number> {
    const monthStart = getMonthStart();
    const result = await db
      .select({ total: count() })
      .from(resendUsage)
      .where(gte(resendUsage.timestamp, monthStart));
    return result[0]?.total ?? 0;
  }

  static async canSendEmail(): Promise<{ allowed: boolean; reason?: string }> {
    const dailyUsage = await this.getDailyUsage();
    if (dailyUsage >= RESEND_CAPS.daily) {
      return { allowed: false, reason: `Daily cap reached (${dailyUsage}/${RESEND_CAPS.daily})` };
    }

    const monthlyUsage = await this.getMonthlyUsage();
    if (monthlyUsage >= RESEND_CAPS.monthly) {
      return { allowed: false, reason: `Monthly cap reached (${monthlyUsage}/${RESEND_CAPS.monthly})` };
    }

    return { allowed: true };
  }

  static async recordUsage(
    userId: string,
    monitorId: number | undefined,
    recipientEmail: string,
    resendId: string | undefined,
    success: boolean
  ): Promise<void> {
    await db.insert(resendUsage).values({
      userId,
      monitorId: monitorId ?? null,
      recipientEmail,
      resendId: resendId ?? null,
      success,
    });

    if (success) {
      this.checkThresholdAlerts().catch(() => {});
    }
  }

  private static async checkThresholdAlerts(): Promise<void> {
    const monthlyUsage = await this.getMonthlyUsage();
    const monthlyCap = RESEND_CAPS.monthly;
    const pct = monthlyUsage / monthlyCap;

    const thresholds = [
      { key: "95", pct: 0.95, label: "95%" },
      { key: "80", pct: 0.80, label: "80%" },
    ];

    for (const t of thresholds) {
      if (pct >= t.pct) {
        const alertKey = `resend_alert_${t.key}`;
        const cooldownMs = 6 * 60 * 60 * 1000;
        const cooldownStart = new Date(Date.now() - cooldownMs);

        const recentAlert = await db
          .select({ id: errorLogs.id })
          .from(errorLogs)
          .where(
            and(
              eq(errorLogs.source, "resend"),
              eq(errorLogs.message, alertKey),
              gte(errorLogs.timestamp, cooldownStart)
            )
          )
          .limit(1);

        if (recentAlert.length === 0) {
          await db.insert(errorLogs).values({
            level: "warning",
            source: "resend",
            message: alertKey,
            context: { threshold: t.label, usage: monthlyUsage, cap: monthlyCap },
          });
          console.log(`[ResendTracker] Monthly usage at ${t.label}: ${monthlyUsage}/${monthlyCap}`);
        }
        break;
      }
    }

    const dailyUsage = await this.getDailyUsage();
    const dailyCap = RESEND_CAPS.daily;
    const dailyPct = dailyUsage / dailyCap;
    if (dailyPct >= 0.9) {
      const alertKey = `resend_daily_alert_90`;
      const cooldownMs = 6 * 60 * 60 * 1000;
      const cooldownStart = new Date(Date.now() - cooldownMs);

      const recentAlert = await db
        .select({ id: errorLogs.id })
        .from(errorLogs)
        .where(
          and(
            eq(errorLogs.source, "resend"),
            eq(errorLogs.message, alertKey),
            gte(errorLogs.timestamp, cooldownStart)
          )
        )
        .limit(1);

      if (recentAlert.length === 0) {
        await db.insert(errorLogs).values({
          level: "warning",
          source: "resend",
          message: alertKey,
          context: { threshold: "90% daily", usage: dailyUsage, cap: dailyCap },
        });
        console.log(`[ResendTracker] Daily usage at 90%: ${dailyUsage}/${dailyCap}`);
      }
    }
  }

  static async getRecentHistory(days: number = 7): Promise<Array<{ date: string; count: number }>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const result = await db.execute(sql`
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) FILTER (WHERE success = true) as count
      FROM resend_usage
      WHERE timestamp >= ${startDate}
      GROUP BY DATE(timestamp)
      ORDER BY DATE(timestamp) DESC
    `);

    return (result.rows as any[]).map(r => ({
      date: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      count: Number(r.count),
    }));
  }

  static async getTotalFailed(sinceMonthStart: boolean = true): Promise<number> {
    const start = sinceMonthStart ? getMonthStart() : getDayStart();
    const result = await db
      .select({ total: count() })
      .from(resendUsage)
      .where(
        and(
          gte(resendUsage.timestamp, start),
          eq(resendUsage.success, false)
        )
      );
    return result[0]?.total ?? 0;
  }
}
