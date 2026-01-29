import { z } from 'zod';
import { insertMonitorSchema, monitors, monitorChanges } from './schema';

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
        201: z.custom<typeof monitors.$inferSelect>(),
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
    }
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
