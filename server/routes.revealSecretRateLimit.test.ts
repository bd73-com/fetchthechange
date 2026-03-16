import { describe, it, expect } from "vitest";
import { ipKeyGenerator } from "express-rate-limit";

/**
 * Tests for the reveal-secret rate limiter keyGenerator logic.
 *
 * The keyGenerator in routes.ts uses:
 *   (req) => req.user?.claims?.sub || ipKeyGenerator(req.ip || "0.0.0.0")
 *
 * These tests verify that ipKeyGenerator properly normalizes IPv6 addresses
 * to prevent bypass via different IPv6 representations in the same /56 subnet.
 *
 * NOTE: The keyGenerator is duplicated here because it is an inline lambda in
 * registerRoutes(). If the production logic changes, update this mirror.
 */

/** Mirror of the keyGenerator in server/routes.ts:723 */
const keyGenerator = (req: { user?: { claims?: { sub?: string } }; ip?: string }) =>
  req.user?.claims?.sub || ipKeyGenerator(req.ip || "0.0.0.0");

describe("revealSecret rate limiter key generation", () => {
  it("returns user sub when authenticated", () => {
    const req = { user: { claims: { sub: "user-123" } }, ip: "192.168.1.1" };
    expect(keyGenerator(req)).toBe("user-123");
  });

  it("falls back to ipKeyGenerator for unauthenticated IPv4 requests", () => {
    const req = { ip: "192.168.1.1" };
    const result = keyGenerator(req);
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("normalizes IPv6 addresses to prevent subnet bypass", () => {
    // Two different IPs in the same /56 subnet should produce the same key
    const req1 = { ip: "2001:0db8:85a3:0000:0000:0000:0000:0001" };
    const req2 = { ip: "2001:0db8:85a3:0000:ffff:ffff:ffff:ffff" };
    expect(keyGenerator(req1)).toBe(keyGenerator(req2));
  });

  it("treats different /56 subnets as different keys", () => {
    const req1 = { ip: "2001:0db8:85a3:0000:0000:0000:0000:0001" };
    const req2 = { ip: "2001:0db8:85a4:0000:0000:0000:0000:0001" };
    expect(keyGenerator(req1)).not.toBe(keyGenerator(req2));
  });

  it("prefers user sub over IP even for IPv6", () => {
    const req = {
      user: { claims: { sub: "user-456" } },
      ip: "2001:0db8:85a3:0000:0000:0000:0000:0001",
    };
    expect(keyGenerator(req)).toBe("user-456");
  });

  it("falls back to 0.0.0.0 when req.ip is undefined", () => {
    const req = { ip: undefined };
    const result = keyGenerator(req);
    // Should return a deterministic key, not undefined
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});
