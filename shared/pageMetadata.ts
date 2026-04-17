/**
 * Per-route social metadata consumed by the crawler-UA middleware (see
 * server/crawlerMeta.ts). When a known bot UA (Facebook, X, Slack, LinkedIn,
 * Discord, iMessage, …) requests a page, the server rewrites index.html's
 * <head> with the entry from here so link previews unfurl with the correct
 * title/description/image instead of the landing page's.
 *
 * SEOHead on the client still owns the SPA-rendered head for human visitors.
 * `client/src/pages/page-metadata-parity.test.ts` enforces that every
 * `<SEOHead path="X" title="Y" description="Z" />` matches PAGE_METADATA["X"],
 * so editing one side without the other fails the test suite.
 *
 * Blog/doc URLs omit the `image` field on purpose: they inherit the default
 * OG image from client/index.html.
 *
 * See GitHub issue #440.
 */
export interface PageMeta {
  title: string;
  description: string;
  ogType?: "website" | "article";
  image?: string;
}

const SITE_TITLE =
  "FetchTheChange — Monitor any web value. Get alerted when it changes.";

export const PAGE_METADATA: Record<string, PageMeta> = {
  "/": {
    title: SITE_TITLE,
    description:
      "Website change monitoring that works on modern, JavaScript-heavy sites. Track prices, availability, text, and any DOM value — and get told when tracking breaks, not just when values change.",
    ogType: "website",
  },
  "/pricing": {
    title: "Pricing — Free, Pro, and Power plans | FetchTheChange",
    description:
      "Simple, transparent pricing for website change monitoring. Start free with 3 monitors, or upgrade to Pro ($9/mo, 100 monitors) or Power ($29/mo, unlimited) for hourly checks, Slack, webhooks, and the REST API.",
    ogType: "website",
  },
  "/support": {
    title: "Support & Help | FetchTheChange",
    description:
      "Get help with FetchTheChange. Browse frequently asked questions about website monitoring, troubleshooting, and billing, or contact our support team.",
    ogType: "website",
  },
  "/privacy": {
    title: "Privacy Policy | FetchTheChange",
    description:
      "FetchTheChange Privacy Policy. Learn how we collect, use, and protect your personal data in compliance with GDPR.",
    ogType: "website",
  },
  "/changelog": {
    title: "What's New | FetchTheChange",
    description:
      "See what's new in FetchTheChange — latest features, bug fixes, and improvements.",
    ogType: "website",
  },
  "/blog": {
    title:
      "Blog — Website monitoring, change detection, and integrations | FetchTheChange",
    description:
      "Insights on web monitoring, change detection, CSS selector resilience, and integrations with Slack, webhooks, and Zapier. Read the FetchTheChange blog.",
    ogType: "website",
  },
  "/blog/why-website-change-monitors-fail-silently": {
    title:
      "Why Website Change Monitors Fail Silently on JavaScript-Heavy Sites | FetchTheChange",
    description:
      "Most website change monitors fail silently when JavaScript or CSS selectors break. Learn why this happens and how to detect it before you miss important changes.",
    ogType: "article",
  },
  "/blog/fetchthechange-vs-distill-visualping-hexowatch": {
    title:
      "FetchTheChange vs Distill vs Visualping vs Hexowatch | Website Change Monitor Comparison",
    description:
      "A neutral comparison of website change monitoring tools for JavaScript-heavy sites, selector breakage detection, and value-level monitoring.",
    ogType: "article",
  },
  "/blog/monitor-competitor-prices-without-getting-blocked": {
    title:
      "How to Monitor Competitor Prices Without Getting Blocked (2026 Guide)",
    description:
      "Learn how to monitor competitor prices on modern JavaScript-heavy websites without getting blocked — and how to avoid silent monitoring failures.",
    ogType: "article",
  },
  "/blog/css-selectors-keep-breaking-why-and-how-to-fix": {
    title:
      "CSS Selectors Keep Breaking? Why It Happens and How to Fix It | FetchTheChange",
    description:
      "CSS selectors in website monitors break constantly due to hashed class names, DOM restructuring, and framework re-renders. Learn why it happens and how to build resilient selectors that survive site updates.",
    ogType: "article",
  },
  "/blog/website-change-monitoring-use-cases-beyond-price-tracking": {
    title:
      "5 Real-World Use Cases for Website Change Monitoring (Beyond Price Tracking) | FetchTheChange",
    description:
      "Website change monitoring isn't just for tracking prices. Learn five practical use cases — from regulatory compliance to job postings — with concrete examples and selector strategies for each.",
    ogType: "article",
  },
  "/blog/monitor-website-changes-without-writing-code": {
    title:
      "How to Monitor Website Changes Without Writing Code (Step-by-Step) | FetchTheChange",
    description:
      "You don't need to be a developer to track changes on a website. Learn how to monitor any webpage — prices, availability, text, job postings — using a point-and-click browser extension. No coding required.",
    ogType: "article",
  },
  "/blog/slack-webpage-change-alerts": {
    title:
      "How to Get a Slack Alert When Any Webpage Changes | FetchTheChange",
    description:
      "Set up Slack notifications for webpage changes in minutes. Monitor prices, stock levels, competitor pages, or any site element — alerts go straight to your Slack channel.",
    ogType: "article",
  },
  "/docs/webhooks": {
    title: "Webhook Integration | FetchTheChange Developer Docs",
    description:
      "Learn how to receive FetchTheChange change alerts via webhooks. Covers payload format, HMAC signature verification, retries, and testing.",
    ogType: "article",
  },
  "/docs/zapier": {
    title: "Zapier Integration | FetchTheChange",
    description:
      "Connect FetchTheChange to 7,000+ apps via Zapier. Trigger Zaps when any monitored value changes — no server required. Power plan.",
    ogType: "article",
  },
  "/docs/make": {
    title: "Make Integration | FetchTheChange",
    description:
      "Connect FetchTheChange to Make (Integromat) using webhooks. Receive change alerts in any Make scenario — no server required.",
    ogType: "article",
  },
  "/developer": {
    title: "REST API Documentation | FetchTheChange Developer Docs",
    description:
      "FetchTheChange REST API documentation. Create monitors, pull change history, and integrate website monitoring into your CI/CD pipelines. Power plan required.",
    ogType: "article",
  },
};

/**
 * Freeze every entry so a consumer that mutates a returned PageMeta (e.g.,
 * `meta.title = "..."` in a future rewrite helper) trips an error in strict
 * mode instead of silently corrupting the map for every subsequent crawler
 * request. getPageMetadata returns references directly — no clone-on-read —
 * so this freeze is what keeps the map immutable at the callsite boundary.
 */
for (const key of Object.keys(PAGE_METADATA)) {
  Object.freeze(PAGE_METADATA[key]);
}

/** Fallback entry used when no per-path metadata exists. */
export const DEFAULT_PAGE_METADATA: PageMeta = Object.freeze({
  ...PAGE_METADATA["/"]!,
});
