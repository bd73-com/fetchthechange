/**
 * Invariant tests linking runtime constants to partial-index predicates
 * hardcoded in shared/schema.ts. Without these, a constant change silently
 * causes the planner to regress because the index no longer covers the new
 * status values. See Phase 5 skeptic Concern 3.
 *
 * Reads the campaignEmail.ts / logger.ts / schema.ts source as text rather
 * than importing them — the service modules pull in db.ts which requires a
 * live DATABASE_URL, and these tests only compare string predicates.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const CAMPAIGN_EMAIL_SRC = fs.readFileSync(
  path.resolve(__dirname, "services", "campaignEmail.ts"),
  "utf-8",
);
const SCHEMA_SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "shared", "schema.ts"),
  "utf-8",
);
const LOGGER_SRC = fs.readFileSync(
  path.resolve(__dirname, "services", "logger.ts"),
  "utf-8",
);
const ENSURE_TABLES_SRC = fs.readFileSync(
  path.resolve(__dirname, "services", "ensureTables.ts"),
  "utf-8",
);

function extractStatusList(label: string): string[] {
  const re = new RegExp(`${label}\\s*=\\s*\\[([^\\]]+)\\]`);
  const m = CAMPAIGN_EMAIL_SRC.match(re);
  if (!m) throw new Error(`failed to extract ${label} from campaignEmail.ts`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((mm) => mm[1]);
}

const TERMINAL_RECIPIENT_STATUSES = extractStatusList(
  "TERMINAL_RECIPIENT_STATUSES",
);
// ACTIVE = ["pending", ...TERMINAL]
const ACTIVE_RECIPIENT_STATUSES = ["pending", ...TERMINAL_RECIPIENT_STATUSES];

function extractActiveUserIdxPredicate(): string {
  // Extract the `.where(sql\`…\`)` clause of the activeUserCampaignIdx entry.
  const match = SCHEMA_SRC.match(
    /activeUserCampaignIdx[\s\S]*?\.where\(sql`([^`]+)`\)/,
  );
  if (!match) {
    throw new Error(
      "failed to extract activeUserCampaignIdx predicate from shared/schema.ts — " +
        "did the index definition move, split across multiple sql`` fragments, " +
        "or introduce an escaped backtick? The invariant test cannot validate " +
        "the predicate until this regex matches the index shape again.",
    );
  }
  return match[1];
}

// Known non-active recipient statuses per the column comment in
// shared/schema.ts:170. Kept in lockstep there — if a new terminal status is
// added to the schema but the partial-index predicate isn't updated, this
// list catches the leak before the planner regresses silently.
const NON_ACTIVE_RECIPIENT_STATUSES = ["bounced", "complained"] as const;

describe("campaign_recipients_active_user_idx predicate matches ACTIVE_RECIPIENT_STATUSES", () => {
  it("predicate references every status in ACTIVE_RECIPIENT_STATUSES", () => {
    const predicate = extractActiveUserIdxPredicate();
    for (const status of ACTIVE_RECIPIENT_STATUSES) {
      expect(predicate).toContain(`'${status}'`);
    }
  });

  it("predicate does not reference known non-active recipient statuses (bounced, complained)", () => {
    const predicate = extractActiveUserIdxPredicate();
    const active = new Set<string>([...ACTIVE_RECIPIENT_STATUSES]);
    for (const status of NON_ACTIVE_RECIPIENT_STATUSES) {
      // Safety: our exclusion list must actually be outside the active set.
      expect(active.has(status)).toBe(false);
      expect(predicate).not.toContain(`'${status}'`);
    }
  });
});

describe("TERMINAL_RECIPIENT_STATUSES is a subset of ACTIVE_RECIPIENT_STATUSES", () => {
  // The anti-join excludes terminal sends — that membership relationship
  // is load-bearing for the welcome-exclusion logic.
  it("every terminal status is active", () => {
    const active = new Set<string>([...ACTIVE_RECIPIENT_STATUSES]);
    for (const status of TERMINAL_RECIPIENT_STATUSES) {
      expect(active.has(status)).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// error_logs_unresolved_dedup_idx — the ErrorLogger upsert's ON CONFLICT
// partial-index predicate must exactly match the index's WHERE clause.
// Postgres matches ON CONFLICT inference specs by strict predicate equality;
// a mismatch produces a runtime error ("there is no unique or exclusion
// constraint matching the ON CONFLICT specification") that ErrorLogger's
// catch block swallows, silently disabling logging. See GitHub issue #448.
// -----------------------------------------------------------------------------

function extractIndexPredicate(indexName: string): string {
  const re = new RegExp(`${indexName}[\\s\\S]*?\\.where\\(sql\`([^\`]+)\`\\)`);
  const m = SCHEMA_SRC.match(re);
  if (!m) throw new Error(`failed to extract ${indexName} predicate from shared/schema.ts`);
  return m[1].trim();
}

function extractLoggerTargetWherePredicate(): string {
  const m = LOGGER_SRC.match(/targetWhere:\s*sql`([^`]+)`/);
  if (!m) {
    throw new Error(
      "failed to extract targetWhere predicate from server/services/logger.ts — " +
        "did the onConflictDoUpdate call move, split the predicate across " +
        "fragments, or switch to a non-sql`` expression? The invariant test " +
        "cannot validate the upsert until this regex matches the call shape again.",
    );
  }
  return m[1].trim();
}

function extractLoggerConflictTargetColumns(): string[] {
  // Match `target: [errorLogs.level, errorLogs.source, errorLogs.message]` on
  // the onConflictDoUpdate call. Extracts the column names after the
  // `errorLogs.` prefix so they can be compared against the schema's .on(...)
  // tuple directly. If this regex stops matching, the caller-side assertion
  // throws a descriptive error so the drift is caught rather than silently
  // skipped.
  const m = LOGGER_SRC.match(/target:\s*\[([^\]]+)\]/);
  if (!m) {
    throw new Error(
      "failed to extract onConflictDoUpdate target column list from server/services/logger.ts — " +
        "did the target tuple move, use a spread, or split across lines? The invariant test " +
        "cannot validate the upsert target until this regex matches the call shape again.",
    );
  }
  return Array.from(m[1].matchAll(/errorLogs\.(\w+)/g)).map((mm) => mm[1]);
}

// -----------------------------------------------------------------------------
// schema.ts <-> ensureTables.ts predicate parity for partial indexes.
// Every partial index declared in shared/schema.ts that we rely on Postgres
// to bootstrap via ensureTables must be present there with a byte-identical
// WHERE predicate. A mismatch causes:
//   - ON CONFLICT inference failure (Postgres requires strict predicate
//     equality), which surfaces as the logger/backfill catch block swallowing
//     the error and silently disabling the feature.
//   - Endless drizzle-kit push churn (the diff flips the index back and forth).
// See GitHub issues #448, #452, #453.
// -----------------------------------------------------------------------------

type BootstrapRequiredIndex = {
  name: string;
  schemaKey: string;
};

const BOOTSTRAP_REQUIRED_PARTIAL_INDEXES: BootstrapRequiredIndex[] = [
  { name: "error_logs_unresolved_dedup_idx", schemaKey: "unresolvedDedupIdx" },
  { name: "campaigns_type_automated_idx", schemaKey: "typeAutomatedIdx" },
  { name: "campaign_recipients_active_user_idx", schemaKey: "activeUserCampaignIdx" },
  { name: "automation_subscriptions_dedup_with_monitor", schemaKey: "dedupWithMonitor" },
  { name: "automation_subscriptions_dedup_global", schemaKey: "dedupGlobal" },
];

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extractEnsureTablesPredicate(indexName: string): string {
  // Match the CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] <name>
  // ... WHERE <predicate> pattern. Allow the statement to span multiple lines
  // (the error_logs bootstrap uses a multi-line template literal). Stop at the
  // closing backtick or the end of statement punctuation so we don't bleed
  // into trailing SQL fragments.
  const re = new RegExp(
    `CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${indexName}\\b[\\s\\S]*?WHERE\\s+([\\s\\S]*?)\`\\s*\\)`,
  );
  const m = ENSURE_TABLES_SRC.match(re);
  if (!m) {
    throw new Error(
      `failed to extract WHERE predicate for ${indexName} from server/services/ensureTables.ts — ` +
        "missing bootstrap for this partial index, or the CREATE INDEX " +
        "statement changed shape (split across db.execute calls, different " +
        "name, etc.). Add or repair the bootstrap so schema and DDL stay " +
        "byte-identical.",
    );
  }
  return normalizeWhitespace(m[1]);
}

function extractSchemaPredicate(schemaKey: string): string {
  const re = new RegExp(`${schemaKey}[\\s\\S]*?\\.where\\(sql\`([^\`]+)\`\\)`);
  const m = SCHEMA_SRC.match(re);
  if (!m) throw new Error(`failed to extract ${schemaKey} predicate from shared/schema.ts`);
  return normalizeWhitespace(m[1]);
}

describe("partial-index bootstrap parity between schema.ts and ensureTables.ts", () => {
  for (const idx of BOOTSTRAP_REQUIRED_PARTIAL_INDEXES) {
    it(`${idx.name}: ensureTables bootstrap exists and its WHERE predicate byte-matches shared/schema.ts`, () => {
      const schemaPredicate = extractSchemaPredicate(idx.schemaKey);
      const ddlPredicate = extractEnsureTablesPredicate(idx.name);
      expect(ddlPredicate).toBe(schemaPredicate);
    });
  }
});

describe("error_logs_unresolved_dedup_idx predicate matches ErrorLogger upsert targetWhere", () => {
  it("index WHERE clause and onConflictDoUpdate targetWhere are byte-for-byte equal", () => {
    const indexPredicate = extractIndexPredicate("unresolvedDedupIdx");
    const loggerPredicate = extractLoggerTargetWherePredicate();
    expect(loggerPredicate).toBe(indexPredicate);
  });

  it("schema index .on(...) and ErrorLogger target [...] both list exactly (level, source, message, monitorId)", () => {
    // Match the exact .on(...) column list for the unresolved-dedup index.
    // If new columns are added or the order changes, the ErrorLogger upsert's
    // `target: [errorLogs.level, errorLogs.source, errorLogs.message, errorLogs.monitorId]`
    // tuple must be updated in lockstep or Postgres rejects the conflict spec.
    // We assert both sides match the canonical tuple AND each other, so
    // schema-only or logger-only drift both fail the test. monitorId was
    // added in #465 so per-monitor errors with shared messages get separate
    // dedup buckets and the admin UI's per-user attribution works.
    const m = SCHEMA_SRC.match(
      /unresolvedDedupIdx[\s\S]*?\.on\(([^)]+)\)/,
    );
    if (!m) throw new Error("failed to extract unresolvedDedupIdx .on(...) columns");
    const schemaColumns = m[1]
      .split(",")
      .map((c) => c.trim().replace(/^table\./, ""))
      .filter(Boolean);
    const loggerColumns = extractLoggerConflictTargetColumns();
    expect(schemaColumns).toEqual(["level", "source", "message", "monitorId"]);
    expect(loggerColumns).toEqual(schemaColumns);
  });
});
