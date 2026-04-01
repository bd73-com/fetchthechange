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

// 3. CONFIGURE GLOBAL FETCH CONNECTION POOL (must run before any fetch() call)
import "./utils/globalAgent";

// 4. CONFIGURE ENVIRONMENT
process.env.PLAYWRIGHT_BROWSERS_PATH = '/nix/store';

// 5. LOAD APP DYNAMICALLY (To prevent hoisting crashes)
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

  // Security headers — helmet is bundled in production builds;
  // in dev mode it may fail to resolve, so degrade gracefully.
  try {
    const helmet = (await import("helmet")).default;
    app.use(helmet({
      contentSecurityPolicy: false,  // CSP handled by Vite / static serving
      crossOriginEmbedderPolicy: false,  // Allow embedded resources
    }));
  } catch {
    if (process.env.NODE_ENV === "production") {
      console.error("FATAL: helmet failed to load in production — refusing to start without security headers");
      process.exit(1);
    }
    console.warn("WARNING: helmet not available — security headers disabled (dev mode)");
  }

  // Initialize Stripe schema and sync
  async function initStripe() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.log('DATABASE_URL not set, skipping Stripe initialization');
      return;
    }

    const initStart = Date.now();
    try {
      console.log('Initializing Stripe schema...');
      await runMigrations({ databaseUrl });
      console.log('Stripe schema ready');

      const stripeSync = await getStripeSync();

      console.log('Setting up managed webhook...');
      const replitDomain = process.env.REPLIT_DOMAINS?.split(',')[0];
      if (!replitDomain) {
        console.warn('REPLIT_DOMAINS not set, skipping managed webhook creation');
      } else {
        const webhookBaseUrl = `https://${replitDomain}`;
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
      }

      console.log('Starting Stripe data backfill...');
      void stripeSync.syncBackfill()
        .then(() => console.log('Stripe data synced'))
        .catch((err: any) => console.error('Error syncing Stripe data:', err));
      console.log(`Stripe initialization setup completed in ${Date.now() - initStart}ms`);
    } catch (error) {
      console.error(`Failed to initialize Stripe after ${Date.now() - initStart}ms:`, error);
      throw error;
    }
  }

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
        if (msg.includes('signature') || msg.includes('No signatures found') || msg.includes('timestamp')) {
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
        if (msg.includes('signature') || msg.includes('timestamp') || msg.includes('No signatures found')) {
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
  const { createCorsOriginChecker, SENSITIVE_LOG_PATHS } = await import("./middleware/cors");
  const allowedOrigins: string[] = [];
  if (process.env.REPLIT_DOMAINS) {
    for (const d of process.env.REPLIT_DOMAINS.split(',')) {
      allowedOrigins.push(`https://${d.trim()}`);
    }
  }
  const isDev = process.env.NODE_ENV !== 'production';
  if (!process.env.CHROME_EXTENSION_ID?.trim()) {
    console.warn('CHROME_EXTENSION_ID not set; chrome extension CORS requests will be rejected');
  }
  app.use(cors({
    origin: createCorsOriginChecker(allowedOrigins, isDev),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // CSRF protection: validate Origin header on state-changing requests
  const { csrfProtection } = await import("./middleware/csrf");
  app.use("/api/", csrfProtection(allowedOrigins, isDev));

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

  // Register API Routes (runs ensure* migrations that need DB connections)
  await registerRoutes(httpServer, app);

  // Bootstrap welcome campaign AFTER registerRoutes() completes —
  // sequenced before scheduler/Stripe to avoid DB pool exhaustion on cold starts.
  try {
    const { ensureAutomatedCampaignConfigsTable } = await import("./services/ensureTables");
    const campaignConfigsReady = await ensureAutomatedCampaignConfigsTable();
    if (campaignConfigsReady) {
      const { bootstrapWelcomeCampaign } = await import("./services/automatedCampaigns");
      await bootstrapWelcomeCampaign();
    }
  } catch (err) {
    const { ErrorLogger } = await import("./services/logger");
    console.error("[Bootstrap] Welcome campaign bootstrap failed:", err);
    await ErrorLogger.error("scheduler", "Welcome campaign bootstrap failed",
      err instanceof Error ? err : null,
      { errorMessage: err instanceof Error ? err.message : String(err) }
    ).catch(() => {});
  }

  // Start scheduler in the background AFTER registerRoutes() completes —
  // the ensure* migrations release their DB connections first, preventing
  // pool exhaustion that causes connection timeouts.
  const { startScheduler } = await import("./services/scheduler");
  const { ErrorLogger } = await import("./services/logger");
  (async () => {
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await startScheduler();
        console.log("Scheduler started successfully");
        return;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[CRITICAL] Scheduler startup failed (attempt ${attempt}/${maxRetries}): ${msg}`);
        if (attempt < maxRetries) {
          const delayMs = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
          console.log(`[Scheduler] Retrying in ${delayMs / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    console.error("[CRITICAL] Scheduler failed to start after all retries — monitoring is disabled. Exiting so the platform restarts the process.");
    try {
      await ErrorLogger.error("scheduler", "Scheduler failed to start after all retries — monitoring is disabled", null, { maxRetries });
    } catch { /* DB may be down — already logged to stderr */ }
    process.exit(1);
  })().catch((err) => {
    console.error("[CRITICAL] Scheduler IIFE unhandled error:", err);
    process.exit(1);
  });

  // Start Stripe initialization in the background AFTER registerRoutes()
  // completes — the ensure* migrations release their DB connections first,
  // preventing pool exhaustion that causes connection timeouts.
  // Webhook requests arriving before init finishes will fail signature
  // verification, but Stripe retries them.
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn("STRIPE_WEBHOOK_SECRET not set — webhooks will fail until managed webhook setup completes");
  }
  const MAX_STRIPE_INIT_ATTEMPTS = 5;
  const BASE_STRIPE_INIT_RETRY_MS = 5_000;

  const startStripeInitWithRetry = (attempt = 1): void => {
    initStripe().catch((err) => {
      console.error(`Stripe background init failed (attempt ${attempt}/${MAX_STRIPE_INIT_ATTEMPTS}):`, err);
      if (attempt >= MAX_STRIPE_INIT_ATTEMPTS) return;
      const delay = BASE_STRIPE_INIT_RETRY_MS * 2 ** (attempt - 1);
      setTimeout(() => startStripeInitWithRetry(attempt + 1), delay).unref();
    });
  };

  startStripeInitWithRetry();

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

  // Start Server — kill any stale process on the port first (Replit restarts
  // can leave zombies when the previous process didn't exit cleanly).
  const port = 5000;
  const { killStalePortProcess } = await import("./utils/portCleanup");
  const killedPid = killStalePortProcess(port);
  if (killedPid) {
    // Brief pause to let the OS reclaim the port
    await new Promise((r) => setTimeout(r, 500));
  }

  // Register error handler BEFORE listen() so EADDRINUSE is always caught
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`FATAL: port ${port} still in use after cleanup — exiting`);
      process.exit(1);
    }
    throw err;
  });

  httpServer.listen({ port, host: "0.0.0.0" }, () => {
    console.log(`serving on port ${port}`);
  });

  // Graceful shutdown: stop cron, close server, drain browser pool, close DB pool
  const cron = (await import("node-cron")).default;
  const { browserPool } = await import("./services/browserPool");
  const { stopScheduler } = await import("./services/scheduler");
  const { stopRouteTimers } = await import("./routes");
  const { pool: dbPool } = await import("./db");
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("Shutting down gracefully...");
    // Force exit after 10s if graceful shutdown stalls
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    // Stop all cron jobs first so they don't fire during cleanup
    console.log("Stopping cron jobs...");
    const tasks = cron.getTasks();
    tasks.forEach((task) => {
      task.stop();
    });
    // Wait for in-flight monitor checks to finish (up to 5s)
    const { waitForActiveChecks } = await import("./services/scheduler");
    await waitForActiveChecks(5000);
    // Stop accepting new connections and wait for in-flight requests to finish
    console.log("Closing HTTP server...");
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      // Close idle keep-alive connections after 3s (preserves active requests)
      setTimeout(() => {
        if (typeof httpServer.closeIdleConnections === "function") {
          httpServer.closeIdleConnections();
        }
      }, 3_000).unref();
      // Hard cutoff: force-close all connections at 9s (just before global 10s force-exit)
      setTimeout(() => {
        if (typeof httpServer.closeAllConnections === "function") {
          httpServer.closeAllConnections();
        }
      }, 9_000).unref();
    });
    // Stop cron jobs and intervals before closing DB pool
    console.log("Stopping scheduler and timers...");
    stopScheduler();
    stopRouteTimers();
    // Drain warm browsers
    let cleanupFailed = false;
    console.log("Draining browser pool...");
    await browserPool.drain().catch((err) => {
      cleanupFailed = true;
      console.error("Failed to drain browser pool:", err);
    });
    // Close StripeSync pool (separate pg.Pool from the main one)
    const { closeStripeSync } = await import("./stripeClient");
    await closeStripeSync().catch((err) => {
      cleanupFailed = true;
      console.error("Failed to close StripeSync pool:", err);
    });
    // Close DB connection pool
    console.log("Closing DB pool...");
    await dbPool.end().catch((err) => {
      cleanupFailed = true;
      console.error("Failed to close DB pool:", err);
    });
    // Close global fetch connection pool last — in-flight webhook deliveries
    // (from a cron tick that started before shutdown) may still need sockets.
    const { agent: globalAgent } = await import("./utils/globalAgent");
    await globalAgent.close().catch((err: unknown) => {
      cleanupFailed = true;
      console.error("Failed to close global agent:", err);
    });
    console.log("Shutdown complete.");
    process.exit(cleanupFailed ? 1 : 0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})().catch((err) => {
  console.error("FATAL: server failed to start", err);
  process.exit(1);
});
