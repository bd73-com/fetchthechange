// Schema defines all database tables - drizzle-kit push compares this against the DB
import { pgTable, text, serial, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
  healthAlertSentAt: timestamp("health_alert_sent_at"),
  lastHealthyAt: timestamp("last_healthy_at"),
  pendingRetryAt: timestamp("pending_retry_at"),
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
  notificationPreferences: one(notificationPreferences),
  notificationQueue: many(notificationQueue),
  notificationChannels: many(notificationChannels),
  deliveryLogs: many(deliveryLog),
  monitorTags: many(monitorTags),
  monitorConditions: many(monitorConditions),
  automationSubscriptions: many(automationSubscriptions),
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
  source: text("source").notNull(), // see ERROR_LOG_SOURCES in shared/routes.ts
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
  type: text("type").default("manual").notNull(), // 'manual' | 'automated'
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
  resendIdIdx: uniqueIndex("campaign_recipients_resend_id_idx")
    .on(table.resendId)
    .where(sql`resend_id IS NOT NULL`),
  statusIdx: index("campaign_recipients_status_idx").on(table.status),
  campaignUserUniq: uniqueIndex("campaign_recipients_campaign_user_uniq").on(table.campaignId, table.userId),
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

// Automated campaign configurations
export const automatedCampaignConfigs = pgTable("automated_campaign_configs", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body"),
  enabled: boolean("enabled").default(true).notNull(),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAutomatedCampaignConfigSchema = createInsertSchema(automatedCampaignConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AutomatedCampaignConfig = typeof automatedCampaignConfigs.$inferSelect;
export type InsertAutomatedCampaignConfig = typeof automatedCampaignConfigs.$inferInsert;

export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitor_id").notNull().unique().references(() => monitors.id, { onDelete: "cascade" }),
  quietHoursStart: text("quiet_hours_start"),
  quietHoursEnd: text("quiet_hours_end"),
  timezone: text("timezone"),
  digestMode: boolean("digest_mode").default(false).notNull(),
  sensitivityThreshold: integer("sensitivity_threshold").default(0).notNull(),
  notificationEmail: text("notification_email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  monitorIdx: index("notification_preferences_monitor_idx").on(table.monitorId),
}));

export const notificationQueue = pgTable("notification_queue", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  changeId: integer("change_id").notNull().references(() => monitorChanges.id),
  reason: text("reason").notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  delivered: boolean("delivered").default(false).notNull(),
  deliveredAt: timestamp("delivered_at"),
  attempts: integer("attempts").default(0).notNull(),
  permanentlyFailed: boolean("permanently_failed").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  monitorIdx: index("notification_queue_monitor_idx").on(table.monitorId),
  scheduledIdx: index("notification_queue_scheduled_idx").on(table.scheduledFor),
  deliveredIdx: index("notification_queue_delivered_idx").on(table.delivered),
  permanentlyFailedIdx: index("notification_queue_permanently_failed_idx").on(table.permanentlyFailed),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  monitor: one(monitors, {
    fields: [notificationPreferences.monitorId],
    references: [monitors.id],
  }),
}));

export const notificationQueueRelations = relations(notificationQueue, ({ one }) => ({
  monitor: one(monitors, {
    fields: [notificationQueue.monitorId],
    references: [monitors.id],
  }),
  change: one(monitorChanges, {
    fields: [notificationQueue.changeId],
    references: [monitorChanges.id],
  }),
}));

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = typeof notificationPreferences.$inferInsert;
export type NotificationQueueEntry = typeof notificationQueue.$inferSelect;

// Notification channels — per-monitor delivery channel configuration
export const notificationChannels = pgTable("notification_channels", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(), // "email" | "webhook" | "slack"
  enabled: boolean("enabled").default(true).notNull(),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  monitorIdx: index("notification_channels_monitor_idx").on(table.monitorId),
  monitorChannelUniq: uniqueIndex("notification_channels_monitor_channel_uniq").on(table.monitorId, table.channel),
}));

export const notificationChannelsRelations = relations(notificationChannels, ({ one }) => ({
  monitor: one(monitors, {
    fields: [notificationChannels.monitorId],
    references: [monitors.id],
  }),
}));

export type NotificationChannel = typeof notificationChannels.$inferSelect;

// Delivery log — records every notification delivery attempt across all channels
export const deliveryLog = pgTable("delivery_log", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  changeId: integer("change_id").notNull().references(() => monitorChanges.id),
  channel: text("channel").notNull(), // "email" | "webhook" | "slack"
  status: text("status").notNull(), // "success" | "failed" | "pending"
  attempt: integer("attempt").default(1).notNull(),
  response: jsonb("response").$type<Record<string, unknown> | null>(),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  monitorCreatedIdx: index("delivery_log_monitor_created_idx").on(table.monitorId, table.createdAt),
  channelStatusAttemptIdx: index("delivery_log_channel_status_attempt_idx").on(table.channel, table.status, table.createdAt, table.attempt),
}));

export const deliveryLogRelations = relations(deliveryLog, ({ one }) => ({
  monitor: one(monitors, {
    fields: [deliveryLog.monitorId],
    references: [monitors.id],
  }),
  change: one(monitorChanges, {
    fields: [deliveryLog.changeId],
    references: [monitorChanges.id],
  }),
}));

export type DeliveryLogEntry = typeof deliveryLog.$inferSelect;

// Slack connections — one per user, stores OAuth bot token
export const slackConnections = pgTable("slack_connections", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  teamId: text("team_id").notNull(),
  teamName: text("team_name").notNull(),
  botToken: text("bot_token").notNull(), // encrypted with AES-256-GCM
  scope: text("scope").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const slackConnectionsRelations = relations(slackConnections, ({ one }) => ({
  user: one(users, {
    fields: [slackConnections.userId],
    references: [users.id],
  }),
}));

export type SlackConnection = typeof slackConnections.$inferSelect;

// API keys — per-user keys for the public REST API (Power tier only)
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
}, (table) => ({
  userRevokedIdx: index("api_keys_user_revoked_idx").on(table.userId, table.revokedAt),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

// Tags — per-user labels for organising monitors
export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  nameLower: text("name_lower").notNull(),
  colour: text("colour").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("tags_user_idx").on(table.userId),
  userNameUniq: uniqueIndex("tags_user_name_lower_uniq").on(table.userId, table.nameLower),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  user: one(users, {
    fields: [tags.userId],
    references: [users.id],
  }),
  monitorTags: many(monitorTags),
}));

export type Tag = typeof tags.$inferSelect;
export type InsertTag = typeof tags.$inferInsert;

// Monitor-Tag join table — many-to-many
export const monitorTags = pgTable("monitor_tags", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  tagId: integer("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  monitorTagUniq: uniqueIndex("monitor_tags_monitor_tag_uniq").on(table.monitorId, table.tagId),
}));

export const monitorTagsRelations = relations(monitorTags, ({ one }) => ({
  monitor: one(monitors, {
    fields: [monitorTags.monitorId],
    references: [monitors.id],
  }),
  tag: one(tags, {
    fields: [monitorTags.tagId],
    references: [tags.id],
  }),
}));

export type MonitorTag = typeof monitorTags.$inferSelect;

// Monitor conditions — per-monitor alert conditions that gate notifications
// SYNC: raw DDL mirror lives in server/services/ensureTables.ts — keep both in sync
export const monitorConditions = pgTable("monitor_conditions", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitor_id")
    .notNull()
    .references(() => monitors.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  // 'numeric_lt' | 'numeric_lte' | 'numeric_gt' | 'numeric_gte' |
  // 'numeric_change_pct' | 'text_contains' | 'text_not_contains' |
  // 'text_equals' | 'regex'
  value: text("value").notNull(),  // threshold number as string, or text/regex pattern
  groupIndex: integer("group_index").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  monitorIdx: index("monitor_conditions_monitor_idx").on(table.monitorId),
}));

export const monitorConditionsRelations = relations(monitorConditions, ({ one }) => ({
  monitor: one(monitors, {
    fields: [monitorConditions.monitorId],
    references: [monitors.id],
  }),
}));

export type MonitorCondition = typeof monitorConditions.$inferSelect;
export type InsertMonitorCondition = typeof monitorConditions.$inferInsert;

// Automation subscriptions — Zapier REST Hooks and future platform integrations
export const automationSubscriptions = pgTable("automation_subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  platform: text("platform").notNull(), // 'zapier'
  hookUrl: text("hook_url").notNull(),
  monitorId: integer("monitor_id").references(() => monitors.id, { onDelete: "cascade" }),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastDeliveredAt: timestamp("last_delivered_at"),
}, (table) => ({
  userIdx: index("automation_subscriptions_user_idx").on(table.userId),
  platformIdx: index("automation_subscriptions_platform_idx").on(table.platform),
}));

export const automationSubscriptionsRelations = relations(automationSubscriptions, ({ one }) => ({
  user: one(users, { fields: [automationSubscriptions.userId], references: [users.id] }),
  monitor: one(monitors, { fields: [automationSubscriptions.monitorId], references: [monitors.id] }),
}));

export type AutomationSubscription = typeof automationSubscriptions.$inferSelect;
export type InsertAutomationSubscription = typeof automationSubscriptions.$inferInsert;

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
  healthAlertSentAt: true,
  lastHealthyAt: true,
  pendingRetryAt: true,
  createdAt: true
});

export type Monitor = typeof monitors.$inferSelect;
export type InsertMonitor = z.infer<typeof insertMonitorSchema>;
export type MonitorChange = typeof monitorChanges.$inferSelect;
