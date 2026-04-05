import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("encryption", () => {
  const VALID_KEY = "a".repeat(64); // 32 bytes hex-encoded

  beforeEach(() => {
    process.env.SLACK_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.SLACK_ENCRYPTION_KEY;
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

  it("throws when SLACK_ENCRYPTION_KEY is missing", async () => {
    delete process.env.SLACK_ENCRYPTION_KEY;
    const { encryptToken } = await import("./encryption");
    expect(() => encryptToken("test")).toThrow("SLACK_ENCRYPTION_KEY");
  });

  it("throws when SLACK_ENCRYPTION_KEY is wrong length", async () => {
    process.env.SLACK_ENCRYPTION_KEY = "tooshort";
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

describe("isEncryptionAvailable", () => {
  afterEach(() => {
    delete process.env.SLACK_ENCRYPTION_KEY;
    vi.resetModules();
  });

  it("returns true when key is set and valid", async () => {
    process.env.SLACK_ENCRYPTION_KEY = "a".repeat(64);
    const { isEncryptionAvailable } = await import("./encryption");
    expect(isEncryptionAvailable()).toBe(true);
  });

  it("returns false when key is not set", async () => {
    delete process.env.SLACK_ENCRYPTION_KEY;
    const { isEncryptionAvailable } = await import("./encryption");
    expect(isEncryptionAvailable()).toBe(false);
  });

  it("returns false when key is wrong length", async () => {
    process.env.SLACK_ENCRYPTION_KEY = "abcd";
    const { isEncryptionAvailable } = await import("./encryption");
    expect(isEncryptionAvailable()).toBe(false);
  });
});

describe("encryptUrl / decryptUrl", () => {
  const VALID_KEY = "a".repeat(64);

  beforeEach(() => {
    process.env.SLACK_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
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
    delete process.env.SLACK_ENCRYPTION_KEY;
    const { encryptUrl } = await import("./encryption");
    expect(() => encryptUrl("https://example.com/webhook")).toThrow("SLACK_ENCRYPTION_KEY");
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
    delete process.env.SLACK_ENCRYPTION_KEY;
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
