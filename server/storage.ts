import { monitors, monitorChanges, type Monitor, type InsertMonitor, type MonitorChange } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  getMonitors(userId: string): Promise<Monitor[]>;
  getMonitor(id: number): Promise<Monitor | undefined>;
  createMonitor(monitor: InsertMonitor): Promise<Monitor>;
  updateMonitor(id: number, updates: any): Promise<Monitor>;
  deleteMonitor(id: number): Promise<void>;
  
  getMonitorChanges(monitorId: number): Promise<MonitorChange[]>;
  addMonitorChange(monitorId: number, oldValue: string | null, newValue: string | null): Promise<MonitorChange>;
  
  getAllActiveMonitors(): Promise<Monitor[]>;
}

export class DatabaseStorage implements IStorage {
  async getMonitors(userId: string): Promise<Monitor[]> {
    return await db.select().from(monitors).where(eq(monitors.userId, userId)).orderBy(desc(monitors.createdAt));
  }

  async getMonitor(id: number): Promise<Monitor | undefined> {
    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, id));
    return monitor;
  }

  async createMonitor(insertMonitor: InsertMonitor): Promise<Monitor> {
    const [monitor] = await db.insert(monitors).values(insertMonitor).returning();
    return monitor;
  }

  async updateMonitor(id: number, updates: Partial<InsertMonitor>): Promise<Monitor> {
    const [updated] = await db.update(monitors).set(updates).where(eq(monitors.id, id)).returning();
    return updated;
  }

  async deleteMonitor(id: number): Promise<void> {
    await db.delete(monitorChanges).where(eq(monitorChanges.monitorId, id));
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
}

export const storage = new DatabaseStorage();
