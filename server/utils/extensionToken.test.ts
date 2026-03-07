import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sign, verify, getExpiresAt } from "./extensionToken";

const TEST_SECRET = "a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1";

describe("extensionToken", () => {
  beforeEach(() => {
    vi.stubEnv("EXTENSION_JWT_SECRET", TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sign + verify round-trip", () => {
    const token = sign("user-123", "pro");
    const result = verify(token);
    expect(result).toEqual({ userId: "user-123", tier: "pro" });
  });

  it("returns different tokens for different users", () => {
    const t1 = sign("user-1", "free");
    const t2 = sign("user-2", "free");
    expect(t1).not.toBe(t2);
  });

  it("expired token returns null", () => {
    // Create a token, then advance time beyond 30 days
    const token = sign("user-123", "free");

    // Mock Date.now to be 31 days in the future
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockReturnValue(
      realNow() + 31 * 24 * 60 * 60 * 1000
    );

    const result = verify(token);
    expect(result).toBeNull();

    vi.restoreAllMocks();
  });

  it("tampered payload returns null", () => {
    const token = sign("user-123", "pro");
    const parts = token.split(".");
    // Tamper with payload
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    );
    payload.tier = "power";
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const tampered = parts.join(".");

    expect(verify(tampered)).toBeNull();
  });

  it("tampered signature returns null", () => {
    const token = sign("user-123", "pro");
    const tampered = token.slice(0, -2) + "AA";
    expect(verify(tampered)).toBeNull();
  });

  it("garbage input returns null", () => {
    expect(verify("not.a.jwt")).toBeNull();
    expect(verify("")).toBeNull();
    expect(verify("abc")).toBeNull();
  });

  it("missing env var throws on sign", () => {
    delete process.env.EXTENSION_JWT_SECRET;
    expect(() => sign("user-123", "free")).toThrow("EXTENSION_JWT_SECRET");
  });

  it("short secret throws on sign", () => {
    vi.stubEnv("EXTENSION_JWT_SECRET", "abcd1234");
    expect(() => sign("user-123", "free")).toThrow("at least 32 bytes");
  });

  it("missing env var on verify returns null (getSecret throws, caught)", () => {
    delete process.env.EXTENSION_JWT_SECRET;
    expect(verify("some.fake.token")).toBeNull();
  });

  it("getExpiresAt returns a future ISO date", () => {
    const exp = getExpiresAt();
    const d = new Date(exp);
    expect(d.getTime()).toBeGreaterThan(Date.now());
    // Should be roughly 30 days from now
    const diffDays = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(29);
    expect(diffDays).toBeLessThan(31);
  });
});
