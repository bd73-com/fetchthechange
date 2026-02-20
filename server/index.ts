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
  const { getStripeSync, setWebhookSecret, getWebhookSecret } = await import("./stripeClient");
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
      try {
        const result = await stripeSync.findOrCreateManagedWebhook(
          `${webhookBaseUrl}/api/stripe/webhook`
        );
        if (result?.secret) {
          setWebhookSecret(result.secret);
          console.log(`Webhook configured: ${result.url}`);
        } else if (result?.url) {
          console.log(`Webhook found (existing): ${result.url}`);
        }
      } catch (webhookError: any) {
        console.error('ERROR: Could not set up managed webhook:', webhookError.message);
        if (!getWebhookSecret()) {
          console.error(
            'CRITICAL: No webhook secret available. ' +
            'Set STRIPE_WEBHOOK_SECRET env var or fix managed webhook creation. ' +
            'Webhook signature verification will reject all events until this is resolved.'
          );
        }
      }

      console.log('Syncing Stripe data...');
      stripeSync.syncBackfill()
        .then(() => console.log('Stripe data synced'))
        .catch((err: any) => console.error('Error syncing Stripe data:', err));
    } catch (error) {
      console.error('Failed to initialize Stripe:', error);
    }
  }

  await initStripe();

  // Ensure campaign-related columns/tables exist in the database
  const { runAppMigrations } = await import("./db");
  await runAppMigrations();

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
        const msg = error.message || '';
        if (msg.includes('signature') || msg.includes('webhook') || msg.includes('No signatures found') || msg.includes('timestamp')) {
          const { ErrorLogger } = await import('./services/logger');
          await ErrorLogger.error('stripe', 'Webhook signature validation failed', error, {
            ip: req.ip,
          });
          return res.status(401).json({ error: 'Invalid signature' });
        }

        const { ErrorLogger } = await import('./services/logger');
        await ErrorLogger.error('stripe', 'Webhook processing failed', error);
        return res.status(500).json({ error: 'Processing failed' });
      }
    }
  );

  // Resend webhook route MUST be before express.json()
  app.post(
    '/api/webhooks/resend',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      try {
        const { verifyResendWebhook, handleResendWebhookEvent } = await import('./services/resendWebhook');

        if (!Buffer.isBuffer(req.body)) {
          return res.status(400).json({ error: 'Invalid request body' });
        }

        const event = await verifyResendWebhook(req.body, req.headers as Record<string, string | string[] | undefined>);
        await handleResendWebhookEvent(event);
        res.status(200).json({ received: true });
      } catch (error: any) {
        const msg = error.message || '';
        if (msg.includes('signature') || msg.includes('timestamp') || msg.includes('webhook')) {
          const { ErrorLogger } = await import('./services/logger');
          await ErrorLogger.error('email', 'Resend webhook signature validation failed', error, {
            ip: req.ip,
          });
          return res.status(401).json({ error: 'Invalid signature' });
        }

        const { ErrorLogger } = await import('./services/logger');
        await ErrorLogger.error('email', 'Resend webhook processing failed', error);
        return res.status(500).json({ error: 'Processing failed' });
      }
    }
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const cors = (await import("cors")).default;
  const allowedOrigins: string[] = [];
  if (process.env.REPLIT_DOMAINS) {
    for (const d of process.env.REPLIT_DOMAINS.split(',')) {
      allowedOrigins.push(`https://${d.trim()}`);
    }
  }
  const isDev = process.env.NODE_ENV !== 'production';
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (isDev) {
        try {
          const { hostname, protocol } = new URL(origin);
          if (
            protocol === "http:" &&
            (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
          ) {
            return callback(null, true);
          }
        } catch {}
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // CSRF protection: validate Origin header on state-changing requests
  const { csrfProtection } = await import("./middleware/csrf");
  app.use("/api/", csrfProtection(allowedOrigins, isDev));

  // Logging Middleware
  const SENSITIVE_LOG_PATHS = ['/api/stripe/', '/api/admin/', '/api/callback', '/api/login'];
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
          const isSensitive = SENSITIVE_LOG_PATHS.some(p => path.startsWith(p));
          if (isSensitive) {
            logLine += ` :: [body redacted]`;
          } else {
            const body = JSON.stringify(capturedJsonResponse);
            logLine += ` :: ${body.length > 500 ? body.substring(0, 500) + '...[truncated]' : body}`;
          }
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
    console.error("Internal Server Error:", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ message: "Internal Server Error" });
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
