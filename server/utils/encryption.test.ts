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
});
