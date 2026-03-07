import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sign, verify, getExpiresAt } from "./extensionToken";

const TEST_SECRET = "a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1";

describe("extensionToken", () => {
  beforeEach(() => {
    vi.stubEnv("EXTENSION_JWT_SECRET", TEST_SECRET);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    // Create a token, then advance time beyond 7 days
    const token = sign("user-123", "free");

    // Mock Date.now to be 8 days in the future
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockReturnValue(
      realNow() + 8 * 24 * 60 * 60 * 1000
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

  it("each token has a unique jti claim", () => {
    const t1 = sign("user-1", "free");
    const t2 = sign("user-1", "free");

    const p1 = JSON.parse(Buffer.from(t1.split(".")[1], "base64url").toString());
    const p2 = JSON.parse(Buffer.from(t2.split(".")[1], "base64url").toString());

    expect(p1.jti).toBeDefined();
    expect(p2.jti).toBeDefined();
    expect(p1.jti).not.toBe(p2.jti);
  });

  it("token is valid just before expiry (6 days 23 hours)", () => {
    const token = sign("user-123", "pro");

    const realNow = Date.now;
    // 6 days 23 hours in the future — still within 7-day window
    vi.spyOn(Date, "now").mockReturnValue(
      realNow() + (7 * 24 - 1) * 60 * 60 * 1000
    );

    const result = verify(token);
    expect(result).toEqual({ userId: "user-123", tier: "pro" });

    vi.restoreAllMocks();
  });

  it("token is invalid exactly at expiry boundary", () => {
    const token = sign("user-123", "free");

    const realNow = Date.now;
    // Exactly 7 days + 1 second in the future
    vi.spyOn(Date, "now").mockReturnValue(
      realNow() + (7 * 24 * 60 * 60 + 1) * 1000
    );

    const result = verify(token);
    expect(result).toBeNull();

    vi.restoreAllMocks();
  });

  it("rejects token with missing sub claim", () => {
    // Manually craft a token with missing sub
    const secret = Buffer.from(TEST_SECRET, "hex");
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      tier: "free",
      jti: "test-jti",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const { createHmac } = require("node:crypto");
    const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest().toString("base64url");
    const token = `${header}.${payload}.${sig}`;

    expect(verify(token)).toBeNull();
  });

  it("rejects token with missing tier claim", () => {
    const secret = Buffer.from(TEST_SECRET, "hex");
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: "user-1",
      jti: "test-jti",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const { createHmac } = require("node:crypto");
    const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest().toString("base64url");
    const token = `${header}.${payload}.${sig}`;

    expect(verify(token)).toBeNull();
  });

  it("getExpiresAt returns a future ISO date", () => {
    const exp = getExpiresAt();
    const d = new Date(exp);
    expect(d.getTime()).toBeGreaterThan(Date.now());
    // Should be roughly 7 days from now
    const diffDays = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);
  });
});
