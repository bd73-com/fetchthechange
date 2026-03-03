import { z } from 'zod';
import { insertMonitorSchema, monitors, monitorChanges, notificationPreferences } from './schema';

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
