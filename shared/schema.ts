import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth";
import { relations } from "drizzle-orm";

// Export auth models so they are included in migrations
export * from "./models/auth";

export const monitors = pgTable("monitors", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  url: text("url").notNull(),
  selector: text("selector").notNull(),
  frequency: text("frequency").default("daily").notNull(), // 'daily', 'hourly'
  lastChecked: timestamp("last_checked"),
  lastChanged: timestamp("last_changed"),
  currentValue: text("current_value"),
  active: boolean("active").default(true).notNull(),
  emailEnabled: boolean("email_enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const monitorChanges = pgTable("monitor_changes", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitor_id").notNull().references(() => monitors.id),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
});

export const monitorsRelations = relations(monitors, ({ one, many }) => ({
  user: one(users, {
    fields: [monitors.userId],
    references: [users.id],
  }),
  changes: many(monitorChanges),
}));

export const monitorChangesRelations = relations(monitorChanges, ({ one }) => ({
  monitor: one(monitors, {
    fields: [monitorChanges.monitorId],
    references: [monitors.id],
  }),
}));

export const insertMonitorSchema = createInsertSchema(monitors).omit({ 
  id: true, 
  userId: true, 
  lastChecked: true, 
  lastChanged: true, 
  currentValue: true,
  createdAt: true 
});

export type Monitor = typeof monitors.$inferSelect;
export type InsertMonitor = z.infer<typeof insertMonitorSchema>;
export type MonitorChange = typeof monitorChanges.$inferSelect;
