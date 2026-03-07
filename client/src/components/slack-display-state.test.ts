import { describe, it, expect } from "vitest";
import { getSlackDisplayState } from "./slack-display-state";

describe("getSlackDisplayState", () => {
  it("returns 'upgrade' for free-tier users regardless of slack status", () => {
    expect(getSlackDisplayState(true, undefined)).toBe("upgrade");
    expect(getSlackDisplayState(true, { available: true, connected: true })).toBe("upgrade");
    expect(getSlackDisplayState(true, { available: false, connected: false })).toBe("upgrade");
  });

  it("returns 'not-configured' when OAuth is not configured", () => {
    expect(getSlackDisplayState(false, { available: false, connected: false, unavailableReason: "oauth-not-configured" })).toBe("not-configured");
  });

  it("returns 'not-configured' when unavailableReason is absent (fallback)", () => {
    expect(getSlackDisplayState(false, { available: false, connected: false })).toBe("not-configured");
  });

  it("returns 'not-ready' when tables are not ready", () => {
    expect(getSlackDisplayState(false, { available: false, connected: false, unavailableReason: "tables-not-ready" })).toBe("not-ready");
  });

  it("returns 'connect' when slack is available but not connected", () => {
    expect(getSlackDisplayState(false, { available: true, connected: false })).toBe("connect");
  });

  it("returns 'connect' when slack status is undefined (loading fallback)", () => {
    // Note: the component short-circuits with a loading message when
    // isSlackStatusLoading is true, so this path only applies if the
    // hook returned undefined without the loading flag.
    expect(getSlackDisplayState(false, undefined)).toBe("connect");
  });

  it("returns 'connected' when slack is available and connected", () => {
    expect(getSlackDisplayState(false, { available: true, connected: true })).toBe("connected");
  });

  it("prioritises unavailable over connected (available=false takes precedence)", () => {
    expect(
      getSlackDisplayState(false, { available: false, connected: true, unavailableReason: "oauth-not-configured" }),
    ).toBe("not-configured");
    expect(
      getSlackDisplayState(false, { available: false, connected: true, unavailableReason: "tables-not-ready" }),
    ).toBe("not-ready");
  });
});
