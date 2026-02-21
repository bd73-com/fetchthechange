// Schema defines all database tables - drizzle-kit push compares this against the DB
import { pgTable, text, serial, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
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
  lastStatus: text("last_status").default("ok").notNull(), // 'ok', 'blocked', 'selector_missing', 'error'
  lastError: text("last_error"),
  active: boolean("active").default(true).notNull(),
  emailEnabled: boolean("email_enabled").default(true).notNull(),
  consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
  pauseReason: text("pause_reason"),
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

export const monitorMetrics = pgTable("monitor_metrics", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitor_id").notNull().references(() => monitors.id),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
  stage: text("stage").notNull(),
  durationMs: integer("duration_ms"),
  status: text("status").notNull(),
  selectorCount: integer("selector_count"),
  blocked: boolean("blocked").default(false).notNull(),
  blockReason: text("block_reason"),
}, (table) => ({
  monitorIdx: index("monitor_metrics_monitor_idx").on(table.monitorId),
  checkedAtIdx: index("monitor_metrics_checked_at_idx").on(table.checkedAt),
}));

export const monitorMetricsRelations = relations(monitorMetrics, ({ one }) => ({
  monitor: one(monitors, {
    fields: [monitorMetrics.monitorId],
    references: [monitors.id],
  }),
}));

export type MonitorMetric = typeof monitorMetrics.$inferSelect;

export const errorLogs = pgTable("error_logs", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(), // last occurrence
  level: text("level").notNull(), // 'error' | 'warning' | 'info'
  source: text("source").notNull(), // 'scraper' | 'email' | 'api' | 'scheduler' | 'stripe'
  errorType: text("error_type"),
  message: text("message").notNull(),
  stackTrace: text("stack_trace"),
  context: jsonb("context"),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  firstOccurrence: timestamp("first_occurrence").defaultNow().notNull(),
  occurrenceCount: integer("occurrence_count").default(1).notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  levelIdx: index("error_logs_level_idx").on(table.level),
  sourceIdx: index("error_logs_source_idx").on(table.source),
  timestampIdx: index("error_logs_timestamp_idx").on(table.timestamp),
}));

export type ErrorLog = typeof errorLogs.$inferSelect;

export const browserlessUsage = pgTable("browserless_usage", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  monitorId: integer("monitor_id").references(() => monitors.id),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  sessionDurationMs: integer("session_duration_ms"),
  success: boolean("success").notNull(),
}, (table) => [
  index("idx_browserless_usage_user_timestamp").on(table.userId, table.timestamp),
]);

export type BrowserlessUsageRecord = typeof browserlessUsage.$inferSelect;

export const resendUsage = pgTable("resend_usage", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitor_id").references(() => monitors.id),
  userId: text("user_id").notNull().references(() => users.id),
  recipientEmail: text("recipient_email").notNull(),
  resendId: text("resend_id"),
  success: boolean("success").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("idx_resend_usage_timestamp").on(table.timestamp),
]);

export type ResendUsageRecord = typeof resendUsage.$inferSelect;

// Email campaigns
export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body"),
  status: text("status").default("draft").notNull(), // 'draft' | 'sending' | 'sent' | 'partially_sent' | 'cancelled'
  filters: jsonb("filters"), // { tier?: string[], signupBefore?, signupAfter?, minMonitors?, maxMonitors?, hasActiveMonitors? }
  totalRecipients: integer("total_recipients").default(0).notNull(),
  sentCount: integer("sent_count").default(0).notNull(),
  failedCount: integer("failed_count").default(0).notNull(),
  deliveredCount: integer("delivered_count").default(0).notNull(),
  openedCount: integer("opened_count").default(0).notNull(),
  clickedCount: integer("clicked_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  statusIdx: index("campaigns_status_idx").on(table.status),
  createdAtIdx: index("campaigns_created_at_idx").on(table.createdAt),
}));

export const campaignRecipients = pgTable("campaign_recipients", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id),
  userId: text("user_id").notNull().references(() => users.id),
  recipientEmail: text("recipient_email").notNull(),
  status: text("status").default("pending").notNull(), // 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed'
  resendId: text("resend_id"),
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  failedAt: timestamp("failed_at"),
  failureReason: text("failure_reason"),
}, (table) => ({
  campaignIdx: index("campaign_recipients_campaign_idx").on(table.campaignId),
  userIdx: index("campaign_recipients_user_idx").on(table.userId),
  resendIdIdx: index("campaign_recipients_resend_id_idx").on(table.resendId),
  statusIdx: index("campaign_recipients_status_idx").on(table.status),
}));

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  recipients: many(campaignRecipients),
}));

export const campaignRecipientsRelations = relations(campaignRecipients, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignRecipients.campaignId],
    references: [campaigns.id],
  }),
  user: one(users, {
    fields: [campaignRecipients.userId],
    references: [users.id],
  }),
}));

export const insertCampaignSchema = createInsertSchema(campaigns).omit({
  id: true,
  totalRecipients: true,
  sentCount: true,
  failedCount: true,
  deliveredCount: true,
  openedCount: true,
  clickedCount: true,
  createdAt: true,
  sentAt: true,
  completedAt: true,
});

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;

export const insertMonitorSchema = createInsertSchema(monitors).omit({
  id: true,
  userId: true,
  lastChecked: true,
  lastChanged: true,
  currentValue: true,
  lastStatus: true,
  lastError: true,
  consecutiveFailures: true,
  pauseReason: true,
  createdAt: true
});

export type Monitor = typeof monitors.$inferSelect;
export type InsertMonitor = z.infer<typeof insertMonitorSchema>;
export type MonitorChange = typeof monitorChanges.$inferSelect;
