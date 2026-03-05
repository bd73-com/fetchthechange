import { monitors, monitorChanges, monitorMetrics, browserlessUsage, resendUsage, notificationPreferences, notificationQueue, notificationChannels, deliveryLog, slackConnections, apiKeys, type Monitor, type InsertMonitor, type MonitorChange, type NotificationPreference, type NotificationQueueEntry, type NotificationChannel, type DeliveryLogEntry, type SlackConnection, type ApiKey } from "@shared/schema";
import { users, type User } from "@shared/models/auth";
import { db } from "./db";
import { eq, desc, and, or, isNull, lte, lt, gte, sql } from "drizzle-orm";
import { notificationTablesExist } from "./services/notificationReady";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getMonitors(userId: string): Promise<Monitor[]>;
  getMonitor(id: number): Promise<Monitor | undefined>;
  getMonitorCount(userId: string): Promise<number>;
  createMonitor(monitor: InsertMonitor): Promise<Monitor>;
  updateMonitor(id: number, updates: any): Promise<Monitor>;
  deleteMonitor(id: number): Promise<void>;
  
  getMonitorChanges(monitorId: number): Promise<MonitorChange[]>;
  addMonitorChange(monitorId: number, oldValue: string | null, newValue: string | null): Promise<MonitorChange>;
  
  getAllActiveMonitors(): Promise<Monitor[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getMonitors(userId: string): Promise<Monitor[]> {
    return await db.select().from(monitors).where(eq(monitors.userId, userId)).orderBy(desc(monitors.createdAt));
  }

  async getMonitor(id: number): Promise<Monitor | undefined> {
    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, id));
    return monitor;
  }

  async getMonitorCount(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(monitors)
      .where(eq(monitors.userId, userId));
    return Number(result[0]?.count ?? 0);
  }

  async createMonitor(insertMonitor: any): Promise<Monitor> {
    const [monitor] = await db.insert(monitors).values(insertMonitor).returning();
    return monitor;
  }

  async updateMonitor(id: number, updates: Partial<InsertMonitor>): Promise<Monitor> {
    const [updated] = await db.update(monitors).set(updates).where(eq(monitors.id, id)).returning();
    return updated;
  }

  async deleteMonitor(id: number): Promise<void> {
    if (await notificationTablesExist()) {
      await db.delete(notificationQueue).where(eq(notificationQueue.monitorId, id));
      await db.delete(notificationPreferences).where(eq(notificationPreferences.monitorId, id));
    }
    await db.delete(deliveryLog).where(eq(deliveryLog.monitorId, id));
    await db.delete(notificationChannels).where(eq(notificationChannels.monitorId, id));
    await db.delete(monitorChanges).where(eq(monitorChanges.monitorId, id));
    await db.delete(monitorMetrics).where(eq(monitorMetrics.monitorId, id));
    await db.delete(browserlessUsage).where(eq(browserlessUsage.monitorId, id));
    await db.delete(resendUsage).where(eq(resendUsage.monitorId, id));
    await db.delete(monitors).where(eq(monitors.id, id));
  }

  async getMonitorChanges(monitorId: number): Promise<MonitorChange[]> {
    return await db.select()
      .from(monitorChanges)
      .where(eq(monitorChanges.monitorId, monitorId))
      .orderBy(desc(monitorChanges.detectedAt));
  }

  async addMonitorChange(monitorId: number, oldValue: string | null, newValue: string | null): Promise<MonitorChange> {
    const [change] = await db.insert(monitorChanges).values({
      monitorId,
      oldValue,
      newValue,
    }).returning();
    return change;
  }

  async getAllActiveMonitors(): Promise<Monitor[]> {
    return await db.select().from(monitors).where(eq(monitors.active, true));
  }

  async getNotificationPreferences(monitorId: number): Promise<NotificationPreference | undefined> {
    const [prefs] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.monitorId, monitorId));
    return prefs;
  }

  async upsertNotificationPreferences(monitorId: number, data: Partial<Omit<NotificationPreference, "id" | "monitorId" | "createdAt" | "updatedAt">>): Promise<NotificationPreference> {
    const [result] = await db.insert(notificationPreferences)
      .values({ monitorId, ...data })
      .onConflictDoUpdate({
        target: notificationPreferences.monitorId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return result;
  }

  async deleteNotificationPreferences(monitorId: number): Promise<void> {
    await db.delete(notificationPreferences).where(eq(notificationPreferences.monitorId, monitorId));
  }

  async queueNotification(monitorId: number, changeId: number, reason: string, scheduledFor: Date): Promise<NotificationQueueEntry> {
    const [entry] = await db.insert(notificationQueue)
      .values({ monitorId, changeId, reason, scheduledFor })
      .returning();
    return entry;
  }

  async getUndeliveredQueueEntries(monitorId: number): Promise<NotificationQueueEntry[]> {
    return await db.select().from(notificationQueue)
      .where(and(
        eq(notificationQueue.monitorId, monitorId),
        eq(notificationQueue.delivered, false)
      ))
      .orderBy(notificationQueue.createdAt);
  }

  async getPendingDigestEntries(monitorId: number): Promise<NotificationQueueEntry[]> {
    return await db.select().from(notificationQueue)
      .where(and(
        eq(notificationQueue.monitorId, monitorId),
        eq(notificationQueue.reason, "digest"),
        eq(notificationQueue.delivered, false)
      ))
      .orderBy(notificationQueue.createdAt);
  }

  async getReadyQueueEntries(before: Date): Promise<NotificationQueueEntry[]> {
    return await db.select().from(notificationQueue)
      .where(and(
        eq(notificationQueue.delivered, false),
        lte(notificationQueue.scheduledFor, before)
      ))
      .orderBy(notificationQueue.scheduledFor);
  }

  async markQueueEntryDelivered(id: number): Promise<void> {
    await db.update(notificationQueue)
      .set({ delivered: true, deliveredAt: new Date() })
      .where(eq(notificationQueue.id, id));
  }

  async markQueueEntriesDelivered(ids: number[]): Promise<void> {
    for (const id of ids) {
      await this.markQueueEntryDelivered(id);
    }
  }

  async getStaleQueueEntries(olderThan: Date): Promise<NotificationQueueEntry[]> {
    return await db.select().from(notificationQueue)
      .where(and(
        eq(notificationQueue.delivered, false),
        lte(notificationQueue.createdAt, olderThan)
      ));
  }

  async getAllDigestMonitorPreferences(): Promise<NotificationPreference[]> {
    return await db.select().from(notificationPreferences)
      .where(eq(notificationPreferences.digestMode, true));
  }

  async cleanupPollutedValues(): Promise<number> {
    let cleanedCount = 0;
    
    // Clean polluted monitor currentValues
    const pollutedMonitors = await db.select().from(monitors).where(
      eq(monitors.currentValue, "Blocked/Unavailable")
    );
    
    for (const m of pollutedMonitors) {
      await db.update(monitors).set({ currentValue: null }).where(eq(monitors.id, m.id));
      cleanedCount++;
      console.log(`[Cleanup] Reset polluted currentValue for monitor ${m.id}: "${m.name}"`);
    }
    
    // Clean polluted history entries with "Blocked/Unavailable"
    const pollutedHistory = await db.select().from(monitorChanges).where(
      or(
        eq(monitorChanges.oldValue, "Blocked/Unavailable"),
        eq(monitorChanges.newValue, "Blocked/Unavailable")
      )
    );
    
    for (const h of pollutedHistory) {
      await db.delete(monitorChanges).where(eq(monitorChanges.id, h.id));
      cleanedCount++;
      console.log(`[Cleanup] Deleted polluted history entry ${h.id} for monitor ${h.monitorId}`);
    }
    
    if (cleanedCount > 0) {
      console.log(`[Cleanup] Cleaned ${cleanedCount} polluted records total`);
    }
    return cleanedCount;
  }

  // Notification channels
  async getMonitorChannels(monitorId: number): Promise<NotificationChannel[]> {
    return await db.select().from(notificationChannels)
      .where(eq(notificationChannels.monitorId, monitorId));
  }

  async upsertMonitorChannel(monitorId: number, channel: string, enabled: boolean, config: Record<string, unknown>): Promise<NotificationChannel> {
    const [result] = await db.insert(notificationChannels)
      .values({ monitorId, channel, enabled, config })
      .onConflictDoUpdate({
        target: [notificationChannels.monitorId, notificationChannels.channel],
        set: { enabled, config, updatedAt: new Date() },
      })
      .returning();
    return result;
  }

  async deleteMonitorChannel(monitorId: number, channel: string): Promise<void> {
    await db.delete(notificationChannels).where(
      and(eq(notificationChannels.monitorId, monitorId), eq(notificationChannels.channel, channel))
    );
  }

  // Delivery log
  async addDeliveryLog(entry: { monitorId: number; changeId: number; channel: string; status: string; attempt?: number; response?: Record<string, unknown> | null; deliveredAt?: Date | null }): Promise<DeliveryLogEntry> {
    const [result] = await db.insert(deliveryLog)
      .values({
        monitorId: entry.monitorId,
        changeId: entry.changeId,
        channel: entry.channel,
        status: entry.status,
        attempt: entry.attempt ?? 1,
        response: entry.response ?? null,
        deliveredAt: entry.deliveredAt ?? null,
      })
      .returning();
    return result;
  }

  async getDeliveryLog(monitorId: number, limit: number, channelFilter?: string): Promise<DeliveryLogEntry[]> {
    const conditions = [eq(deliveryLog.monitorId, monitorId)];
    if (channelFilter) {
      conditions.push(eq(deliveryLog.channel, channelFilter));
    }
    return await db.select().from(deliveryLog)
      .where(and(...conditions))
      .orderBy(desc(deliveryLog.createdAt))
      .limit(limit);
  }

  async updateDeliveryLog(id: number, updates: Partial<Pick<DeliveryLogEntry, "status" | "attempt" | "response" | "deliveredAt">>): Promise<void> {
    await db.update(deliveryLog).set(updates).where(eq(deliveryLog.id, id));
  }

  async getPendingWebhookRetries(): Promise<DeliveryLogEntry[]> {
    return await db.select().from(deliveryLog)
      .where(and(
        eq(deliveryLog.channel, "webhook"),
        eq(deliveryLog.status, "pending"),
        lt(deliveryLog.attempt, 3)
      ))
      .orderBy(deliveryLog.createdAt);
  }

  async cleanupOldDeliveryLogs(olderThan: Date): Promise<number> {
    const result = await db.delete(deliveryLog)
      .where(lt(deliveryLog.createdAt, olderThan));
    return (result as any).rowCount ?? 0;
  }

  // Slack connections
  async getSlackConnection(userId: string): Promise<SlackConnection | undefined> {
    const [conn] = await db.select().from(slackConnections)
      .where(eq(slackConnections.userId, userId));
    return conn;
  }

  async upsertSlackConnection(data: { userId: string; teamId: string; teamName: string; botToken: string; scope: string }): Promise<SlackConnection> {
    const [result] = await db.insert(slackConnections)
      .values(data)
      .onConflictDoUpdate({
        target: slackConnections.userId,
        set: { teamId: data.teamId, teamName: data.teamName, botToken: data.botToken, scope: data.scope, updatedAt: new Date() },
      })
      .returning();
    return result;
  }

  async deleteSlackConnection(userId: string): Promise<void> {
    await db.delete(slackConnections).where(eq(slackConnections.userId, userId));
  }

  async deleteSlackChannelsForUser(userId: string): Promise<void> {
    const userMonitors = await db.select({ id: monitors.id }).from(monitors)
      .where(eq(monitors.userId, userId));
    for (const m of userMonitors) {
      await db.delete(notificationChannels).where(
        and(eq(notificationChannels.monitorId, m.id), eq(notificationChannels.channel, "slack"))
      );
    }
  }

  // API keys
  async createApiKey(userId: string, name: string, keyHash: string, keyPrefix: string): Promise<ApiKey> {
    const [key] = await db.insert(apiKeys).values({ userId, name, keyHash, keyPrefix }).returning();
    return key;
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined> {
    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash));
    return key;
  }

  async listApiKeys(userId: string): Promise<ApiKey[]> {
    return await db.select().from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt));
  }

  async countActiveApiKeys(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
    return Number(result[0]?.count ?? 0);
  }

  async revokeApiKey(id: number, userId: string): Promise<boolean> {
    const result = await db.update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
    return (result as any).rowCount > 0;
  }

  async touchApiKey(id: number): Promise<void> {
    await db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, id));
  }

  // Monitor changes with date filtering (for API v1)
  async getMonitorChangesPaginated(monitorId: number, options: {
    page: number;
    limit: number;
    from?: Date;
    to?: Date;
  }): Promise<{ data: MonitorChange[]; total: number }> {
    const conditions = [eq(monitorChanges.monitorId, monitorId)];
    if (options.from) {
      conditions.push(gte(monitorChanges.detectedAt, options.from));
    }
    if (options.to) {
      conditions.push(lte(monitorChanges.detectedAt, options.to));
    }
    const where = and(...conditions);

    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(monitorChanges)
      .where(where);
    const total = Number(countResult[0]?.count ?? 0);

    const data = await db.select()
      .from(monitorChanges)
      .where(where)
      .orderBy(desc(monitorChanges.detectedAt))
      .limit(options.limit)
      .offset((options.page - 1) * options.limit);

    return { data, total };
  }

  // Paginated monitors list (for API v1)
  async getMonitorsPaginated(userId: string, page: number, limit: number): Promise<{ data: Monitor[]; total: number }> {
    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(monitors)
      .where(eq(monitors.userId, userId));
    const total = Number(countResult[0]?.count ?? 0);

    const data = await db.select()
      .from(monitors)
      .where(eq(monitors.userId, userId))
      .orderBy(desc(monitors.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return { data, total };
  }
}

export const storage = new DatabaseStorage();
