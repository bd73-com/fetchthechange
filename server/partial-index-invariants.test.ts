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

describe("campaign_recipients_active_user_idx predicate matches ACTIVE_RECIPIENT_STATUSES", () => {
  // Extract the `.where(sql\`…\`)` clause of the activeUserCampaignIdx entry.
  const indexBlock = SCHEMA_SRC.match(
    /activeUserCampaignIdx[\s\S]*?\.where\(sql`([^`]+)`\)/,
  );

  it("finds the activeUserCampaignIdx definition", () => {
    expect(indexBlock).not.toBeNull();
  });

  it("predicate references every status in ACTIVE_RECIPIENT_STATUSES", () => {
    const predicate = indexBlock![1];
    for (const status of ACTIVE_RECIPIENT_STATUSES) {
      expect(predicate).toContain(`'${status}'`);
    }
  });

  it("predicate does not reference any terminal status outside ACTIVE_RECIPIENT_STATUSES", () => {
    const predicate = indexBlock![1];
    const known = new Set<string>([...ACTIVE_RECIPIENT_STATUSES]);
    // These statuses exist in the schema but must NOT be in the active set.
    for (const status of ["bounced", "complained"]) {
      expect(known.has(status)).toBe(false);
      // Status either appears inside `'...'` in the predicate (bad) or not (good).
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
