import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const keyHex = process.env.SLACK_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error("SLACK_ENCRYPTION_KEY environment variable is not set");
  }
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("SLACK_ENCRYPTION_KEY must be 32 bytes (64 hex characters)");
  }
  return key;
}

const ENCRYPTED_TOKEN_RE = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

export function isValidEncryptedToken(value: string): boolean {
  if (!ENCRYPTED_TOKEN_RE.test(value)) return false;
  const [ivB64, ciphertextB64, tagB64] = value.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  return iv.length === IV_LENGTH && ciphertext.length > 0 && tag.length === TAG_LENGTH;
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv):base64(encrypted):base64(tag)
  return `${iv.toString("base64")}:${encrypted.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptToken(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }
  const iv = Buffer.from(parts[0], "base64");
  const ciphertext = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Returns true if SLACK_ENCRYPTION_KEY is configured and valid.
 */
export function isEncryptionAvailable(): boolean {
  const keyHex = process.env.SLACK_ENCRYPTION_KEY;
  if (!keyHex) return false;
  const key = Buffer.from(keyHex, "hex");
  return key.length === 32;
}

/**
 * Encrypt a URL if the encryption key is available; return plaintext otherwise.
 */
export function encryptUrl(url: string): string {
  if (!isEncryptionAvailable()) return url;
  return encryptToken(url);
}

/**
 * Decrypt a URL if it looks encrypted; return as-is if plaintext (e.g. legacy rows).
 */
export function decryptUrl(value: string): string {
  if (!isValidEncryptedToken(value)) return value;
  if (!isEncryptionAvailable()) return value;
  return decryptToken(value);
}

/**
 * Deterministic SHA-256 hash of a URL for dedup index comparisons.
 */
export function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}
