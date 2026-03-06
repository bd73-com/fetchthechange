import { describe, it, expect } from "vitest";
import { formatDate, formatTime, formatDateTime } from "./date-format";

describe("formatDate", () => {
  it("formats a Date object as 'MMM d, yyyy'", () => {
    expect(formatDate(new Date(2026, 2, 6))).toBe("Mar 6, 2026");
  });

  it("formats an ISO string", () => {
    // Use noon UTC to avoid timezone-shift issues
    expect(formatDate("2026-12-31T12:00:00Z")).toBe("Dec 31, 2026");
  });

  it("does not pad single-digit days", () => {
    expect(formatDate(new Date(2026, 0, 1))).toBe("Jan 1, 2026");
  });
});

describe("formatTime", () => {
  it("formats afternoon time as HHmm", () => {
    expect(formatTime(new Date(2026, 2, 6, 15, 57))).toBe("1557");
  });

  it("formats midnight as 0000", () => {
    expect(formatTime(new Date(2026, 2, 6, 0, 0))).toBe("0000");
  });

  it("pads single-digit hours and minutes", () => {
    expect(formatTime(new Date(2026, 2, 6, 1, 5))).toBe("0105");
  });
});

describe("formatDateTime", () => {
  it("combines date and time in a single string", () => {
    expect(formatDateTime(new Date(2026, 2, 6, 15, 57))).toBe("Mar 6, 2026 1557");
  });
});
