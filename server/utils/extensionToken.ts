import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

function base64urlEncode(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf.toString("base64url");
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

function getSecret(): Buffer {
  const secret = process.env.EXTENSION_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "EXTENSION_JWT_SECRET is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  const buf = Buffer.from(secret, "hex");
  if (buf.length < 32) {
    throw new Error(
      "EXTENSION_JWT_SECRET must be at least 32 bytes (64 hex chars). Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return buf;
}

const HEADER = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

export function sign(userId: string, tier: string): string {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    tier,
    jti: randomUUID(),
    iat: now,
    exp: now + SEVEN_DAYS_SEC,
  };
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const sigInput = `${HEADER}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(sigInput).digest();
  return `${sigInput}.${base64urlEncode(signature)}`;
}

export function verify(token: string): { userId: string; tier: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, sig] = parts;
    const secret = getSecret();

    // Verify signature
    const expected = createHmac("sha256", secret)
      .update(`${header}.${payload}`)
      .digest();
    const actual = base64urlDecode(sig);

    if (expected.length !== actual.length) return null;
    if (!timingSafeEqual(expected, actual)) return null;

    // Decode payload
    const decoded = JSON.parse(base64urlDecode(payload).toString("utf8"));

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (typeof decoded.exp !== "number" || now > decoded.exp) return null;

    if (typeof decoded.sub !== "string" || typeof decoded.tier !== "string") {
      return null;
    }

    return { userId: decoded.sub, tier: decoded.tier };
  } catch {
    return null;
  }
}

export function getExpiresAt(): string {
  const d = new Date(Date.now() + SEVEN_DAYS_SEC * 1000);
  return d.toISOString();
}
