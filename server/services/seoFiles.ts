import { getAppUrl } from "../utils/appUrl";

export interface SitemapEntry {
  path: string;
  changefreq?:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority?: number;
  lastmod?: string;
}

// All paths must be kept in sync with the public routes registered in
// client/src/App.tsx and the blog post list in client/src/pages/Blog.tsx.
// The seo-assets.test.ts suite asserts this mapping; do not edit by hand
// without also updating those files.
export const PUBLIC_SITEMAP_ENTRIES: readonly SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: 1.0 },
  { path: "/pricing", changefreq: "monthly", priority: 0.9 },
  { path: "/blog", changefreq: "weekly", priority: 0.8 },
  {
    path: "/blog/slack-webpage-change-alerts",
    lastmod: "2026-04-15",
    changefreq: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/monitor-website-changes-without-writing-code",
    lastmod: "2026-03-15",
    changefreq: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/website-change-monitoring-use-cases-beyond-price-tracking",
    lastmod: "2026-03-07",
    changefreq: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/css-selectors-keep-breaking-why-and-how-to-fix",
    lastmod: "2026-03-03",
    changefreq: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/monitor-competitor-prices-without-getting-blocked",
    lastmod: "2026-02-13",
    changefreq: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/fetchthechange-vs-distill-visualping-hexowatch",
    lastmod: "2026-02-01",
    changefreq: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/why-website-change-monitors-fail-silently",
    lastmod: "2026-01-30",
    changefreq: "monthly",
    priority: 0.7,
  },
  { path: "/docs/webhooks", changefreq: "monthly", priority: 0.6 },
  { path: "/docs/zapier", changefreq: "monthly", priority: 0.6 },
  { path: "/docs/make", changefreq: "monthly", priority: 0.6 },
  { path: "/changelog", changefreq: "weekly", priority: 0.5 },
  { path: "/support", changefreq: "monthly", priority: 0.5 },
  { path: "/privacy", changefreq: "yearly", priority: 0.3 },
] as const;

export const ROBOTS_DISALLOW = [
  "/api/",
  "/admin/",
  "/dashboard",
  "/monitors/",
  "/developer",
  "/extension-auth",
] as const;

export function renderRobotsTxt(baseUrl = getAppUrl()): string {
  const disallow = ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`).join("\n");
  return (
    `User-agent: *\nAllow: /\n${disallow}\n\nSitemap: ${baseUrl}/sitemap.xml\n`
  );
}

export function renderSitemapXml(baseUrl = getAppUrl()): string {
  const urls = PUBLIC_SITEMAP_ENTRIES.map((e) => {
    const parts = [`    <loc>${baseUrl}${e.path}</loc>`];
    if (e.lastmod) parts.push(`    <lastmod>${e.lastmod}</lastmod>`);
    if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
    if (e.priority !== undefined)
      parts.push(`    <priority>${e.priority.toFixed(1)}</priority>`);
    return `  <url>\n${parts.join("\n")}\n  </url>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
