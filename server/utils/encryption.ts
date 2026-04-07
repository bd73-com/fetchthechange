import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function parseKeyHex(hex: string): Buffer | null {
  const key = Buffer.from(hex, "hex");
  return key.length === 32 ? key : null;
}

/**
 * Returns the primary encryption key (used for encrypting new data).
 * Checks ENCRYPTION_KEY first, falls back to SLACK_ENCRYPTION_KEY for
 * backwards compatibility.
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY ?? process.env.SLACK_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  const key = parseKeyHex(keyHex);
  if (!key) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex characters)");
  }
  return key;
}

/**
 * Returns all available decryption keys, primary first.
 * Supports key rotation: set ENCRYPTION_KEY to the new key and
 * ENCRYPTION_KEY_OLD to the previous key. Data encrypted with either
 * key can be decrypted. New encryptions always use the primary key.
 *
 * Also checks the legacy SLACK_ENCRYPTION_KEY for backwards compatibility.
 */
function getDecryptionKeys(): Buffer[] {
  const keys: Buffer[] = [];
  const seen = new Set<string>();

  for (const envVar of ["ENCRYPTION_KEY", "SLACK_ENCRYPTION_KEY", "ENCRYPTION_KEY_OLD"]) {
    const hex = process.env[envVar];
    if (hex && !seen.has(hex)) {
      const key = parseKeyHex(hex);
      if (key) {
        keys.push(key);
        seen.add(hex);
      }
    }
  }

  return keys;
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
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }
  const iv = Buffer.from(parts[0], "base64");
  const ciphertext = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");

  const keys = getDecryptionKeys();
  if (keys.length === 0) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }

  for (const key of keys) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString("utf8");
    } catch {
      // Try next key
    }
  }

  throw new Error(`Unable to decrypt: tried ${keys.length} key(s), none succeeded. Check ENCRYPTION_KEY configuration or data integrity.`);
}

/**
 * Returns true if an encryption key is configured and valid.
 */
export function isEncryptionAvailable(): boolean {
  const keyHex = process.env.ENCRYPTION_KEY ?? process.env.SLACK_ENCRYPTION_KEY;
  if (!keyHex) return false;
  return parseKeyHex(keyHex) !== null;
}

/**
 * Encrypt a URL for storage at rest. Throws if encryption key is unavailable.
 */
export function encryptUrl(url: string): string {
  return encryptToken(url);
}

/**
 * Decrypt a URL if it looks encrypted; return as-is if plaintext (e.g. legacy rows).
 * Throws if the value is encrypted but the key is unavailable — this surfaces
 * key misconfiguration clearly instead of passing ciphertext to callers.
 */
export function decryptUrl(value: string): string {
  if (!isValidEncryptedToken(value)) return value;
  if (!isEncryptionAvailable()) {
    throw new Error("Cannot decrypt URL: ENCRYPTION_KEY is not set but encrypted data exists in the database. Set the encryption key to restore access.");
  }
  return decryptToken(value);
}

/**
 * Deterministic SHA-256 hash of a URL for dedup index comparisons.
 */
export function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}
