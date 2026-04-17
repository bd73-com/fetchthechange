import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { isCrawlerUserAgent, rewriteIndexHtmlForCrawler } from "./crawlerMeta";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (req, res) => {
    const indexPath = path.resolve(distPath, "index.html");
    // Bots that don't execute JS need per-route OG/Twitter meta in the
    // initial HTML to unfurl correctly. Humans get the normal SPA bootstrap.
    // See GitHub issue #440.
    if (isCrawlerUserAgent(req.get("user-agent"))) {
      try {
        const template = fs.readFileSync(indexPath, "utf-8");
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const html = rewriteIndexHtmlForCrawler(template, req.path, baseUrl);
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
