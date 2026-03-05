import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { storage } from "../storage";
import { authStorage } from "../replit_integrations/auth/storage";
import type { UserTier } from "@shared/models/auth";

export interface ApiUser {
  id: string;
  tier: UserTier;
  keyId: number;
  keyPrefix: string;
}

declare global {
  namespace Express {
    interface Request {
      apiUser?: ApiUser;
    }
  }
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export default async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header", code: "INVALID_API_KEY" });
    return;
  }

  const rawKey = authHeader.slice(7);
  if (!rawKey.startsWith("ftc_")) {
    res.status(401).json({ error: "Invalid API key format", code: "INVALID_API_KEY" });
    return;
  }

  let apiKey;
  try {
    const hash = hashKey(rawKey);
    apiKey = await storage.getApiKeyByHash(hash);
  } catch (err) {
    console.error("[API Auth] Key lookup failed unexpectedly:", err);
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
    return;
  }

  if (!apiKey || apiKey.revokedAt !== null) {
    res.status(401).json({ error: "Invalid or revoked API key", code: "INVALID_API_KEY" });
    return;
  }

  const user = await authStorage.getUser(apiKey.userId);
  if (!user) {
    res.status(401).json({ error: "Invalid API key", code: "INVALID_API_KEY" });
    return;
  }

  const tier = (user.tier || "free") as UserTier;
  if (tier !== "power") {
    res.status(403).json({ error: "API access requires a Power plan", code: "TIER_LIMIT_REACHED" });
    return;
  }

  // Fire-and-forget lastUsedAt update
  storage.touchApiKey(apiKey.id).catch(() => {});

  console.debug(`[API] Authenticated request: keyPrefix=${apiKey.keyPrefix} ${req.method} ${req.path}`);

  req.apiUser = {
    id: apiKey.userId,
    tier,
    keyId: apiKey.id,
    keyPrefix: apiKey.keyPrefix,
  };

  next();
}
