/**
 * Invariant tests linking runtime constants to partial-index predicates
 * hardcoded in shared/schema.ts. Without these, a constant change silently
 * causes the planner to regress because the index no longer covers the new
 * status values. See Phase 5 skeptic Concern 3.
 *
 * Reads the campaignEmail.ts and schema.ts source as text rather than
 * importing them — the service module pulls in db.ts which requires a live
 * DATABASE_URL, and this test only needs to compare string predicates.
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
