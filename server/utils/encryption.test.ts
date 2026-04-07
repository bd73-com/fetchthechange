import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function clearEncryptionEnv() {
  delete process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY_OLD;
  delete process.env.SLACK_ENCRYPTION_KEY;
}

describe("encryption", () => {
  const VALID_KEY = "a".repeat(64); // 32 bytes hex-encoded

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    clearEncryptionEnv();
    vi.resetModules();
  });

  it("round-trips encrypt and decrypt", async () => {
    const { encryptToken, decryptToken } = await import("./encryption");
    const plaintext = "xoxb-test-bot-token-12345";
    const encrypted = encryptToken(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(":");
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same input (random IV)", async () => {
    const { encryptToken } = await import("./encryption");
    const plaintext = "same-token";
    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);
    expect(a).not.toBe(b);
  });

  it("throws when ENCRYPTION_KEY is missing", async () => {
    clearEncryptionEnv();
    const { encryptToken } = await import("./encryption");
    expect(() => encryptToken("test")).toThrow("ENCRYPTION_KEY");
  });

  it("throws when ENCRYPTION_KEY is wrong length", async () => {
    clearEncryptionEnv();
    process.env.ENCRYPTION_KEY = "tooshort";
    const { encryptToken } = await import("./encryption");
    expect(() => encryptToken("test")).toThrow("32 bytes");
  });

  it("throws on tampered ciphertext", async () => {
    const { encryptToken, decryptToken } = await import("./encryption");
    const encrypted = encryptToken("test-token");
    const parts = encrypted.split(":");
    // Tamper with ciphertext
    parts[1] = Buffer.from("tampered").toString("base64");
    const tampered = parts.join(":");
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws on invalid format", async () => {
    const { decryptToken } = await import("./encryption");
    expect(() => decryptToken("not-valid-format")).toThrow("Invalid encrypted token format");
  });

  it("isValidEncryptedToken accepts valid encrypted output", async () => {
    const { encryptToken, isValidEncryptedToken } = await import("./encryption");
    const encrypted = encryptToken("xoxb-test-token");
    expect(isValidEncryptedToken(encrypted)).toBe(true);
  });

  it("isValidEncryptedToken rejects plaintext tokens", async () => {
    const { isValidEncryptedToken } = await import("./encryption");
    expect(isValidEncryptedToken("xoxb-plain-token")).toBe(false);
    expect(isValidEncryptedToken("")).toBe(false);
    expect(isValidEncryptedToken("only:two")).toBe(false);
  });
});

describe("backwards compatibility with SLACK_ENCRYPTION_KEY", () => {
  const VALID_KEY = "a".repeat(64);

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_OLD;
    delete process.env.SLACK_ENCRYPTION_KEY;
    vi.resetModules();
  });

  it("falls back to SLACK_ENCRYPTION_KEY when ENCRYPTION_KEY is not set", async () => {
    process.env.SLACK_ENCRYPTION_KEY = VALID_KEY;
    const { encryptToken, decryptToken } = await import("./encryption");
    const encrypted = encryptToken("test-fallback");
    expect(decryptToken(encrypted)).toBe("test-fallback");
  });

  it("prefers ENCRYPTION_KEY over SLACK_ENCRYPTION_KEY", async () => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
    process.env.SLACK_ENCRYPTION_KEY = "b".repeat(64);
    const { encryptToken, decryptToken } = await import("./encryption");
    const encrypted = encryptToken("test-prefer");
    // Should decrypt with primary key
    expect(decryptToken(encrypted)).toBe("test-prefer");
  });
});

describe("key rotation", () => {
  const OLD_KEY = "a".repeat(64);
  const NEW_KEY = "b".repeat(64);

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_OLD;
    delete process.env.SLACK_ENCRYPTION_KEY;
    vi.resetModules();
  });

  it("decrypts data encrypted with old key after rotation", async () => {
    // Encrypt with old key
    process.env.ENCRYPTION_KEY = OLD_KEY;
    const { encryptToken } = await import("./encryption");
    const encrypted = encryptToken("secret-data");

    // Rotate: new key is primary, old key is retained
    vi.resetModules();
    process.env.ENCRYPTION_KEY = NEW_KEY;
    process.env.ENCRYPTION_KEY_OLD = OLD_KEY;
    const { decryptToken } = await import("./encryption");
    expect(decryptToken(encrypted)).toBe("secret-data");
  });

  it("encrypts new data with new key after rotation", async () => {
    process.env.ENCRYPTION_KEY = NEW_KEY;
    process.env.ENCRYPTION_KEY_OLD = OLD_KEY;
    const { encryptToken, decryptToken } = await import("./encryption");
    const encrypted = encryptToken("new-secret");

    // Remove old key — should still decrypt because it was encrypted with new key
    vi.resetModules();
    delete process.env.ENCRYPTION_KEY_OLD;
    process.env.ENCRYPTION_KEY = NEW_KEY;
    const mod = await import("./encryption");
    expect(mod.decryptToken(encrypted)).toBe("new-secret");
  });

  it("decrypts data from SLACK_ENCRYPTION_KEY during migration", async () => {
    // Data encrypted with legacy env var
    process.env.SLACK_ENCRYPTION_KEY = OLD_KEY;
    const { encryptToken } = await import("./encryption");
    const encrypted = encryptToken("legacy-data");

    // Migrate to new env var with different key
    vi.resetModules();
    process.env.ENCRYPTION_KEY = NEW_KEY;
    process.env.SLACK_ENCRYPTION_KEY = OLD_KEY;
    const { decryptToken } = await import("./encryption");
    expect(decryptToken(encrypted)).toBe("legacy-data");
  });

  it("throws descriptive error when no key can decrypt", async () => {
    // Encrypt with one key
    process.env.ENCRYPTION_KEY = OLD_KEY;
    const { encryptToken } = await import("./encryption");
    const encrypted = encryptToken("secret");

    // Configure completely different keys
    vi.resetModules();
    process.env.ENCRYPTION_KEY = "c".repeat(64);
    process.env.ENCRYPTION_KEY_OLD = "d".repeat(64);
    const { decryptToken } = await import("./encryption");

    expect(() => decryptToken(encrypted)).toThrow(/tried 2 key\(s\)/);
  });
});

describe("isEncryptionAvailable", () => {
  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.SLACK_ENCRYPTION_KEY;
    vi.resetModules();
  });

  it("returns true when ENCRYPTION_KEY is set and valid", async () => {
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    const { isEncryptionAvailable } = await import("./encryption");
    expect(isEncryptionAvailable()).toBe(true);
  });

  it("returns true when only SLACK_ENCRYPTION_KEY is set (fallback)", async () => {
    process.env.SLACK_ENCRYPTION_KEY = "a".repeat(64);
    const { isEncryptionAvailable } = await import("./encryption");
    expect(isEncryptionAvailable()).toBe(true);
  });

  it("returns false when no key is set", async () => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.SLACK_ENCRYPTION_KEY;
    const { isEncryptionAvailable } = await import("./encryption");
    expect(isEncryptionAvailable()).toBe(false);
  });

  it("returns false when key is wrong length", async () => {
    process.env.ENCRYPTION_KEY = "abcd";
    const { isEncryptionAvailable } = await import("./encryption");
    expect(isEncryptionAvailable()).toBe(false);
  });
});

describe("encryptUrl / decryptUrl", () => {
  const VALID_KEY = "a".repeat(64);

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.SLACK_ENCRYPTION_KEY;
    vi.resetModules();
  });

  it("encrypts and decrypts a URL round-trip", async () => {
    const { encryptUrl, decryptUrl, isValidEncryptedToken } = await import("./encryption");
    const url = "https://hooks.zapier.com/hooks/catch/123/abc";
    const encrypted = encryptUrl(url);
    expect(encrypted).not.toBe(url);
    expect(isValidEncryptedToken(encrypted)).toBe(true);
    expect(decryptUrl(encrypted)).toBe(url);
  });

  it("throws when encryption key is not set", async () => {
    delete process.env.ENCRYPTION_KEY;
    const { encryptUrl } = await import("./encryption");
    expect(() => encryptUrl("https://example.com/webhook")).toThrow("ENCRYPTION_KEY");
  });

  it("decryptUrl returns plaintext URLs as-is (legacy rows)", async () => {
    const { decryptUrl } = await import("./encryption");
    const url = "https://example.com/webhook";
    expect(decryptUrl(url)).toBe(url);
  });

  it("decryptUrl throws when value is encrypted but key is missing", async () => {
    const { encryptUrl, decryptUrl } = await import("./encryption");
    const url = "https://hooks.zapier.com/abc";
    const encrypted = encryptUrl(url);
    delete process.env.ENCRYPTION_KEY;
    expect(() => decryptUrl(encrypted)).toThrow("Cannot decrypt URL");
  });
});

describe("hashUrl", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("produces a deterministic SHA-256 hex hash", async () => {
    const { hashUrl } = await import("./encryption");
    const url = "https://hooks.zapier.com/abc";
    const hash1 = hashUrl(url);
    const hash2 = hashUrl(url);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different URLs", async () => {
    const { hashUrl } = await import("./encryption");
    expect(hashUrl("https://a.com")).not.toBe(hashUrl("https://b.com"));
  });
});
