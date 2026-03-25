import { describe, it, expect, vi } from "vitest";

// Mock heavy dependencies that require DATABASE_URL / external services
vi.mock("./storage", () => ({ authStorage: {} }));
vi.mock("openid-client", () => ({ discovery: vi.fn() }));
vi.mock("openid-client/passport", () => ({ Strategy: vi.fn() }));
vi.mock("connect-pg-simple", () => ({ default: vi.fn(() => vi.fn()) }));
vi.mock("express-session", () => ({ default: vi.fn() }));
vi.mock("passport", () => ({
  default: { use: vi.fn(), serializeUser: vi.fn(), deserializeUser: vi.fn() },
}));

const { sanitizeReturnTo } = await import("./replitAuth");

describe("sanitizeReturnTo", () => {
  it("accepts a valid relative path", () => {
    expect(sanitizeReturnTo("/extension-auth")).toBe("/extension-auth");
  });

  it("accepts root path", () => {
    expect(sanitizeReturnTo("/")).toBe("/");
  });

  it("accepts paths with query strings", () => {
    expect(sanitizeReturnTo("/extension-auth?foo=bar")).toBe("/extension-auth?foo=bar");
  });

  it("accepts nested paths", () => {
    expect(sanitizeReturnTo("/dashboard/monitors")).toBe("/dashboard/monitors");
  });

  it("rejects protocol-relative URLs (open redirect)", () => {
    expect(sanitizeReturnTo("//evil.com")).toBeUndefined();
  });

  it("rejects protocol-relative with path", () => {
    expect(sanitizeReturnTo("//evil.com/steal")).toBeUndefined();
  });

  it("rejects absolute URLs", () => {
    expect(sanitizeReturnTo("https://evil.com")).toBeUndefined();
  });

  it("rejects javascript: URIs", () => {
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeUndefined();
  });

  it("rejects bare hostnames", () => {
    expect(sanitizeReturnTo("evil.com")).toBeUndefined();
  });

  it("rejects empty string", () => {
    expect(sanitizeReturnTo("")).toBeUndefined();
  });

  it("rejects CRLF injection (literal characters)", () => {
    expect(sanitizeReturnTo("/foo\r\nSet-Cookie: evil=1")).toBeUndefined();
    expect(sanitizeReturnTo("/foo\nX-Injected: bar")).toBeUndefined();
    expect(sanitizeReturnTo("/foo\rX-Injected: bar")).toBeUndefined();
  });

  it("rejects CRLF injection (percent-encoded)", () => {
    expect(sanitizeReturnTo("/foo%0d%0aSet-Cookie:%20evil=1")).toBeUndefined();
    expect(sanitizeReturnTo("/foo%0D%0ASet-Cookie:%20evil=1")).toBeUndefined();
  });

  it("rejects excessively long paths", () => {
    expect(sanitizeReturnTo("/" + "a".repeat(2048))).toBeUndefined();
  });

  it("accepts paths at the length limit", () => {
    const path = "/" + "a".repeat(2047);
    expect(sanitizeReturnTo(path)).toBe(path);
  });

  it("rejects backslash-prefixed paths", () => {
    expect(sanitizeReturnTo("\\evil.com")).toBeUndefined();
  });

  it("rejects non-string values", () => {
    expect(sanitizeReturnTo(undefined)).toBeUndefined();
    expect(sanitizeReturnTo(null)).toBeUndefined();
    expect(sanitizeReturnTo(123)).toBeUndefined();
    expect(sanitizeReturnTo(["/"])).toBeUndefined();
  });
});
