import rateLimit from "express-rate-limit";

export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => {
    // Key on the API key ID (set by apiKeyAuth middleware).
    // apiKeyAuth must run before this middleware — fail loudly if it didn't.
    if (!req.apiUser) {
      throw new Error("apiRateLimit: req.apiUser is not set — apiKeyAuth middleware must run first");
    }
    return String(req.apiUser.keyId);
  },
  handler: (_req: any, res) => {
    const keyPrefix = (_req as any).apiUser?.keyPrefix;
    if (keyPrefix) {
      console.warn(`[API] Rate limit exceeded: keyPrefix=${keyPrefix} ${_req.method} ${_req.path}`);
    }
    res.status(429).json({
      error: "Rate limit exceeded",
      code: "RATE_LIMIT_EXCEEDED",
    });
  },
});
