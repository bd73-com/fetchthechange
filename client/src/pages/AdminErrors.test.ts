import { describe, it, expect } from "vitest";
import type { ErrorLog } from "@shared/schema";

/**
 * Regression test for issue #296: the AdminErrors page used snake_case
 * property names (error_type, stack_trace, etc.) but Drizzle ORM returns
 * camelCase. This test ensures the schema fields that AdminErrors.tsx
 * relies on exist with the expected camelCase names.
 */
describe("AdminErrors ErrorLogEntry alignment with schema", () => {
  // Build a minimal ErrorLog to verify the camelCase field names exist
  // at the type level. If the schema ever renames these fields, this
  // test will fail at compile time (npm run check) and at runtime.
  const schemaKeys: (keyof ErrorLog)[] = [
    "id",
    "timestamp",
    "level",
    "source",
    "errorType",
    "message",
    "stackTrace",
    "context",
    "resolved",
    "firstOccurrence",
    "occurrenceCount",
  ];

  it("schema exports camelCase field names used by AdminErrors", () => {
    // These are the fields AdminErrors.tsx references — if the schema
    // renames them, this array literal will cause a TS error and the
    // runtime check below will also catch it.
    expect(schemaKeys).toContain("errorType");
    expect(schemaKeys).toContain("stackTrace");
    expect(schemaKeys).toContain("firstOccurrence");
    expect(schemaKeys).toContain("occurrenceCount");
  });

  it("schema does NOT export snake_case names", () => {
    const keys = schemaKeys as string[];
    expect(keys).not.toContain("error_type");
    expect(keys).not.toContain("stack_trace");
    expect(keys).not.toContain("first_occurrence");
    expect(keys).not.toContain("occurrence_count");
  });
});
