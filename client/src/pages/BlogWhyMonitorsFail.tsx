import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import PublicNav from "@/components/PublicNav";

const BLOG_PATH = "/blog/why-website-change-monitors-fail-silently";
const PUBLISH_DATE = "2026-01-30";
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
    
    document.title = "Why Website Change Monitors Fail Silently on JavaScript-Heavy Sites | FetchTheChange";
    
    const metaTags = [
      { name: "description", content: "Most website change monitors fail silently when JavaScript or CSS selectors break. Learn why this happens and how to detect it before you miss important changes." },
      { property: "og:title", content: "Why Website Change Monitors Fail Silently on JavaScript-Heavy Sites" },
      { property: "og:description", content: "Most website change monitors fail silently when JavaScript or CSS selectors break. Learn why this happens and how to detect it before you miss important changes." },
      { property: "og:type", content: "article" },
      { property: "og:url", content: canonicalUrl },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Why Website Change Monitors Fail Silently on JavaScript-Heavy Sites" },
      { name: "twitter:description", content: "Most website change monitors fail silently when JavaScript or CSS selectors break. Learn why this happens and how to detect it before you miss important changes." },
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
      "headline": "Why Website Change Monitors Fail Silently on JavaScript-Heavy Sites",
      "description": "Most website change monitors fail silently when JavaScript or CSS selectors break. Learn why this happens and how to detect it before you miss important changes.",
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

export default function BlogWhyMonitorsFail() {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead />
      <PublicNav />

      <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <header className="mb-10">
          <Badge variant="secondary" className="mb-4">Website Monitoring</Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold leading-tight mb-4">
            Why Website Change Monitors Fail Silently on JavaScript-Heavy Sites
          </h1>
          <p className="text-muted-foreground">
            By {AUTHOR} · Published {new Date(PUBLISH_DATE).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </header>

        <div className="prose prose-invert max-w-none space-y-6">
          <p className="text-lg text-muted-foreground leading-relaxed">
            Website change monitoring sounds simple: pick a page, choose what to track, get notified when it changes.
          </p>
          <p className="text-lg">
            In practice, it breaks far more often than most people realize — and worse, it often breaks <strong>silently</strong>.
          </p>
          <p>
            I ran into this problem repeatedly while tracking prices, availability, and other values on modern websites. Everything looked fine… until I discovered days later that the page had changed and my monitor never alerted me.
          </p>
          <p>
            The tracker hadn't crashed. It hadn't errored. It had just stopped working.
          </p>
          <p className="text-primary font-medium">
            That silent failure is the real problem — and it's much more common on today's JavaScript-heavy web.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">The hidden fragility of most change monitors</h2>
          <p>Most website change monitors are built on a simple idea:</p>
          <ol className="list-decimal list-inside space-y-2 ml-4">
            <li>Fetch the page HTML</li>
            <li>Locate an element using a CSS selector</li>
            <li>Compare the value over time</li>
          </ol>
          <p>This works well until one of these things happens:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>The site changes layout</li>
            <li>A wrapper div is added</li>
            <li>A class name is renamed</li>
            <li>Content moves behind JavaScript rendering</li>
          </ul>
          <p>When that happens, the selector no longer matches anything.</p>
          <p className="font-medium">And here's the critical flaw:</p>
          <p className="text-primary">Most tools don't tell you that your selector stopped matching.</p>
          <p>They simply return:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>an empty value</li>
            <li>the page title</li>
            <li>stale data</li>
            <li>or nothing at all</li>
          </ul>
          <p>From the outside, everything still looks "green".</p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">Why JavaScript makes this worse</h2>
          <p>Modern websites increasingly rely on client-side rendering:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>React</li>
            <li>Vue</li>
            <li>Next.js</li>
            <li>Hydration after load</li>
            <li>Dynamic DOM updates</li>
          </ul>
          <p>
            If a monitor only fetches static HTML, it may never see the content you care about.
          </p>
          <p>
            Even tools that do render JavaScript still face a second issue: <strong>the rendered DOM is not stable.</strong>
          </p>
          <p>Small frontend refactors can change:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>DOM depth</li>
            <li>Class names</li>
            <li>Element ordering</li>
          </ul>
          <p>Your selector breaks — and the tool often has no idea.</p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">Silent failure is worse than an error</h2>
          <p>If a monitor crashes, you notice. If it sends an error, you investigate.</p>
          <p className="text-primary font-medium">But silent failure creates false confidence.</p>
          <p>You think: "If something changes, I'll be alerted."</p>
          <p>In reality:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>The page changed</li>
            <li>The selector broke</li>
            <li>The monitor kept running</li>
            <li>And you missed the signal entirely</li>
          </ul>
          <p>This is especially dangerous for:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Price tracking</li>
            <li>Stock / availability monitoring</li>
            <li>Compliance or policy changes</li>
            <li>Metrics dashboards</li>
          </ul>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">What a reliable change monitor actually needs</h2>
          <p>
            After getting burned by this a few times, it became clear that a reliable monitor must do more than "fetch and compare".
          </p>
          <p>At minimum, it needs to:</p>
          <div className="space-y-4 my-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-1" />
              <div>
                <strong>Render JavaScript</strong>
                <p className="text-muted-foreground">Otherwise you're blind on modern sites.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-1" />
              <div>
                <strong>Validate selectors continuously</strong>
                <p className="text-muted-foreground">The tool must know whether the selector still matches anything.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-1" />
              <div>
                <strong>Detect failure states explicitly</strong>
                <p className="text-muted-foreground">"Selector not found" is a signal, not an edge case.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-1" />
              <div>
                <strong>Surface visibility to the user</strong>
                <p className="text-muted-foreground">You should know what broke and why.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-1" />
              <div>
                <strong>Help recovery</strong>
                <p className="text-muted-foreground">When a selector breaks, fixing it shouldn't require starting from scratch.</p>
              </div>
            </div>
          </div>
          <p>Most tools stop at step 1 — if they even get there.</p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">How FetchTheChange solves this</h2>
          <p>
            After running into the same issue one too many times, I built a tool that focused on failure visibility, not just change detection.
          </p>
          <p>Instead of failing silently, FetchTheChange:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Renders JavaScript pages</li>
            <li>Checks whether your selector still matches</li>
            <li>Flags broken selectors explicitly</li>
            <li>Suggests alternative selectors when structure changes</li>
          </ul>
          <p>
            The goal wasn't to build "another price tracker", but a reliable change monitor for modern websites — one that tells you when tracking itself stops working.
          </p>

          <figure className="my-8">
            <img 
              src="/images/fix-selector-showcase.png" 
              alt="Fix Selector feature showing selector suggestions when a selector breaks" 
              className="rounded-lg border border-border shadow-lg"
            />
            <figcaption className="text-center text-muted-foreground mt-3 text-sm">
              When a site changes, FetchTheChange shows you what broke and helps you fix it.
            </figcaption>
          </figure>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">This isn't just about prices</h2>
          <p>
            Although price tracking is a common use case, the problem applies to any monitored value:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Availability text</li>
            <li>Metrics</li>
            <li>Policy wording</li>
            <li>Content blocks</li>
            <li>UI labels</li>
            <li>Dashboard numbers</li>
          </ul>
          <p>
            Any value embedded in a modern DOM can silently disappear from your monitor if you're not watching the selector itself.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">The takeaway</h2>
          <p>If you rely on website change monitoring today, ask yourself:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>What happens when the selector breaks?</li>
            <li>Will I know immediately?</li>
            <li>Or will I only notice after it's too late?</li>
          </ul>
          <p className="my-6">
            <strong>A monitor that fails loudly is annoying.</strong><br />
            <strong className="text-primary">A monitor that fails silently is dangerous.</strong>
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">Discussion</h2>
          <p>I'd love to hear how others handle this today:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Have you been burned by silent failures?</li>
            <li>Do you manually re-check monitors?</li>
            <li>Or do you just accept the risk?</li>
          </ul>

          <div className="bg-secondary/50 rounded-lg p-6 mt-10 border border-border">
            <h3 className="text-xl font-display font-bold mb-3">Try FetchTheChange</h3>
            <p className="text-muted-foreground mb-4">
              The free plan includes up to 5 monitored pages. No credit card required.
            </p>
            <Button asChild data-testid="button-cta-start-monitoring">
              <a href="/api/login">
                Start Monitoring <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>

        <footer className="mt-12 pt-8 border-t border-border">
          <Button variant="ghost" asChild data-testid="button-back-home-bottom">
            <Link href="/blog">
              Back to Blog
            </Link>
          </Button>
        </footer>
      </article>
    </div>
  );
}
