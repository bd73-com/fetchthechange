import { describe, it, expect } from "vitest";
import { safeHostname } from "./urlUtils";

describe("safeHostname", () => {
  it("extracts the hostname from a well-formed URL", () => {
    expect(safeHostname("https://example.com/path?q=1")).toBe("example.com");
    expect(safeHostname("http://sub.example.co.uk:8080/")).toBe("sub.example.co.uk");
  });

  it("strips userinfo credentials from the returned hostname", () => {
    expect(safeHostname("https://user:password@example.com/path")).toBe("example.com");
  });

  it("does not include query-string secrets in the result", () => {
    const out = safeHostname("https://example.com/feed?api_key=SECRET123&token=TOK");
    expect(out).toBe("example.com");
    expect(out).not.toContain("SECRET123");
    expect(out).not.toContain("TOK");
  });

  it("returns the <invalid-url> sentinel (not 'unknown') for parse failures", () => {
    // Angle-bracketed sentinel can never be a real hostname, so it is
    // distinguishable from a legitimate host named "unknown".
    expect(safeHostname("not a url")).toBe("<invalid-url>");
    expect(safeHostname("")).toBe("<invalid-url>");
  });

  it("preserves a literal 'unknown' hostname when parsing succeeds", () => {
    // Guards the sentinel-collision fix: a real URL whose hostname is the
    // word 'unknown' must not be confused with a parse failure.
    expect(safeHostname("http://unknown/path")).toBe("unknown");
  });
});
