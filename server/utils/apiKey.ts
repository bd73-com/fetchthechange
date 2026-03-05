import { randomBytes, createHash } from "node:crypto";

const KEY_PREFIX = "ftc_";
const PREFIX_LENGTH = 12;

/** Generate a new raw API key: ftc_ + 32 random hex bytes (68 chars total). */
export function generateRawKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("hex");
}

/** SHA-256 hash a raw API key for storage. */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** Extract the display prefix (first 12 chars) from a raw key. */
export function extractKeyPrefix(rawKey: string): string {
  return rawKey.substring(0, PREFIX_LENGTH);
}
