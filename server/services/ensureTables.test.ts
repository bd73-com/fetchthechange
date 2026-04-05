import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { notificationChannels, deliveryLog, slackConnections, monitorConditions, automatedCampaignConfigs, automationSubscriptions } from "@shared/schema";

const mockExecute = vi.fn();

vi.mock("../db", () => ({
  db: {
    execute: (...args: any[]) => mockExecute(...args),
    transaction: async (fn: (tx: any) => Promise<any>) => {
      // Provide a tx object that delegates to the same mockExecute
      const tx = { execute: (...args: any[]) => mockExecute(...args) };
      return fn(tx);
    },
  },
}));

// Mock encryption utilities used by ensureAutomationSubscriptionsTable backfill
vi.mock("../utils/encryption", () => ({
  encryptUrl: (url: string) => `encrypted:${url}`,
  decryptToken: (v: string) => v.replace("encrypted:", ""),
  hashUrl: (url: string) => `hash:${url}`,
  isValidEncryptedToken: (v: string) => v.startsWith("encrypted:"),
  isEncryptionAvailable: () => true,
}));

import { ensureMonitorHealthColumns, ensureErrorLogColumns, ensureApiKeysTable, ensureChannelTables, ensureMonitorConditionsTable, ensureNotificationQueueColumns, ensureAutomatedCampaignConfigsTable, ensureMonitorPendingRetryColumn, ensureAutomationSubscriptionsTable, ensureMonitorChangesIndexes } from "./ensureTables";

describe("ensureMonitorHealthColumns", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("executes 2 ALTER TABLE statements and returns true", async () => {
    mockExecute.mockResolvedValue([]);
    const result = await ensureMonitorHealthColumns();
    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("emits correct DDL for health_alert_sent_at and last_healthy_at", async () => {
    mockExecute.mockResolvedValue([]);
    await ensureMonitorHealthColumns();
    const statements = mockExecute.mock.calls.map(([arg]: any) => {
      try { return JSON.stringify(arg); } catch { return String(arg); }
    });
    expect(statements.some((s: string) => s.includes("health_alert_sent_at"))).toBe(true);
    expect(statements.some((s: string) => s.includes("last_healthy_at"))).toBe(true);
  });

  it("returns false and does not throw on error", async () => {
    mockExecute.mockRejectedValue(new Error("permission denied"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await ensureMonitorHealthColumns();
    expect(result).toBe(false);
    errorSpy.mockRestore();
  });

  it("logs an error when migration fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("permission denied"));
    await ensureMonitorHealthColumns();
    expect(errorSpy).toHaveBeenCalledWith(
      "Could not ensure monitor health columns — health alerts will not work:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

describe("ensureErrorLogColumns", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("executes 3 ALTER TABLE statements without throwing", async () => {
    mockExecute.mockResolvedValue([]);
    await ensureErrorLogColumns();
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it("catches errors and does not throw", async () => {
    mockExecute.mockRejectedValue(new Error("permission denied"));
    await expect(ensureErrorLogColumns()).resolves.toBeUndefined();
  });

  it("logs a warning when an error occurs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("permission denied"));
    await ensureErrorLogColumns();
    expect(warnSpy).toHaveBeenCalledWith(
      "Could not ensure error_logs columns:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

describe("ensureApiKeysTable", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("returns true when CREATE TABLE and CREATE INDEX succeed", async () => {
    mockExecute.mockResolvedValue([]);
    const result = await ensureApiKeysTable();
    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("returns false and logs error when db.execute fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("relation does not exist"));
    const result = await ensureApiKeysTable();
    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "Could not ensure api_keys table — API key routes will be disabled:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

describe("ensureChannelTables", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("executes all CREATE TABLE and CREATE INDEX statements without throwing", async () => {
    mockExecute.mockResolvedValue([]);
    await ensureChannelTables();
    // 3 CREATE TABLE + 1 CREATE INDEX + 1 CREATE UNIQUE INDEX + 2 CREATE INDEX + 1 backfill SELECT = 8
    expect(mockExecute).toHaveBeenCalledTimes(8);
  });

  it("emits CREATE INDEX for delivery_log_channel_status_attempt_idx", async () => {
    mockExecute.mockResolvedValue([]);
    await ensureChannelTables();
    const statements = mockExecute.mock.calls.map(([arg]: any) => {
      try { return JSON.stringify(arg); } catch { return String(arg); }
    });
    expect(statements.some((s: string) => s.includes("delivery_log_channel_status_attempt_idx"))).toBe(true);
  });

  it("catches errors and does not throw", async () => {
    mockExecute.mockRejectedValue(new Error("connection refused"));
    await expect(ensureChannelTables()).resolves.toBeUndefined();
  });

  it("logs error when table creation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("connection refused"));
    await ensureChannelTables();
    expect(errorSpy).toHaveBeenCalledWith(
      "Could not ensure notification channel tables:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

describe("ensureMonitorConditionsTable", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("returns true when CREATE TABLE and CREATE INDEX succeed", async () => {
    mockExecute.mockResolvedValue([]);
    const result = await ensureMonitorConditionsTable();
    expect(result).toBe(true);
    // 1 CREATE TABLE + 1 CREATE INDEX = 2
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("returns false and does not throw on error", async () => {
    mockExecute.mockRejectedValue(new Error("connection refused"));
    const result = await ensureMonitorConditionsTable();
    expect(result).toBe(false);
  });

  it("logs error when table creation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("connection refused"));
    await ensureMonitorConditionsTable();
    expect(errorSpy).toHaveBeenCalledWith(
      "Could not ensure monitor_conditions table:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

describe("ensureNotificationQueueColumns", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("executes 2 ALTER TABLE + 1 CREATE INDEX and returns true", async () => {
    mockExecute.mockResolvedValue([]);
    const result = await ensureNotificationQueueColumns();
    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it("emits correct DDL for attempts, permanently_failed, and index", async () => {
    mockExecute.mockResolvedValue([]);
    await ensureNotificationQueueColumns();
    const statements = mockExecute.mock.calls.map(([arg]: any) => {
      try { return JSON.stringify(arg); } catch { return String(arg); }
    });
    expect(statements.some((s: string) => s.includes("attempts") && s.includes("INTEGER"))).toBe(true);
    expect(statements.some((s: string) => s.includes("permanently_failed") && s.includes("BOOLEAN"))).toBe(true);
    expect(statements.some((s: string) => s.includes("notification_queue_permanently_failed_idx"))).toBe(true);
  });

  it("catches errors and returns false", async () => {
    mockExecute.mockRejectedValue(new Error("connection refused"));
    await expect(ensureNotificationQueueColumns()).resolves.toBe(false);
  });

  it("logs error when ALTER TABLE fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("connection refused"));
    await ensureNotificationQueueColumns();
    expect(errorSpy).toHaveBeenCalledWith(
      "Could not ensure notification_queue columns:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

describe("ensureAutomatedCampaignConfigsTable", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("returns true when CREATE TABLE succeeds", async () => {
    mockExecute.mockResolvedValue([]);
    const result = await ensureAutomatedCampaignConfigsTable();
    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("emits DDL containing automated_campaign_configs with all expected columns", async () => {
    mockExecute.mockResolvedValue([]);
    await ensureAutomatedCampaignConfigsTable();
    const stmt = JSON.stringify(mockExecute.mock.calls[0][0]);
    expect(stmt).toContain("automated_campaign_configs");
    expect(stmt).toContain("key");
    expect(stmt).toContain("html_body");
    expect(stmt).toContain("enabled");
    expect(stmt).toContain("next_run_at");
  });

  it("returns false and does not throw on error", async () => {
    mockExecute.mockRejectedValue(new Error("connection refused"));
    const result = await ensureAutomatedCampaignConfigsTable();
    expect(result).toBe(false);
  });

  it("logs error when table creation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("connection refused"));
    await ensureAutomatedCampaignConfigsTable();
    expect(errorSpy).toHaveBeenCalledWith(
      "Could not ensure automated_campaign_configs table:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

describe("ensureMonitorPendingRetryColumn", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("executes 1 ALTER TABLE statement and returns true", async () => {
    mockExecute.mockResolvedValue([]);
    const result = await ensureMonitorPendingRetryColumn();
    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("emits correct DDL for pending_retry_at", async () => {
    mockExecute.mockResolvedValue([]);
    await ensureMonitorPendingRetryColumn();
    const stmt = JSON.stringify(mockExecute.mock.calls[0][0]);
    expect(stmt).toContain("pending_retry_at");
    expect(stmt).toContain("TIMESTAMP");
  });

  it("returns false and does not throw on error", async () => {
    mockExecute.mockRejectedValue(new Error("permission denied"));
    const result = await ensureMonitorPendingRetryColumn();
    expect(result).toBe(false);
  });

  it("logs error when ALTER TABLE fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("permission denied"));
    await ensureMonitorPendingRetryColumn();
    expect(errorSpy).toHaveBeenCalledWith(
      "Could not ensure monitors.pending_retry_at column:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

describe("ensureMonitorChangesIndexes", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("creates the composite index", async () => {
    // First call checks pg_index for existing index (returns no rows), second call creates the index
    mockExecute.mockResolvedValue({ rows: [] });
    await ensureMonitorChangesIndexes();
    expect(mockExecute).toHaveBeenCalledTimes(2);
    const stmt = JSON.stringify(mockExecute.mock.calls[1][0]);
    expect(stmt).toContain("monitor_changes_monitor_detected_idx");
    expect(stmt).toContain("monitor_id");
    expect(stmt).toContain("detected_at");
  });

  it("skips CREATE INDEX when a valid index already exists", async () => {
    // First call returns a valid index row
    mockExecute.mockResolvedValueOnce({ rows: [{ indisvalid: true }] });
    await ensureMonitorChangesIndexes();
    // Only the pg_index check should be called, no CREATE INDEX
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("drops invalid index before creating a new one", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // First call: pg_index check returns invalid index
    mockExecute.mockResolvedValueOnce({ rows: [{ indisvalid: false }] });
    // Second call: DROP INDEX
    mockExecute.mockResolvedValueOnce({ rows: [] });
    // Third call: CREATE INDEX CONCURRENTLY
    mockExecute.mockResolvedValueOnce({ rows: [] });
    await ensureMonitorChangesIndexes();
    expect(mockExecute).toHaveBeenCalledTimes(3);
    const dropStmt = JSON.stringify(mockExecute.mock.calls[1][0]);
    expect(dropStmt).toContain("DROP INDEX");
    expect(dropStmt).toContain("monitor_changes_monitor_detected_idx");
    warnSpy.mockRestore();
  });

  it("does not throw on error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("permission denied"));
    await expect(ensureMonitorChangesIndexes()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "Could not ensure monitor_changes indexes:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

describe("ensureAutomationSubscriptionsTable", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("executes CREATE TABLE, indexes, pg_indexes checks, unique indexes, and backfill and returns true", async () => {
    mockExecute.mockResolvedValue({ rows: [] });
    const result = await ensureAutomationSubscriptionsTable();
    expect(result).toBe(true);
    // 1 CREATE TABLE + 3 ALTER TABLE ADD COLUMN + 2 CREATE INDEX + 1 LOCK TABLE + 3 pg_indexes checks + 2 CREATE UNIQUE INDEX + 1 backfill SELECT = 13
    expect(mockExecute).toHaveBeenCalledTimes(13);
  });

  it("drops legacy dedup indexes when they exist", async () => {
    // Return a row from pg_indexes check to simulate old indexes existing (without hook_url_hash)
    mockExecute.mockImplementation((...args: any[]) => {
      const stmt = JSON.stringify(args[0]);
      if (stmt.includes("pg_indexes")) return { rows: [{ indexdef: "CREATE UNIQUE INDEX ON automation_subscriptions(user_id, platform, hook_url)" }] };
      return { rows: [] };
    });
    await ensureAutomationSubscriptionsTable();
    const statements = mockExecute.mock.calls.map(([arg]: any) => {
      try { return JSON.stringify(arg); } catch { return String(arg); }
    });
    expect(statements.some((s: string) => s.includes("DROP INDEX IF EXISTS automation_subscriptions_dedup_uniq"))).toBe(true);
    expect(statements.some((s: string) => s.includes("DROP INDEX IF EXISTS automation_subscriptions_dedup_with_monitor"))).toBe(true);
    expect(statements.some((s: string) => s.includes("DROP INDEX IF EXISTS automation_subscriptions_dedup_global"))).toBe(true);
  });

  it("skips DROP when old indexes do not exist", async () => {
    mockExecute.mockResolvedValue({ rows: [] });
    await ensureAutomationSubscriptionsTable();
    const statements = mockExecute.mock.calls.map(([arg]: any) => {
      try { return JSON.stringify(arg); } catch { return String(arg); }
    });
    expect(statements.some((s: string) => s.includes("DROP INDEX"))).toBe(false);
  });

  it("creates two partial unique indexes instead of COALESCE index", async () => {
    mockExecute.mockResolvedValue({ rows: [] });
    await ensureAutomationSubscriptionsTable();
    const statements = mockExecute.mock.calls.map(([arg]: any) => {
      try { return JSON.stringify(arg); } catch { return String(arg); }
    });
    expect(statements.some((s: string) => s.includes("automation_subscriptions_dedup_with_monitor"))).toBe(true);
    expect(statements.some((s: string) => s.includes("automation_subscriptions_dedup_global"))).toBe(true);
  });

  it("returns false and does not throw on error", async () => {
    mockExecute.mockRejectedValue(new Error("connection refused"));
    const result = await ensureAutomationSubscriptionsTable();
    expect(result).toBe(false);
  });

  it("logs error when table creation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("connection refused"));
    await ensureAutomationSubscriptionsTable();
    expect(errorSpy).toHaveBeenCalledWith(
      "Could not ensure automation_subscriptions table:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Schema sync guard — ensures ensureTables.ts DDL stays in sync with Drizzle.
// If a column is added/removed in shared/schema.ts, this test fails and
// reminds you to update the DDL in ensureTables.ts (and vice-versa).
// ---------------------------------------------------------------------------
describe("schema sync between ensureTables DDL and Drizzle schema", () => {
  // Column names as defined in the CREATE TABLE statements in ensureTables.ts.
  // These MUST match the Drizzle definitions in shared/schema.ts exactly.
  const DDL_COLUMNS = {
    notification_channels: ["id", "monitor_id", "channel", "enabled", "config", "created_at", "updated_at"],
    delivery_log: ["id", "monitor_id", "change_id", "channel", "status", "attempt", "response", "delivered_at", "created_at"],
    slack_connections: ["id", "user_id", "team_id", "team_name", "bot_token", "scope", "created_at", "updated_at"],
    monitor_conditions: ["id", "monitor_id", "type", "value", "group_index", "created_at"],
    automated_campaign_configs: ["id", "key", "name", "subject", "html_body", "text_body", "enabled", "last_run_at", "next_run_at", "created_at", "updated_at"],
    automation_subscriptions: ["id", "user_id", "platform", "hook_url", "hook_url_hash", "monitor_id", "active", "consecutive_failures", "created_at", "deactivated_at", "last_delivered_at"],
  };

  function drizzleColumnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
    return Object.values(getTableColumns(table)).map((col) => col.name).sort();
  }

  it("notification_channels columns match Drizzle schema", () => {
    expect(DDL_COLUMNS.notification_channels.sort()).toEqual(drizzleColumnNames(notificationChannels));
  });

  it("delivery_log columns match Drizzle schema", () => {
    expect(DDL_COLUMNS.delivery_log.sort()).toEqual(drizzleColumnNames(deliveryLog));
  });

  it("slack_connections columns match Drizzle schema", () => {
    expect(DDL_COLUMNS.slack_connections.sort()).toEqual(drizzleColumnNames(slackConnections));
  });

  it("monitor_conditions columns match Drizzle schema", () => {
    expect(DDL_COLUMNS.monitor_conditions.sort()).toEqual(drizzleColumnNames(monitorConditions));
  });

  it("automated_campaign_configs columns match Drizzle schema", () => {
    expect(DDL_COLUMNS.automated_campaign_configs.sort()).toEqual(drizzleColumnNames(automatedCampaignConfigs));
  });

  it("automation_subscriptions columns match Drizzle schema", () => {
    expect(DDL_COLUMNS.automation_subscriptions.sort()).toEqual(drizzleColumnNames(automationSubscriptions));
  });
});
