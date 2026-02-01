import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Check, X, Minus } from "lucide-react";
import { Link } from "wouter";
import PublicNav from "@/components/PublicNav";

const BLOG_PATH = "/blog/fetchthechange-vs-distill-visualping-hexowatch";
const PUBLISH_DATE = "2026-02-01";
const AUTHOR = "Christian - developer of FetchTheChange";

function getCanonicalUrl() {
  const baseUrl = import.meta.env.VITE_PUBLIC_BASE_URL || 
    (typeof window !== "undefined" ? window.location.origin : "https://fetch-the-change.replit.app");
  return `${baseUrl}${BLOG_PATH}`;
}

function SEOHead() {
  useEffect(() => {
    const canonicalUrl = getCanonicalUrl();
    const todayDate = new Date().toISOString().split('T')[0];
    
    document.title = "FetchTheChange vs Distill vs Visualping vs Hexowatch | Website Change Monitor Comparison";
    
    const metaTags = [
      { name: "description", content: "A neutral comparison of website change monitoring tools for JavaScript-heavy sites, selector breakage detection, and value-level monitoring." },
      { property: "og:title", content: "FetchTheChange vs Distill vs Visualping vs Hexowatch | Website Change Monitor Comparison" },
      { property: "og:description", content: "A neutral comparison of website change monitoring tools for JavaScript-heavy sites, selector breakage detection, and value-level monitoring." },
      { property: "og:type", content: "article" },
      { property: "og:url", content: canonicalUrl },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "FetchTheChange vs Distill vs Visualping vs Hexowatch" },
      { name: "twitter:description", content: "A neutral comparison of website change monitoring tools for JavaScript-heavy sites, selector breakage detection, and value-level monitoring." },
    ];

    const existingMetas: HTMLMetaElement[] = [];
    metaTags.forEach(tag => {
      const meta = document.createElement("meta");
      if (tag.name) meta.setAttribute("name", tag.name);
      if (tag.property) meta.setAttribute("property", tag.property);
      meta.setAttribute("content", tag.content);
      document.head.appendChild(meta);
      existingMetas.push(meta);
    });

    const canonicalLink = document.createElement("link");
    canonicalLink.setAttribute("rel", "canonical");
    canonicalLink.setAttribute("href", canonicalUrl);
    document.head.appendChild(canonicalLink);

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": "FetchTheChange vs Distill vs Visualping vs Hexowatch: Which Website Change Monitor Should You Use?",
      "description": "A neutral comparison of website change monitoring tools for JavaScript-heavy sites, selector breakage detection, and value-level monitoring.",
      "author": {
        "@type": "Person",
        "name": AUTHOR
      },
      "publisher": {
        "@type": "Organization",
        "name": "FetchTheChange"
      },
      "mainEntityOfPage": canonicalUrl,
      "datePublished": PUBLISH_DATE,
      "dateModified": todayDate
    };
    
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.text = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    return () => {
      existingMetas.forEach(meta => meta.remove());
      canonicalLink.remove();
      script.remove();
    };
  }, []);

  return null;
}

function FeatureCell({ value }: { value: "yes" | "no" | "partial" | string }) {
  if (value === "yes") {
    return <Check className="h-5 w-5 text-green-500 mx-auto" />;
  }
  if (value === "no") {
    return <X className="h-5 w-5 text-muted-foreground mx-auto" />;
  }
  if (value === "partial") {
    return <Minus className="h-5 w-5 text-yellow-500 mx-auto" />;
  }
  return <span className="text-sm">{value}</span>;
}

export default function BlogComparison() {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead />
      <PublicNav />

      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <div className="mb-6">
          <Button variant="ghost" asChild data-testid="button-back-blog-top">
            <Link href="/blog">
              Back to Blog
            </Link>
          </Button>
        </div>

        <header className="mb-10">
          <Badge variant="secondary" className="mb-4">Comparison</Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold leading-tight mb-4">
            FetchTheChange vs Distill, Visualping, Hexowatch (and others): Which Website Change Monitor Should You Use?
          </h1>
          <p className="text-muted-foreground">
            By {AUTHOR} · Published {new Date(PUBLISH_DATE).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </header>

        <div className="prose prose-invert max-w-none space-y-6">
          <p className="text-lg text-muted-foreground leading-relaxed">
            There are dozens of website change monitoring tools available today. Each has its strengths and tradeoffs. This article provides a factual comparison to help you choose the right one for your use case.
          </p>

          <div className="bg-secondary/50 rounded-lg p-6 border border-border my-8">
            <h2 className="text-xl font-display font-bold mb-4">TL;DR</h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><strong className="text-foreground">FetchTheChange</strong> — Best for value-level monitoring with explicit selector failure detection and recovery assistance</li>
              <li><strong className="text-foreground">Distill</strong> — Best for power users who need browser automation, macros, and recorded actions</li>
              <li><strong className="text-foreground">Visualping</strong> — Best for visual/screenshot-based monitoring with easy setup</li>
              <li><strong className="text-foreground">Hexowatch</strong> — Best for teams needing multiple watch types (visual, keyword, source, tech stack)</li>
            </ul>
          </div>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">The problem: silent failures on modern websites</h2>
          <p>
            Modern websites are increasingly JavaScript-heavy. Content loads dynamically, DOM structures change frequently, and CSS class names get renamed during routine updates.
          </p>
          <p>
            When a website changes its structure, most monitoring tools experience one of two failure modes:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>They can't render JavaScript content at all (fetching static HTML only)</li>
            <li>Their CSS selector stops matching — and they don't tell you</li>
          </ul>
          <p>
            The second failure is particularly dangerous. The monitor keeps running, shows no errors, but silently stops tracking the value you care about. I've written more about this in <Link href="/blog/why-website-change-monitors-fail-silently" className="text-primary underline">Why Website Change Monitors Fail Silently</Link>.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">Comparison table</h2>
          <div className="overflow-x-auto my-8">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-semibold">Feature</th>
                  <th className="text-center py-3 px-4 font-semibold">FetchTheChange</th>
                  <th className="text-center py-3 px-4 font-semibold">Distill</th>
                  <th className="text-center py-3 px-4 font-semibold">Visualping</th>
                  <th className="text-center py-3 px-4 font-semibold">Hexowatch</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/50">
                  <td className="py-3 px-4">JavaScript rendering (real browser)</td>
                  <td className="text-center py-3 px-4"><FeatureCell value="yes" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="yes" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="yes" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="yes" /></td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 px-4">Monitor specific DOM value (CSS selector)</td>
                  <td className="text-center py-3 px-4"><FeatureCell value="yes" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="yes" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="partial" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="yes" /></td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 px-4">Visual/screenshot change detection</td>
                  <td className="text-center py-3 px-4"><FeatureCell value="no" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="partial" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="yes" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="yes" /></td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 px-4">Alerts when selector stops matching</td>
                  <td className="text-center py-3 px-4"><FeatureCell value="yes" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="no" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="no" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="no" /></td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 px-4">Helps recover when selector breaks</td>
                  <td className="text-center py-3 px-4"><FeatureCell value="yes" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="no" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="no" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="no" /></td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 px-4">Login / macros / recorded steps</td>
                  <td className="text-center py-3 px-4"><FeatureCell value="no" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="yes" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="partial" /></td>
                  <td className="text-center py-3 px-4"><FeatureCell value="partial" /></td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 px-4">Integrations (email, webhook, Slack)</td>
                  <td className="text-center py-3 px-4">Email</td>
                  <td className="text-center py-3 px-4">Email, Slack, webhooks</td>
                  <td className="text-center py-3 px-4">Email, Slack, webhooks</td>
                  <td className="text-center py-3 px-4">Email, Slack, webhooks</td>
                </tr>
                <tr className="border-b border-border/50 bg-secondary/30">
                  <td className="py-3 px-4 font-semibold">Best for</td>
                  <td className="text-center py-3 px-4 text-xs">Reliable value tracking with failure visibility</td>
                  <td className="text-center py-3 px-4 text-xs">Power users, automation, behind-login pages</td>
                  <td className="text-center py-3 px-4 text-xs">Visual changes, easy setup, summaries</td>
                  <td className="text-center py-3 px-4 text-xs">Teams, multiple watch types, scale</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-green-500 inline mr-1" /> = Full support | 
            <Minus className="h-4 w-4 text-yellow-500 inline mx-1" /> = Partial/limited | 
            <X className="h-4 w-4 text-muted-foreground inline mx-1" /> = Not available
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">When FetchTheChange is best</h2>
          <p>
            FetchTheChange is designed for a specific use case: tracking a specific value on a page (price, availability, metric) and knowing immediately when something goes wrong.
          </p>
          <p><strong>Choose FetchTheChange when you need:</strong></p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Explicit alerts when your CSS selector stops matching</li>
            <li>The "<a href="/#how-it-works" className="text-primary underline">Fix Selector</a>" tool to recover when a site changes structure</li>
            <li>Value-level monitoring (text content, not screenshots)</li>
            <li>JavaScript-rendered page support without complex configuration</li>
          </ul>
          <p className="text-muted-foreground mt-4">
            FetchTheChange is not the best choice if you need visual diff screenshots, recorded login flows, or Slack/webhook integrations (email only for now).
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">When Distill is better</h2>
          <p>
            Distill.io has been around longer and offers more advanced features for power users.
          </p>
          <p><strong>Choose Distill when you need:</strong></p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Browser extension that monitors pages locally</li>
            <li>Recorded actions/macros to navigate to a specific page state</li>
            <li>Login support via browser extension</li>
            <li>Multiple integration channels (Slack, webhooks, SMS)</li>
          </ul>
          <p className="text-muted-foreground mt-4">
            Distill is a mature product with more features. However, it can be complex to set up, and it doesn't explicitly alert you when selectors break.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">When Visualping is better</h2>
          <p>
            Visualping focuses on visual change detection with screenshot comparisons.
          </p>
          <p><strong>Choose Visualping when you need:</strong></p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Visual diff of entire pages or page sections</li>
            <li>AI-powered change summaries</li>
            <li>The simplest possible setup (point and click)</li>
            <li>PDF monitoring</li>
          </ul>
          <p className="text-muted-foreground mt-4">
            Visualping is great for visual monitoring but less precise for tracking specific text values. If you need to track "the price in the third column of a table," CSS selectors work better.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">When Hexowatch is better</h2>
          <p>
            Hexowatch offers multiple "watch types" — visual, HTML, keyword, technology, availability, and more.
          </p>
          <p><strong>Choose Hexowatch when you need:</strong></p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Multiple monitoring modes in one platform</li>
            <li>Team collaboration features</li>
            <li>API access for automation</li>
            <li>Higher volume monitoring at scale</li>
          </ul>
          <p className="text-muted-foreground mt-4">
            Hexowatch is well-suited for teams and agencies who need to monitor many pages with different strategies.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">If you need self-hosting or synthetic checks</h2>
          <p>
            Some use cases require different approaches entirely:
          </p>
          <ul className="list-disc list-inside space-y-4 ml-4">
            <li>
              <strong>changedetection.io</strong> — Self-hosted, open source. Good for privacy-sensitive use cases or high-volume monitoring where SaaS pricing doesn't make sense.
            </li>
            <li>
              <strong>Synthetic monitoring (Checkly, Datadog Synthetics, Better Stack)</strong> — Best for monitoring your own applications with scripted browser tests. These are developer tools, not general-purpose change monitors.
            </li>
            <li>
              <strong>Enterprise solutions (ChangeTower, etc.)</strong> — Built for compliance and audit requirements. Often include features like historical archives and legal snapshots.
            </li>
          </ul>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">FAQ</h2>
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold mb-2">Can I track pages that require login?</h3>
              <p className="text-muted-foreground">
                Distill's browser extension is currently the best option for this. FetchTheChange does not support authenticated sessions at this time.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">What happens when my selector breaks?</h3>
              <p className="text-muted-foreground">
                Most tools silently return empty or stale data. FetchTheChange explicitly marks the monitor as "selector missing" and offers a Fix Selector tool to find alternatives.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Is visual monitoring or value monitoring better?</h3>
              <p className="text-muted-foreground">
                Visual monitoring (Visualping, Hexowatch) is better for general "did anything change" detection. Value monitoring (FetchTheChange, Distill) is better for tracking specific data like prices, stock levels, or metrics.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Which tool is cheapest?</h3>
              <p className="text-muted-foreground">
                Pricing varies by usage. FetchTheChange starts free with 5 monitors. Distill has a free tier with limited cloud checks. Visualping and Hexowatch have free trials. For high-volume use, self-hosted changedetection.io is most cost-effective.
              </p>
            </div>
          </div>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">Conclusion</h2>
          <p>
            Each tool has its strengths. The right choice depends on your specific needs:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Need reliable value tracking with failure visibility? → <strong>FetchTheChange</strong></li>
            <li>Need macros, login support, and browser extension? → <strong>Distill</strong></li>
            <li>Need visual diffs and the easiest setup? → <strong>Visualping</strong></li>
            <li>Need multiple watch types and team features? → <strong>Hexowatch</strong></li>
          </ul>
          <p className="mt-4">
            FetchTheChange was built specifically to solve the problem of silent failures — when your monitor keeps running but stops tracking what you care about. If that's a problem you've experienced, it might be worth trying.
          </p>

          <div className="bg-secondary/50 rounded-lg p-6 mt-10 border border-border">
            <h3 className="text-xl font-display font-bold mb-3">Try FetchTheChange</h3>
            <p className="text-muted-foreground mb-4">
              Start free with up to 5 monitors. No credit card required.
            </p>
            <Button asChild data-testid="button-cta-start-monitoring">
              <a href="/api/login">
                Start Monitoring <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>

        <footer className="mt-12 pt-8 border-t border-border">
          <Button variant="ghost" asChild data-testid="button-back-blog-bottom">
            <Link href="/blog">
              Back to Blog
            </Link>
          </Button>
        </footer>
      </article>
    </div>
  );
}
