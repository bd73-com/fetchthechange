import { z } from 'zod';
import { insertMonitorSchema, monitors, monitorChanges, notificationPreferences, notificationChannels, deliveryLog, slackConnections, apiKeys, tags, monitorConditions } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
};

export const ERROR_LOG_SOURCES = [
  "scraper",
  "email",
  "scheduler",
  "api",
  "stripe",
  "resend",
  "browserless",
] as const;

export const errorLogSourceSchema = z.enum(ERROR_LOG_SOURCES);

export const contactFormSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  category: z.enum(["bug", "feature", "billing", "general"], {
    required_error: "Please select a category",
  }),
  subject: z.string().min(3, "Subject must be at least 3 characters").max(200, "Subject must be under 200 characters"),
  message: z.string().min(10, "Message must be at least 10 characters").max(5000, "Message must be under 5000 characters"),
});

const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const notificationPreferencesInputSchema = z.object({
  quietHoursStart: z.string().regex(hhmmRegex, "Must be HH:MM format").nullable().optional(),
  quietHoursEnd: z.string().regex(hhmmRegex, "Must be HH:MM format").nullable().optional(),
  timezone: z.string().nullable().optional(),
  digestMode: z.boolean().optional(),
  sensitivityThreshold: z.number().int().min(0).max(10000).optional(),
  notificationEmail: z.string().email("Must be a valid email").nullable().optional(),
}).refine(
  (data) => {
    const hasStart = data.quietHoursStart != null;
    const hasEnd = data.quietHoursEnd != null;
    return hasStart === hasEnd;
  },
  { message: "Both quietHoursStart and quietHoursEnd must be set or both null" }
).refine(
  (data) => {
    if (data.quietHoursStart != null && data.quietHoursEnd != null) {
      return data.timezone != null && data.timezone !== "";
    }
    return true;
  },
  { message: "Timezone is required when quiet hours are set" }
);

export const channelTypeSchema = z.enum(["email", "webhook", "slack"]);

export const webhookConfigInputSchema = z.object({
  url: z.string().url("Must be a valid URL"),
});

export const slackConfigInputSchema = z.object({
  channelId: z.string().min(1, "Channel ID is required"),
  channelName: z.string(),
});

export const emailConfigInputSchema = z.object({});

export const channelInputSchema = z.object({
  enabled: z.boolean(),
  config: z.union([webhookConfigInputSchema, slackConfigInputSchema, emailConfigInputSchema]),
});

export const PRESET_COLOURS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280", "#0f172a",
] as const;

export const createTagSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(32, "Name must be 32 characters or fewer"),
  colour: z.enum(PRESET_COLOURS, { errorMap: () => ({ message: "Invalid colour" }) }),
});

export const updateTagSchema = createTagSchema.partial().refine(
  (data) => data.name !== undefined || data.colour !== undefined,
  { message: "At least one field (name or colour) is required" }
);

export const setMonitorTagsSchema = z.object({
  tagIds: z.array(z.number().int().positive()).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: "Duplicate tag IDs are not allowed" }
  ),
});

export const conditionTypeSchema = z.enum([
  "numeric_lt", "numeric_lte", "numeric_gt", "numeric_gte",
  "numeric_change_pct", "text_contains", "text_not_contains",
  "text_equals", "regex",
]);

export const createConditionSchema = z.object({
  type: conditionTypeSchema,
  value: z.string().min(1).max(500),
  groupIndex: z.number().int().min(0).max(9).default(0),
});

export const tagResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  colour: z.string(),
});

export const api = {
  monitors: {
    list: {
      method: 'GET' as const,
      path: '/api/monitors',
      responses: {
        200: z.array(z.custom<typeof monitors.$inferSelect>()),
        401: errorSchemas.unauthorized,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/monitors/:id',
      responses: {
        200: z.custom<typeof monitors.$inferSelect>(),
        404: errorSchemas.notFound,
        401: errorSchemas.unauthorized,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/monitors',
      input: insertMonitorSchema,
      responses: {
        201: z.custom<typeof monitors.$inferSelect & { selectorWarning?: string }>(),
        400: errorSchemas.validation,
        401: errorSchemas.unauthorized,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/monitors/:id',
      input: insertMonitorSchema.partial(),
      responses: {
        200: z.custom<typeof monitors.$inferSelect>(),
        404: errorSchemas.notFound,
        401: errorSchemas.unauthorized,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/monitors/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
        401: errorSchemas.unauthorized,
      },
    },
    history: {
      method: 'GET' as const,
      path: '/api/monitors/:id/history',
      responses: {
        200: z.array(z.custom<typeof monitorChanges.$inferSelect>()),
        404: errorSchemas.notFound,
        401: errorSchemas.unauthorized,
      },
    },
    check: {
      method: 'POST' as const,
      path: '/api/monitors/:id/check',
      responses: {
        200: z.object({ 
          changed: z.boolean(), 
          currentValue: z.string().nullable(),
          status: z.string().optional(),
          error: z.string().nullable().optional(),
        }),
        404: errorSchemas.notFound,
        401: errorSchemas.unauthorized,
      }
    },
    suggestSelectors: {
      method: 'POST' as const,
      path: '/api/monitors/:id/suggest-selectors',
      input: z.object({ expectedText: z.string().optional() }),
      responses: {
        200: z.object({
          currentSelector: z.object({
            selector: z.string(),
            count: z.number(),
            valid: z.boolean(),
          }),
          suggestions: z.array(z.object({
            selector: z.string(),
            count: z.number(),
            sampleText: z.string(),
          })),
        }),
        404: errorSchemas.notFound,
        401: errorSchemas.unauthorized,
      }
    },
    setTags: {
      method: 'PUT' as const,
      path: '/api/monitors/:id/tags',
      input: setMonitorTagsSchema,
      responses: {
        200: z.custom<typeof monitors.$inferSelect & { tags: { id: number; name: string; colour: string }[] }>(),
        404: errorSchemas.notFound,
        401: errorSchemas.unauthorized,
        422: errorSchemas.validation,
      },
    },
    channels: {
      list: {
        method: 'GET' as const,
        path: '/api/monitors/:id/channels',
        responses: {
          200: z.array(z.custom<typeof notificationChannels.$inferSelect>()),
          404: errorSchemas.notFound,
          401: errorSchemas.unauthorized,
        },
      },
      put: {
        method: 'PUT' as const,
        path: '/api/monitors/:id/channels/:channel',
        input: channelInputSchema,
        responses: {
          200: z.custom<typeof notificationChannels.$inferSelect>(),
          404: errorSchemas.notFound,
          401: errorSchemas.unauthorized,
          403: z.object({ message: z.string(), code: z.string().optional() }),
          422: errorSchemas.validation,
        },
      },
      delete: {
        method: 'DELETE' as const,
        path: '/api/monitors/:id/channels/:channel',
        responses: {
          204: z.void(),
          404: errorSchemas.notFound,
          401: errorSchemas.unauthorized,
        },
      },
      revealSecret: {
        method: 'POST' as const,
        path: '/api/monitors/:id/channels/webhook/reveal-secret',
        responses: {
          200: z.object({ secret: z.string() }),
          404: errorSchemas.notFound,
          401: errorSchemas.unauthorized,
          429: z.object({ message: z.string() }),
        },
      },
      deliveries: {
        method: 'GET' as const,
        path: '/api/monitors/:id/deliveries',
        responses: {
          200: z.array(z.custom<typeof deliveryLog.$inferSelect>()),
          404: errorSchemas.notFound,
          401: errorSchemas.unauthorized,
        },
      },
    },
    conditions: {
      list: {
        method: 'GET' as const,
        path: '/api/monitors/:id/conditions',
        responses: {
          200: z.array(z.custom<typeof monitorConditions.$inferSelect>()),
          404: errorSchemas.notFound,
          401: errorSchemas.unauthorized,
        },
      },
      create: {
        method: 'POST' as const,
        path: '/api/monitors/:id/conditions',
        input: createConditionSchema,
        responses: {
          201: z.custom<typeof monitorConditions.$inferSelect>(),
          403: z.object({ message: z.string(), code: z.string() }),
          404: errorSchemas.notFound,
          401: errorSchemas.unauthorized,
          422: errorSchemas.validation,
        },
      },
      delete: {
        method: 'DELETE' as const,
        path: '/api/monitors/:id/conditions/:conditionId',
        responses: {
          204: z.void(),
          404: errorSchemas.notFound,
          401: errorSchemas.unauthorized,
        },
      },
    },
    notificationPreferences: {
      get: {
        method: 'GET' as const,
        path: '/api/monitors/:id/notification-preferences',
        responses: {
          200: z.custom<typeof notificationPreferences.$inferSelect>(),
          404: errorSchemas.notFound,
          401: errorSchemas.unauthorized,
        },
      },
      put: {
        method: 'PUT' as const,
        path: '/api/monitors/:id/notification-preferences',
        input: notificationPreferencesInputSchema,
        responses: {
          200: z.custom<typeof notificationPreferences.$inferSelect>(),
          404: errorSchemas.notFound,
          401: errorSchemas.unauthorized,
          422: errorSchemas.validation,
        },
      },
      delete: {
        method: 'DELETE' as const,
        path: '/api/monitors/:id/notification-preferences',
        responses: {
          204: z.void(),
          404: errorSchemas.notFound,
          401: errorSchemas.unauthorized,
        },
      },
    },
  },
  tags: {
    list: {
      method: 'GET' as const,
      path: '/api/tags',
      responses: {
        200: z.array(z.custom<typeof tags.$inferSelect>()),
        401: errorSchemas.unauthorized,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/tags',
      input: createTagSchema,
      responses: {
        201: z.custom<typeof tags.$inferSelect>(),
        400: z.object({ message: z.string(), code: z.string().optional() }),
        401: errorSchemas.unauthorized,
        409: z.object({ message: z.string(), code: z.string() }),
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/tags/:id',
      input: updateTagSchema,
      responses: {
        200: z.custom<typeof tags.$inferSelect>(),
        404: errorSchemas.notFound,
        401: errorSchemas.unauthorized,
        409: z.object({ message: z.string(), code: z.string() }),
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/tags/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
        401: errorSchemas.unauthorized,
      },
    },
  },
  integrations: {
    slack: {
      install: {
        method: 'GET' as const,
        path: '/api/integrations/slack/install',
        responses: {
          302: z.void(),
          400: z.object({ message: z.string(), code: z.string() }),
          401: errorSchemas.unauthorized,
          403: z.object({ message: z.string(), code: z.string().optional() }),
          501: z.object({ message: z.string() }),
          503: z.object({ message: z.string(), code: z.string().optional() }),
        },
      },
      callback: {
        method: 'GET' as const,
        path: '/api/integrations/slack/callback',
        responses: {
          302: z.void(),
        },
      },
      status: {
        method: 'GET' as const,
        path: '/api/integrations/slack/status',
        responses: {
          200: z.object({
            connected: z.boolean(),
            available: z.boolean(),
            teamName: z.string().optional(),
            unavailableReason: z.enum(["tables-not-ready", "oauth-not-configured"]).optional(),
          }),
          401: errorSchemas.unauthorized,
        },
      },
      disconnect: {
        method: 'DELETE' as const,
        path: '/api/integrations/slack',
        responses: {
          204: z.void(),
          401: errorSchemas.unauthorized,
        },
      },
      channels: {
        method: 'GET' as const,
        path: '/api/integrations/slack/channels',
        responses: {
          200: z.array(z.object({ id: z.string(), name: z.string() })),
          401: errorSchemas.unauthorized,
          404: z.object({ message: z.string() }),
        },
      },
    },
  },
  support: {
    contact: {
      method: 'POST' as const,
      path: '/api/support/contact',
      input: contactFormSchema,
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        400: errorSchemas.validation,
        401: errorSchemas.unauthorized,
      },
    },
  },
};

// --------------------------------------------------------------------------
// API v1 — public REST API (Bearer token auth)
// --------------------------------------------------------------------------

export const apiV1PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const apiV1ChangesPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const apiV1CreateMonitorSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  url: z.string().url("Must be a valid URL"),
  selector: z.string().min(1, "Selector is required"),
  frequency: z.enum(["daily", "hourly"]).optional().default("daily"),
  active: z.boolean().optional().default(true),
});

export const apiV1UpdateMonitorSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: z.string().url("Must be a valid URL").optional(),
  selector: z.string().min(1).optional(),
  frequency: z.enum(["daily", "hourly"]).optional(),
  active: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
});

export const apiV1CreateKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(64, "Name must be 64 characters or fewer"),
});

// Zapier REST Hooks schemas
export const zapierSubscribeSchema = z.object({
  hookUrl: z.string().url().max(2048, "Hook URL must be under 2048 characters")
    .refine((url) => url.startsWith("https://"), { message: "Hook URL must use HTTPS" }),
  monitorId: z.number().int().positive().optional(),
});

export const zapierUnsubscribeSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const zapierChangesQuerySchema = z.object({
  monitorId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

export const apiV1 = {
  ping: { method: 'GET' as const, path: '/api/v1/ping' },
  openapi: { method: 'GET' as const, path: '/api/v1/openapi.json' },
  monitors: {
    list: { method: 'GET' as const, path: '/api/v1/monitors' },
    create: { method: 'POST' as const, path: '/api/v1/monitors' },
    get: { method: 'GET' as const, path: '/api/v1/monitors/:id' },
    update: { method: 'PATCH' as const, path: '/api/v1/monitors/:id' },
    delete: { method: 'DELETE' as const, path: '/api/v1/monitors/:id' },
    changes: { method: 'GET' as const, path: '/api/v1/monitors/:id/changes' },
  },
  keys: {
    list: { method: 'GET' as const, path: '/api/keys' },
    create: { method: 'POST' as const, path: '/api/keys' },
    revoke: { method: 'DELETE' as const, path: '/api/keys/:id' },
  },
  zapier: {
    subscribe: { method: 'POST' as const, path: '/api/v1/zapier/subscribe' },
    unsubscribe: { method: 'DELETE' as const, path: '/api/v1/zapier/unsubscribe' },
    monitors: { method: 'GET' as const, path: '/api/v1/zapier/monitors' },
    changes: { method: 'GET' as const, path: '/api/v1/zapier/changes' },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
