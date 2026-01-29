// 1. IMPORT POLYFILLS IMMEDIATELY
import { File, Blob } from 'node:buffer';

// 2. APPLY FIX BEFORE LOADING ANYTHING ELSE
// @ts-ignore
if (typeof global.File === 'undefined') {
  // @ts-ignore
  global.File = File;
}
// @ts-ignore
if (typeof global.Blob === 'undefined') {
  // @ts-ignore
  global.Blob = Blob;
}

// 3. CONFIGURE ENVIRONMENT
process.env.PLAYWRIGHT_BROWSERS_PATH = '/nix/store';

// 4. LOAD APP DYNAMICALLY (To prevent hoisting crashes)
(async () => {
  const express = (await import("express")).default;
  const { createServer } = await import("http");
  const { registerRoutes } = await import("./routes");
  const { serveStatic } = await import("./static");
  const { runMigrations } = await import("stripe-replit-sync");
  const { getStripeSync } = await import("./stripeClient");
  const { WebhookHandlers } = await import("./webhookHandlers");

  const app = express();
  const httpServer = createServer(app);

  // Initialize Stripe schema and sync
  async function initStripe() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.log('DATABASE_URL not set, skipping Stripe initialization');
      return;
    }

    try {
      console.log('Initializing Stripe schema...');
      await runMigrations({ databaseUrl });
      console.log('Stripe schema ready');

      const stripeSync = await getStripeSync();

      console.log('Setting up managed webhook...');
      const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
      const { webhook } = await stripeSync.findOrCreateManagedWebhook(
        `${webhookBaseUrl}/api/stripe/webhook`
      );
      console.log(`Webhook configured: ${webhook.url}`);

      console.log('Syncing Stripe data...');
      stripeSync.syncBackfill()
        .then(() => console.log('Stripe data synced'))
        .catch((err: any) => console.error('Error syncing Stripe data:', err));
    } catch (error) {
      console.error('Failed to initialize Stripe:', error);
    }
  }

  await initStripe();

  // Stripe webhook route MUST be before express.json()
  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const signature = req.headers['stripe-signature'];
      if (!signature) {
        return res.status(400).json({ error: 'Missing stripe-signature' });
      }

      try {
        const sig = Array.isArray(signature) ? signature[0] : signature;
        if (!Buffer.isBuffer(req.body)) {
          console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
          return res.status(500).json({ error: 'Webhook processing error' });
        }

        await WebhookHandlers.processWebhook(req.body as Buffer, sig);
        res.status(200).json({ received: true });
      } catch (error: any) {
        console.error('Webhook error:', error.message);
        res.status(400).json({ error: 'Webhook processing error' });
      }
    }
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Logging Middleware
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }
        console.log(logLine);
      }
    });

    next();
  });

  // Register API Routes
  await registerRoutes(httpServer, app);

  // Error Handler
  app.use((err: any, _req: any, res: any, next: any) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });

  // Setup Vite or Static Files
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  } else {
    serveStatic(app);
  }

  // Start Server
  const port = 5000;
  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    console.log(`serving on port ${port}`);
  });
})();
