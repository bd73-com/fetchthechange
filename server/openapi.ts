export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "FetchTheChange API",
    version: "1.0.0",
    description:
      "The FetchTheChange REST API lets Power-tier users create and manage website change monitors programmatically, pull change history into external dashboards, and integrate FetchTheChange into CI/CD pipelines.",
  },
  servers: [{ url: "https://ftc.bd73.com/api/v1" }],
  security: [{ BearerAuth: [] }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "API key prefixed with ftc_. Pass as: Authorization: Bearer ftc_...",
      },
    },
    schemas: {
      Monitor: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          url: { type: "string", format: "uri" },
          selector: { type: "string" },
          active: { type: "boolean" },
          emailEnabled: { type: "boolean" },
          checkInterval: { type: "string", enum: ["daily", "hourly"] },
          lastCheckedAt: { type: "string", format: "date-time", nullable: true },
          lastValue: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      Change: {
        type: "object",
        properties: {
          id: { type: "integer" },
          monitorId: { type: "integer" },
          oldValue: { type: "string", nullable: true },
          newValue: { type: "string", nullable: true },
          detectedAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      PaginationMeta: {
        type: "object",
        properties: {
          total: { type: "integer" },
          page: { type: "integer" },
          limit: { type: "integer" },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string" },
          code: { type: "string" },
        },
        required: ["error", "code"],
      },
    },
  },
  paths: {
    "/ping": {
      get: {
        summary: "Test API key validity",
        description: "Returns the authenticated user ID and key prefix. Does not count against rate limits.",
        responses: {
          "200": {
            description: "Key is valid",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    userId: { type: "string" },
                    keyPrefix: { type: "string" },
                  },
                },
              },
            },
          },
          "401": { description: "Invalid or revoked API key", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/openapi.json": {
      get: {
        summary: "OpenAPI specification",
        description: "Returns this OpenAPI 3.1 specification as JSON. No authentication required.",
        security: [],
        responses: {
          "200": { description: "The OpenAPI spec" },
        },
      },
    },
    "/monitors": {
      get: {
        summary: "List monitors",
        description: "Returns a paginated list of all monitors owned by the authenticated user.",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
        ],
        responses: {
          "200": {
            description: "Paginated monitor list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Monitor" } },
                    meta: { $ref: "#/components/schemas/PaginationMeta" },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: "Create a monitor",
        description: "Creates a new website change monitor. The URL is validated against SSRF.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "url", "selector"],
                properties: {
                  name: { type: "string", maxLength: 255 },
                  url: { type: "string", format: "uri" },
                  selector: { type: "string" },
                  frequency: { type: "string", enum: ["daily", "hourly"], default: "daily" },
                  active: { type: "boolean", default: true },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Monitor created", content: { "application/json": { schema: { $ref: "#/components/schemas/Monitor" } } } },
          "422": { description: "Validation error or SSRF blocked", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/monitors/{id}": {
      get: {
        summary: "Get a monitor",
        description: "Returns a single monitor by ID. Must be owned by the authenticated user.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          "200": { description: "Monitor details", content: { "application/json": { schema: { $ref: "#/components/schemas/Monitor" } } } },
          "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
      patch: {
        summary: "Update a monitor",
        description: "Partially updates a monitor. If url is provided, it is validated against SSRF.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", maxLength: 255 },
                  url: { type: "string", format: "uri" },
                  selector: { type: "string" },
                  frequency: { type: "string", enum: ["daily", "hourly"] },
                  active: { type: "boolean" },
                  emailEnabled: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated monitor", content: { "application/json": { schema: { $ref: "#/components/schemas/Monitor" } } } },
          "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "422": { description: "Validation error or SSRF blocked", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
      delete: {
        summary: "Delete a monitor",
        description: "Deletes a monitor and all associated data.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          "204": { description: "Deleted" },
          "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/monitors/{id}/changes": {
      get: {
        summary: "List changes for a monitor",
        description: "Returns a paginated list of detected changes for a monitor. Supports date range filtering.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
          { name: "from", in: "query", schema: { type: "string", format: "date-time" }, description: "Filter changes at or after this time (ISO 8601)" },
          { name: "to", in: "query", schema: { type: "string", format: "date-time" }, description: "Filter changes at or before this time (ISO 8601)" },
        ],
        responses: {
          "200": {
            description: "Paginated change list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Change" } },
                    meta: { $ref: "#/components/schemas/PaginationMeta" },
                  },
                },
              },
            },
          },
          "404": { description: "Monitor not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
  },
};
