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

  const app = express();
  const httpServer = createServer(app);

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
