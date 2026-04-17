import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { isCrawlerUserAgent, rewriteIndexHtmlForCrawler } from "./crawlerMeta";
import { getAppUrl } from "./utils/appUrl";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  const indexPath = path.resolve(distPath, "index.html");
  // Cache the template once at startup — it's built in, so it does not change
  // between deploys. Avoids a per-request fs.readFileSync on the crawler path
  // that could otherwise be amplified by a UA-spoofed flood.
  let cachedTemplate: string | null = null;
  const getCachedTemplate = (): string => {
    if (cachedTemplate === null) {
      cachedTemplate = fs.readFileSync(indexPath, "utf-8");
    }
    return cachedTemplate;
  };

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (req, res) => {
    // Bots that don't execute JS need per-route OG/Twitter meta in the
    // initial HTML to unfurl correctly. Humans get the normal SPA bootstrap.
    // See GitHub issue #440.
    if (isCrawlerUserAgent(req.get("user-agent"))) {
      try {
        // Use the pinned canonical origin from REPLIT_DOMAINS, not the
        // request's Host header. A crafted Host would otherwise be reflected
        // into og:url / canonical for crawlers and could be cached as SEO
        // poisoning or fake unfurl previews.
        const html = rewriteIndexHtmlForCrawler(
          getCachedTemplate(),
          req.path,
          getAppUrl(),
        );
        res.status(200).set({ "Content-Type": "text/html" }).send(html);
        return;
      } catch {
        // Fall through to sendFile if anything goes wrong — the human-facing
        // SPA path must never break for a bot.
      }
    }
    res.sendFile(indexPath);
  });
}
