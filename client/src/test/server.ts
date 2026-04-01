import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// Default handlers used across all hook test suites.
// Individual test files can override with server.use(...).
export const defaultHandlers = [
  // Session auth: return a minimal user fixture matching the User type from shared/models/auth.ts
  http.get("/api/auth/user", () =>
    HttpResponse.json({
      id: "user-1",
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
      profileImageUrl: null,
      tier: "power",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      notificationEmail: null,
      campaignUnsubscribed: false,
      unsubscribeToken: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    })
  ),
];

export const server = setupServer(...defaultHandlers);
