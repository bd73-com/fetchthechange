import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authStorage } from "../replit_integrations/auth/storage";
import { isAuthenticated } from "../replit_integrations/auth";
import { generateRawKey, hashApiKey, extractKeyPrefix } from "../utils/apiKey";
import { apiV1CreateKeySchema } from "@shared/routes";
import { API_RATE_LIMITS, type UserTier } from "@shared/models/auth";

const router = Router();

router.get("/", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const user = await authStorage.getUser(userId);
    const tier = ((user as any)?.tier || "free") as UserTier;
    if (tier !== "power") {
      return res.status(403).json({ message: "API access is available on the Power plan. Upgrade to generate API keys.", code: "TIER_LIMIT_REACHED" });
    }
    const keys = await storage.listApiKeys(userId);
    const safeKeys = keys.map(k => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));
    res.json(safeKeys);
  } catch (error: any) {
    console.error("[API Keys] List error:", error.message);
    res.status(500).json({ message: "Failed to list API keys" });
  }
});

router.post("/", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const user = await authStorage.getUser(userId);
    const tier = ((user as any)?.tier || "free") as UserTier;
    if (tier !== "power") {
      return res.status(403).json({ message: "API access is available on the Power plan. Upgrade to generate API keys.", code: "TIER_LIMIT_REACHED" });
    }

    const input = apiV1CreateKeySchema.parse(req.body);

    const activeCount = await storage.countActiveApiKeys(userId);
    if (activeCount >= API_RATE_LIMITS.maxKeysPerUser) {
      return res.status(400).json({ message: `You can have at most ${API_RATE_LIMITS.maxKeysPerUser} active API keys. Revoke an existing key before creating a new one.`, code: "KEY_LIMIT_REACHED" });
    }

    const rawKey = generateRawKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = extractKeyPrefix(rawKey);

    const apiKey = await storage.createApiKey(userId, input.name, keyHash, keyPrefix);

    console.log(`[API Keys] Created: userId=${userId} keyPrefix=${keyPrefix} name="${input.name}"`);

    res.status(201).json({
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      key: rawKey,
      createdAt: apiKey.createdAt,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
    }
    console.error("[API Keys] Create error:", err);
    res.status(500).json({ message: "Failed to create API key" });
  }
});

router.delete("/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const keyId = Number(req.params.id);
    if (isNaN(keyId)) {
      return res.status(400).json({ message: "Invalid key ID" });
    }

    const revoked = await storage.revokeApiKey(keyId, userId);
    if (!revoked) {
      return res.status(404).json({ message: "API key not found" });
    }

    console.log(`[API Keys] Revoked: userId=${userId} keyId=${keyId}`);
    res.status(204).send();
  } catch (error: any) {
    console.error("[API Keys] Revoke error:", error.message);
    res.status(500).json({ message: "Failed to revoke API key" });
  }
});

export default router;
