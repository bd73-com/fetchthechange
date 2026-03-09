import { describe, it, expect } from "vitest";
import { getHealthState, needsAttention } from "./monitor-health";

describe("getHealthState", () => {
  it("returns 'paused' when monitor is inactive", () => {
    expect(getHealthState({ active: false, consecutiveFailures: 0 })).toBe("paused");
  });

  it("returns 'paused' when inactive even with failures", () => {
    expect(getHealthState({ active: false, consecutiveFailures: 5 })).toBe("paused");
  });

  it("returns 'degraded' when active with failures", () => {
    expect(getHealthState({ active: true, consecutiveFailures: 1 })).toBe("degraded");
  });

  it("returns 'degraded' for high failure counts", () => {
    expect(getHealthState({ active: true, consecutiveFailures: 99 })).toBe("degraded");
  });

  it("returns 'healthy' when active with zero failures", () => {
    expect(getHealthState({ active: true, consecutiveFailures: 0 })).toBe("healthy");
  });
});

describe("needsAttention", () => {
  it("returns false for healthy monitor", () => {
    expect(needsAttention({ active: true, consecutiveFailures: 0 })).toBe(false);
  });

  it("returns true when paused", () => {
    expect(needsAttention({ active: false, consecutiveFailures: 0 })).toBe(true);
  });

  it("returns true when degraded", () => {
    expect(needsAttention({ active: true, consecutiveFailures: 3 })).toBe(true);
  });

  it("returns true when both paused and degraded", () => {
    expect(needsAttention({ active: false, consecutiveFailures: 5 })).toBe(true);
  });
});
