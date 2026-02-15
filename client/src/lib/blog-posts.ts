import { type ComponentType, lazy } from "react";

export interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  category: string;
  date: string;
  component: ComponentType;
}

export const blogPosts: BlogPostMeta[] = [
  {
    slug: "monitor-competitor-prices-without-getting-blocked",
    title: "How to Monitor Competitor Prices Without Getting Blocked (2026 Guide)",
    description: "Learn how to monitor competitor prices on modern JavaScript-heavy websites without getting blocked — and how to avoid silent monitoring failures.",
    category: "Price Monitoring",
    date: "2026-02-13",
    component: lazy(() => import("@/pages/BlogPriceMonitoring")),
  },
  {
    slug: "fetchthechange-vs-distill-visualping-hexowatch",
    title: "FetchTheChange vs Distill, Visualping, Hexowatch (and others): Which Website Change Monitor Should You Use?",
    description: "A neutral comparison of website change monitoring tools for JavaScript-heavy sites, selector breakage detection, and value-level monitoring.",
    category: "Comparison",
    date: "2026-02-01",
    component: lazy(() => import("@/pages/BlogComparison")),
  },
  {
    slug: "why-website-change-monitors-fail-silently",
    title: "Why Website Change Monitors Fail Silently on JavaScript-Heavy Sites",
    description: "Modern websites render content dynamically with JavaScript. Most monitoring tools fetch static HTML and miss critical changes entirely.",
    category: "Website Monitoring",
    date: "2026-01-30",
    component: lazy(() => import("@/pages/BlogWhyMonitorsFail")),
  },
];
