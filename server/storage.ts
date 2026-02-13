import { monitors, monitorChanges, browserlessUsage, resendUsage, type Monitor, type InsertMonitor, type MonitorChange } from "@shared/schema";
import { users, type User } from "@shared/models/auth";
import { db } from "./db";
import { eq, desc, and, or, isNull, sql } from "drizzle-orm";

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
    await db.delete(monitorChanges).where(eq(monitorChanges.monitorId, id));
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
}

export const storage = new DatabaseStorage();
