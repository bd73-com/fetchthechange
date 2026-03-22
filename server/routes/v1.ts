import { Router } from "express";
import { z } from "zod";
import apiKeyAuth from "../middleware/apiKeyAuth";
import { apiRateLimit } from "../middleware/apiRateLimit";
import { storage } from "../storage";
import {
  checkMonitorLimit,
  checkFrequencyTier,
  validateMonitorInput,
  safeHostname,
} from "../services/monitorValidation";
import {
  apiV1PaginationSchema,
  apiV1ChangesPaginationSchema,
  apiV1CreateMonitorSchema,
  apiV1UpdateMonitorSchema,
} from "@shared/routes";
import { openApiSpec } from "../openapi";

const router = Router();

/** Parse and validate a numeric route param. Returns the number or null. */
function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// -------------------------------------------------------------------
// OpenAPI spec — public, no auth, no rate limit
// -------------------------------------------------------------------
router.get("/openapi.json", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(openApiSpec);
});

// -------------------------------------------------------------------
// Apply API key auth to all remaining routes
// -------------------------------------------------------------------
router.use(apiKeyAuth);

// -------------------------------------------------------------------
// Apply rate limiting to all authenticated routes
// -------------------------------------------------------------------
router.use(apiRateLimit);

// -------------------------------------------------------------------
// Ping — validates key and rate-limited
// -------------------------------------------------------------------
router.get("/ping", (req: any, res) => {
  res.json({
    ok: true,
    keyPrefix: req.apiUser.keyPrefix,
  });
});

// -------------------------------------------------------------------
// Monitors — CRUD
// -------------------------------------------------------------------

// GET /api/v1/monitors
router.get("/monitors", async (req: any, res) => {
  try {
    const params = apiV1PaginationSchema.parse(req.query);
    const { data, total } = await storage.getMonitorsPaginated(
      req.apiUser.id,
      params.page,
      params.limit,
    );
    res.json({
      data: data.map(formatMonitor),
      meta: { total, page: params.page, limit: params.limit },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(422).json({ error: err.errors[0].message, code: "VALIDATION_ERROR" });
    }
    throw err;
  }
});

// POST /api/v1/monitors
router.post("/monitors", async (req: any, res) => {
  try {
    const input = apiV1CreateMonitorSchema.parse(req.body);

    // Check tier-based monitor limit
    const limitErr = await checkMonitorLimit(req.apiUser.id, req.apiUser.tier);
    if (limitErr) {
      return res.status(limitErr.status).json({ error: limitErr.error, code: limitErr.code });
    }

    // Frequency tier check
    const freqErr = checkFrequencyTier(input.frequency, req.apiUser.tier);
    if (freqErr) {
      return res.status(freqErr.status).json({ error: freqErr.error, code: freqErr.code });
    }

    // SSRF + CSS selector validation
    const validationErr = await validateMonitorInput(input.url, input.selector);
    if (validationErr) {
      if (validationErr.code === "SSRF_BLOCKED") {
        console.warn(`[API] SSRF blocked: keyPrefix=${req.apiUser.keyPrefix} hostname=${safeHostname(input.url)}`);
      }
      return res.status(validationErr.status).json({ error: validationErr.error, code: validationErr.code });
    }

    const monitor = await storage.createMonitor({
      ...input,
      userId: req.apiUser.id,
    } as any);

    res.status(201).json(formatMonitor(monitor));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(422).json({ error: err.errors[0].message, code: "VALIDATION_ERROR" });
    }
    throw err;
  }
});

// GET /api/v1/monitors/:id
router.get("/monitors/:id", async (req: any, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid monitor ID", code: "VALIDATION_ERROR" });
  const monitor = await storage.getMonitor(id);
  if (!monitor || monitor.userId !== req.apiUser.id) {
    return res.status(404).json({ error: "Monitor not found", code: "NOT_FOUND" });
  }
  res.json(formatMonitor(monitor));
});

// PATCH /api/v1/monitors/:id
router.patch("/monitors/:id", async (req: any, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid monitor ID", code: "VALIDATION_ERROR" });
    const existing = await storage.getMonitor(id);
    if (!existing || existing.userId !== req.apiUser.id) {
      return res.status(404).json({ error: "Monitor not found", code: "NOT_FOUND" });
    }

    const input = apiV1UpdateMonitorSchema.parse(req.body);

    // Frequency tier check
    if (input.frequency) {
      const freqErr = checkFrequencyTier(input.frequency, req.apiUser.tier);
      if (freqErr) {
        return res.status(freqErr.status).json({ error: freqErr.error, code: freqErr.code });
      }
    }

    // Validate only the fields being updated
    if (input.url || input.selector) {
      const validationErr = await validateMonitorInput(
        input.url ?? existing.url,
        input.selector,
      );
      if (validationErr) {
        if (validationErr.code === "SSRF_BLOCKED" && input.url) {
          console.warn(`[API] SSRF blocked on update: keyPrefix=${req.apiUser.keyPrefix} hostname=${safeHostname(input.url)}`);
        }
        return res.status(validationErr.status).json({ error: validationErr.error, code: validationErr.code });
      }
    }

    const updates: Record<string, any> = { ...input };
    if (input.active === true && !existing.active) {
      updates.consecutiveFailures = 0;
      updates.pauseReason = null;
    }

    const updated = await storage.updateMonitor(id, updates);
    res.json(formatMonitor(updated));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(422).json({ error: err.errors[0].message, code: "VALIDATION_ERROR" });
    }
    throw err;
  }
});

// DELETE /api/v1/monitors/:id
router.delete("/monitors/:id", async (req: any, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid monitor ID", code: "VALIDATION_ERROR" });
  const existing = await storage.getMonitor(id);
  if (!existing || existing.userId !== req.apiUser.id) {
    return res.status(404).json({ error: "Monitor not found", code: "NOT_FOUND" });
  }
  await storage.deleteMonitor(id);
  res.status(204).send();
});

// -------------------------------------------------------------------
// Change History
// -------------------------------------------------------------------

// GET /api/v1/monitors/:id/changes
router.get("/monitors/:id/changes", async (req: any, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid monitor ID", code: "VALIDATION_ERROR" });
    const monitor = await storage.getMonitor(id);
    if (!monitor || monitor.userId !== req.apiUser.id) {
      return res.status(404).json({ error: "Monitor not found", code: "NOT_FOUND" });
    }

    const params = apiV1ChangesPaginationSchema.parse(req.query);
    const { data, total } = await storage.getMonitorChangesPaginated(id, {
      page: params.page,
      limit: params.limit,
      from: params.from ? new Date(params.from) : undefined,
      to: params.to ? new Date(params.to) : undefined,
    });

    res.json({
      data: data.map(formatChange),
      meta: { total, page: params.page, limit: params.limit },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(422).json({ error: err.errors[0].message, code: "VALIDATION_ERROR" });
    }
    throw err;
  }
});

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function formatMonitor(m: any) {
  return {
    id: m.id,
    name: m.name,
    url: m.url,
    selector: m.selector,
    active: m.active,
    emailEnabled: m.emailEnabled,
    checkInterval: m.frequency,
    lastCheckedAt: m.lastChecked,
    lastValue: m.currentValue,
    createdAt: m.createdAt,
    updatedAt: m.lastChanged,
  };
}

function formatChange(c: any) {
  return {
    id: c.id,
    monitorId: c.monitorId,
    oldValue: c.oldValue,
    newValue: c.newValue,
    detectedAt: c.detectedAt,
    createdAt: c.detectedAt,
  };
}

export default router;
