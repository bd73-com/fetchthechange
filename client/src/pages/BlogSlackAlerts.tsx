import { useMemo } from "react";
import { formatDate } from "@/lib/date-format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import PublicNav from "@/components/PublicNav";
import SEOHead, { getCanonicalUrl } from "@/components/SEOHead";

const BLOG_PATH = "/blog/slack-webpage-change-alerts";
const PUBLISH_DATE = "2026-04-15";
const AUTHOR = "Christian - developer of FetchTheChange";

export default function BlogSlackAlerts() {
  const jsonLd = useMemo(() => ({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "How to get a Slack alert when any webpage changes",
    description: "Set up Slack notifications for webpage changes in minutes. Monitor prices, stock levels, competitor pages, or any site element — alerts go straight to your Slack channel.",
    author: { "@type": "Person", name: AUTHOR },
    publisher: { "@type": "Organization", name: "FetchTheChange" },
    mainEntityOfPage: getCanonicalUrl(BLOG_PATH),
    datePublished: PUBLISH_DATE,
    dateModified: PUBLISH_DATE,
  }), []);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="How to Get a Slack Alert When Any Webpage Changes | FetchTheChange"
        description="Set up Slack notifications for webpage changes in minutes. Monitor prices, stock levels, competitor pages, or any site element — alerts go straight to your Slack channel."
        path={BLOG_PATH}
        ogType="article"
        jsonLd={jsonLd}
      />
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
          <Badge variant="secondary" className="mb-4">Integrations</Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold leading-tight mb-4">
            How to get a Slack alert when any webpage changes
          </h1>
          <p className="text-muted-foreground">
            By {AUTHOR} · Published {formatDate(PUBLISH_DATE)}
          </p>
        </header>

        <div className="prose prose-invert max-w-none space-y-6">
          <p className="text-lg text-muted-foreground leading-relaxed">
            Email notifications for webpage changes get buried. By the time someone opens their inbox, the competitor's price has already moved, the product has sold out again, or the status page has gone back to green. Slack puts the alert where the team is already working — in a channel, visible to everyone who needs to know, the moment the change happens.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">Why Slack beats email for webpage monitoring</h2>
          <p>
            Email is personal and asynchronous. Webpage change alerts usually are not. When a competitor drops their price or a product comes back in stock, the whole team needs to know at once — not one person's inbox at whatever time they happen to check it.
          </p>
          <p>
            A shared Slack channel makes webpage change alerts a team signal instead of a personal one. The pricing analyst sees the competitor move at the same time as the category manager. Ops and engineering see the status page change together. No forwarding, no "did you see this?" follow-ups, no single point of failure.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">What you can monitor</h2>
          <p>
            Slack alerts work for any change a monitor can detect. Some of the most common use cases:
          </p>
          <ul className="list-disc list-inside space-y-3 ml-4">
            <li><strong className="text-foreground">Competitor pricing pages</strong> — know the moment a price changes, before a customer notices it first.</li>
            <li><strong className="text-foreground">Job boards and careers pages</strong> — alert a channel when new roles appear at a company you're tracking.</li>
            <li><strong className="text-foreground">Government or regulatory pages</strong> — track policy updates, guidance changes, and effective dates as they are published.</li>
            <li><strong className="text-foreground">SaaS status pages</strong> — get notified before your customers do, so your on-call team can respond first.</li>
            <li><strong className="text-foreground">Product availability</strong> — stock alerts for high-demand items that sell out fast and restock without warning.</li>
          </ul>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">How to connect Slack to FetchTheChange</h2>
          <p>
            Setup takes a minute or two. You only connect your workspace once — after that, each monitor picks its own channel.
          </p>
          <ol className="list-decimal list-inside space-y-3 ml-4">
            <li><strong className="text-foreground">Open your monitor</strong> — Go to the FetchTheChange dashboard and open the monitor you want Slack alerts for, or create a new one.</li>
            <li><strong className="text-foreground">Open Notification Channels</strong> — In the monitor settings, scroll to the Notification Channels section.</li>
            <li><strong className="text-foreground">Click Connect to Slack</strong> — This opens the standard Slack OAuth flow. Authorise FetchTheChange to post to your workspace.</li>
            <li><strong className="text-foreground">Select a channel</strong> — Pick the channel where alerts should go. You can choose a different channel for every monitor.</li>
            <li><strong className="text-foreground">Toggle Slack on</strong> — Enable Slack in the notification channel picker. Email and Slack are independent — turning one on does not disable the other.</li>
            <li><strong className="text-foreground">Save the monitor</strong> — The next time the tracked value changes, an alert fires to the channel you chose.</li>
          </ol>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">What a Slack alert looks like</h2>
          <p>
            Each alert posts as a structured Slack message, not a bare text line. The message shows the monitor name, the old value, the new value, and the time the change was detected. It also includes a direct link back to the monitor in the FetchTheChange dashboard, so anyone in the channel can click through to see the full change history and the page being tracked.
          </p>
          <p>
            If you have multiple monitors posting to the same channel, each alert is clearly labelled by monitor name. There's no ambiguity about which page changed — you don't have to reverse-engineer the message to work out whether it was the pricing page or the status page.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">Per-monitor channel routing</h2>
          <p>
            You're not limited to one channel. A common pattern is to route competitor price monitors to <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">#competitive-intel</code>, stock and availability alerts to <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">#ops</code>, and status page monitors to <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">#engineering</code>.
          </p>
          <p>
            Each monitor has its own channel setting, and you can change them independently at any time. Moving a monitor to a different channel doesn't reset its history or require reconnecting Slack — it's a single setting change.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">Availability</h2>
          <p>
            Slack integration is available on the Pro and Power plans. You can connect as many monitors to Slack as your tier allows — there's no separate cap on Slack-enabled monitors beyond the overall monitor count for your plan.
          </p>

          <div className="bg-secondary/50 rounded-lg p-6 mt-10 border border-border">
            <h3 className="text-xl font-display font-bold mb-3">Start monitoring with Slack alerts</h3>
            <p className="text-muted-foreground mb-4">
              Set up a monitor, connect Slack once, and route alerts for prices, stock, status pages, or any page element straight into the channel where your team already works.
            </p>
            <Button asChild data-testid="button-cta-start-monitoring">
              <a href="/api/login">
                Set up a monitor <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>

          <h2 className="text-2xl font-display font-bold mt-12 mb-4">More in this series</h2>
          <p>
            This is post 1 of a 5-part series on FetchTheChange integrations:
          </p>
          <ul className="list-disc list-inside space-y-3 ml-4">
            <li>
              <Link href="/blog/webhook-webpage-change-trigger" rel="nofollow" className="text-primary hover:underline">
                Trigger any automation when a webpage changes using webhooks
              </Link>
            </li>
            <li>
              <Link href="/blog/zapier-webpage-change-automation" rel="nofollow" className="text-primary hover:underline">
                Connect webpage monitoring to 7,000+ apps with Zapier
              </Link>
            </li>
            <li>
              <Link href="/blog/webpage-monitoring-api" rel="nofollow" className="text-primary hover:underline">
                Monitor webpages programmatically with the FetchTheChange API
              </Link>
            </li>
            <li>
              <Link href="/blog/chrome-extension-webpage-monitor" rel="nofollow" className="text-primary hover:underline">
                Monitor any element on any page without writing CSS selectors
              </Link>
            </li>
          </ul>
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
