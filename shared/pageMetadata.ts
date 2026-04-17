/**
 * Per-route social metadata consumed by the crawler-UA middleware (see
 * server/crawlerMeta.ts). When a known bot UA (Facebook, X, Slack, LinkedIn,
 * Discord, iMessage, …) requests a page, the server rewrites index.html's
 * <head> with the entry from here so link previews unfurl with the correct
 * title/description/image instead of the landing page's.
 *
 * SEOHead on the client still owns the SPA-rendered head for human visitors —
 * these entries need to stay in rough sync with the corresponding page's
 * SEOHead props, but the authoritative copy for humans is the SEOHead call.
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
    title: "Pricing — FetchTheChange",
    description:
      "Simple, transparent pricing for website change monitoring. Free for hobbyists, Pro for teams, Power for heavy users.",
    ogType: "website",
  },
  "/support": {
    title: "Support — FetchTheChange",
    description:
      "Get help with FetchTheChange: contact support, browse FAQs, and learn how to troubleshoot broken monitors.",
    ogType: "website",
  },
  "/privacy": {
    title: "Privacy Policy — FetchTheChange",
    description:
      "How FetchTheChange handles your data: what we collect, how we use it, and your rights.",
    ogType: "website",
  },
  "/changelog": {
    title: "Changelog — FetchTheChange",
    description:
      "Release notes for FetchTheChange — new features, bug fixes, and platform improvements.",
    ogType: "website",
  },
  "/blog": {
    title: "Blog — FetchTheChange",
    description:
      "Guides on website change monitoring: selector stability, price tracking, competitor intelligence, and integrations.",
    ogType: "website",
  },
  "/blog/why-website-change-monitors-fail-silently": {
    title:
      "Why Website Change Monitors Fail Silently | FetchTheChange",
    description:
      "Most website change monitors go silent when selectors break, sites add bot protection, or JavaScript rewrites the DOM. Here is how to catch those failures.",
    ogType: "article",
  },
  "/blog/fetchthechange-vs-distill-visualping-hexowatch": {
    title:
      "FetchTheChange vs. Distill, Visualping, Hexowatch | FetchTheChange",
    description:
      "How FetchTheChange compares on selector stability, JS rendering, failure reporting, and pricing against the main website change monitoring tools.",
    ogType: "article",
  },
  "/blog/monitor-competitor-prices-without-getting-blocked": {
    title:
      "How to Monitor Competitor Prices Without Getting Blocked | FetchTheChange",
    description:
      "Practical guide to scraping competitor prices reliably: rendering JS pages, rotating through selectors, and handling bot-protection gracefully.",
    ogType: "article",
  },
  "/blog/css-selectors-keep-breaking-why-and-how-to-fix": {
    title:
      "Why CSS Selectors Keep Breaking (and How to Fix Them) | FetchTheChange",
    description:
      "Why generated class names and nested indexes break your scraper every deploy, and concrete patterns that survive UI changes.",
    ogType: "article",
  },
  "/blog/website-change-monitoring-use-cases-beyond-price-tracking": {
    title:
      "Website Change Monitoring Use Cases Beyond Price Tracking | FetchTheChange",
    description:
      "From policy pages and job boards to release notes and SEO audits — the web change monitoring use cases teams actually ship with.",
    ogType: "article",
  },
  "/blog/monitor-website-changes-without-writing-code": {
    title:
      "Monitor Website Changes Without Writing Code | FetchTheChange",
    description:
      "A no-code walkthrough for setting up website change monitors with selectors, conditions, and notifications — no scripts, no servers.",
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
    title: "Webhooks — FetchTheChange Docs",
    description:
      "Send monitor events to your own HTTP endpoint with signed webhook requests. Payload schema, retry behavior, and signature verification.",
    ogType: "article",
  },
  "/docs/zapier": {
    title: "Zapier Integration — FetchTheChange Docs",
    description:
      "Connect FetchTheChange to 6000+ apps via Zapier. Trigger Zaps when a monitor detects a change.",
    ogType: "article",
  },
  "/docs/make": {
    title: "Make Integration — FetchTheChange Docs",
    description:
      "Integrate FetchTheChange with Make (formerly Integromat) to automate workflows when web content changes.",
    ogType: "article",
  },
};

/** Fallback entry used when no per-path metadata exists. */
export const DEFAULT_PAGE_METADATA: PageMeta = PAGE_METADATA["/"]!;
