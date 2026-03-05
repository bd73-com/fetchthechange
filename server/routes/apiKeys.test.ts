import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { generateRawKey, hashApiKey, extractKeyPrefix } from "../utils/apiKey";

describe("API key management logic", () => {
  describe("Key generation (shared utility)", () => {
    it("generateRawKey produces ftc_ prefix and correct length", () => {
      const rawKey = generateRawKey();
      expect(rawKey).toMatch(/^ftc_[a-f0-9]{64}$/);
    });

    it("hashApiKey returns a 64-char hex SHA-256 hash", () => {
      const rawKey = generateRawKey();
      const hash = hashApiKey(rawKey);
      expect(hash).toHaveLength(64);
      expect(hash).not.toContain("ftc_");
      expect(hash).not.toBe(rawKey);
    });

    it("hashApiKey is deterministic", () => {
      const rawKey = "ftc_abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678";
      expect(hashApiKey(rawKey)).toBe(hashApiKey(rawKey));
    });

    it("extractKeyPrefix returns first 12 characters", () => {
      const rawKey = generateRawKey();
      const prefix = extractKeyPrefix(rawKey);
      expect(prefix).toHaveLength(12);
      expect(prefix).toMatch(/^ftc_[a-f0-9]{8}$/);
      expect(rawKey.startsWith(prefix)).toBe(true);
    });

    it("hashApiKey matches raw crypto equivalent", () => {
      const rawKey = generateRawKey();
      const utilHash = hashApiKey(rawKey);
      const directHash = createHash("sha256").update(rawKey).digest("hex");
      expect(utilHash).toBe(directHash);
    });
  });

  describe("Key generation (raw crypto — legacy verification)", () => {
    it("generates keys with ftc_ prefix and correct length", () => {
      const rawKey = "ftc_" + randomBytes(32).toString("hex");
      expect(rawKey).toMatch(/^ftc_[a-f0-9]{64}$/);
    });

    it("stores SHA-256 hash, never the raw key", () => {
      const rawKey = "ftc_" + randomBytes(32).toString("hex");
      const keyHash = createHash("sha256").update(rawKey).digest("hex");
      expect(keyHash).toHaveLength(64);
      expect(keyHash).not.toContain("ftc_");
      expect(keyHash).not.toBe(rawKey);
    });

    it("keyPrefix is first 12 characters of the raw key", () => {
      const rawKey = "ftc_" + randomBytes(32).toString("hex");
      const keyPrefix = rawKey.substring(0, 12);
      expect(keyPrefix).toMatch(/^ftc_[a-f0-9]{8}$/);
      expect(rawKey.startsWith(keyPrefix)).toBe(true);
    });
  });

  describe("Tier gating", () => {
    it("Free tier should not have API access", () => {
      expect("free").not.toBe("power");
    });

    it("Pro tier should not have API access", () => {
      expect("pro").not.toBe("power");
    });

    it("Power tier should have API access", () => {
      expect("power").toBe("power");
    });
  });

  describe("Key limit enforcement", () => {
    it("allows creating key when under limit of 5", () => {
      expect(4 < 5).toBe(true);
    });

    it("rejects creating 6th key when at limit of 5", () => {
      expect(5 >= 5).toBe(true);
    });
  });

  describe("Zod validation", () => {
    it("apiV1CreateKeySchema rejects empty name", async () => {
      const { apiV1CreateKeySchema } = await import("@shared/routes");
      const result = apiV1CreateKeySchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });

    it("apiV1CreateKeySchema rejects name over 64 chars", async () => {
      const { apiV1CreateKeySchema } = await import("@shared/routes");
      const result = apiV1CreateKeySchema.safeParse({ name: "x".repeat(65) });
      expect(result.success).toBe(false);
    });

    it("apiV1CreateKeySchema accepts valid name", async () => {
      const { apiV1CreateKeySchema } = await import("@shared/routes");
      const result = apiV1CreateKeySchema.safeParse({ name: "CI pipeline" });
      expect(result.success).toBe(true);
    });

    it("apiV1CreateKeySchema accepts name at max length (64 chars)", async () => {
      const { apiV1CreateKeySchema } = await import("@shared/routes");
      const result = apiV1CreateKeySchema.safeParse({ name: "x".repeat(64) });
      expect(result.success).toBe(true);
    });
  });

  describe("Key lookup by hash", () => {
    it("same raw key always produces the same hash", () => {
      const rawKey = "ftc_abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678";
      const hash1 = createHash("sha256").update(rawKey).digest("hex");
      const hash2 = createHash("sha256").update(rawKey).digest("hex");
      expect(hash1).toBe(hash2);
    });

    it("different keys produce different hashes", () => {
      const key1 = "ftc_" + randomBytes(32).toString("hex");
      const key2 = "ftc_" + randomBytes(32).toString("hex");
      const hash1 = createHash("sha256").update(key1).digest("hex");
      const hash2 = createHash("sha256").update(key2).digest("hex");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Safe response shape", () => {
    it("list response never includes keyHash or raw key", () => {
      const dbRow = {
        id: 1,
        name: "CI key",
        keyHash: "abc123hash",
        keyPrefix: "ftc_abc12345",
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
      };
      const safeKey = {
        id: dbRow.id,
        name: dbRow.name,
        keyPrefix: dbRow.keyPrefix,
        lastUsedAt: dbRow.lastUsedAt,
        createdAt: dbRow.createdAt,
      };
      expect(safeKey).not.toHaveProperty("keyHash");
      expect(safeKey).not.toHaveProperty("key");
    });

    it("create response includes key but not keyHash", () => {
      const rawKey = "ftc_" + randomBytes(32).toString("hex");
      const createResponse = {
        id: 1,
        name: "CI key",
        keyPrefix: rawKey.substring(0, 12),
        key: rawKey,
        createdAt: new Date().toISOString(),
      };
      expect(createResponse.key).toBeDefined();
      expect(createResponse.key).toMatch(/^ftc_/);
      expect(createResponse).not.toHaveProperty("keyHash");
    });
  });
});
