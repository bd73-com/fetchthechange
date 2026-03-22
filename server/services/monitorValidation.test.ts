import { describe, it, expect, vi } from "vitest";

// Mock transitive dependencies that require DATABASE_URL
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("./scraper", () => ({ validateCssSelector: vi.fn() }));
vi.mock("../utils/ssrf", () => ({ isPrivateUrl: vi.fn() }));

import { checkFrequencyTier } from "./monitorValidation";

describe("checkFrequencyTier", () => {
  it("allows daily frequency for all tiers", () => {
    expect(checkFrequencyTier("daily", "free")).toBeNull();
    expect(checkFrequencyTier("daily", "pro")).toBeNull();
    expect(checkFrequencyTier("daily", "power")).toBeNull();
  });

  it("allows undefined frequency (defaults to daily)", () => {
    expect(checkFrequencyTier(undefined, "free")).toBeNull();
  });

  it("rejects hourly frequency for free tier", () => {
    const result = checkFrequencyTier("hourly", "free");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
    expect(result!.code).toBe("FREQUENCY_TIER_RESTRICTED");
  });

  it("allows hourly frequency for pro tier", () => {
    expect(checkFrequencyTier("hourly", "pro")).toBeNull();
  });

  it("allows hourly frequency for power tier", () => {
    expect(checkFrequencyTier("hourly", "power")).toBeNull();
  });

  it("returns descriptive error message for rejected frequency", () => {
    const result = checkFrequencyTier("hourly", "free");
    expect(result!.error).toContain("hourly");
    expect(result!.error).toContain("pro or power plan");
  });

  it("rejects unknown frequency values", () => {
    const result = checkFrequencyTier("minutely" as any, "pro");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
    expect(result!.code).toBe("FREQUENCY_TIER_RESTRICTED");
  });
});
