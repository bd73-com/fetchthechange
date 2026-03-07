import { describe, it, expect } from "vitest";
import { getSlackDisplayState } from "./slack-display-state";

describe("getSlackDisplayState", () => {
  it("returns 'upgrade' for free-tier users regardless of slack status", () => {
    expect(getSlackDisplayState(true, undefined)).toBe("upgrade");
    expect(getSlackDisplayState(true, { available: true, connected: true })).toBe("upgrade");
    expect(getSlackDisplayState(true, { available: false, connected: false })).toBe("upgrade");
  });

  it("returns 'not-configured' when slack is unavailable on the server", () => {
    expect(getSlackDisplayState(false, { available: false, connected: false })).toBe("not-configured");
  });

  it("returns 'connect' when slack is available but not connected", () => {
    expect(getSlackDisplayState(false, { available: true, connected: false })).toBe("connect");
  });

  it("returns 'connect' when slack status is undefined (still loading)", () => {
    expect(getSlackDisplayState(false, undefined)).toBe("connect");
  });

  it("returns 'connected' when slack is available and connected", () => {
    expect(getSlackDisplayState(false, { available: true, connected: true })).toBe("connected");
  });
});
