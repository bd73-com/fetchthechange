import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import PublicNav from "@/components/PublicNav";

const BLOG_PATH = "/blog/css-selectors-keep-breaking-why-and-how-to-fix";
const PUBLISH_DATE = "2026-03-03";
const AUTHOR = "Christian – developer of FetchTheChange";

function getCanonicalUrl() {
  const baseUrl = import.meta.env.VITE_PUBLIC_BASE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "https://fetch-the-change.replit.app");
  return `${baseUrl}${BLOG_PATH}`;
}

function SEOHead() {
  useEffect(() => {
    const canonicalUrl = getCanonicalUrl();
    const todayDate = new Date().toISOString().split('T')[0];

    document.title = "CSS Selectors Keep Breaking? Why It Happens and How to Fix It | FetchTheChange";

    const metaTags = [
      { name: "description", content: "CSS selectors in website monitors break constantly due to hashed class names, DOM restructuring, and framework re-renders. Learn why it happens and how to build resilient selectors that survive site updates." },
      { property: "og:title", content: "CSS Selectors Keep Breaking? Why It Happens and How to Fix It | FetchTheChange" },
      { property: "og:description", content: "CSS selectors in website monitors break constantly due to hashed class names, DOM restructuring, and framework re-renders. Learn why it happens and how to build resilient selectors that survive site updates." },
      { property: "og:type", content: "article" },
      { property: "og:url", content: canonicalUrl },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "CSS Selectors Keep Breaking? Why It Happens and How to Fix It | FetchTheChange" },
      { name: "twitter:description", content: "CSS selectors in website monitors break constantly due to hashed class names, DOM restructuring, and framework re-renders. Learn why it happens and how to build resilient selectors that survive site updates." },
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
      "headline": "CSS Selectors Keep Breaking? Why It Happens and How to Fix It",
      "description": "CSS selectors in website monitors break constantly due to hashed class names, DOM restructuring, and framework re-renders. Learn why it happens and how to build resilient selectors that survive site updates.",
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

export default function BlogSelectorBreakage() {
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
          <Badge variant="secondary" className="mb-4">CSS Selectors</Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold leading-tight mb-4">
            CSS Selectors Keep Breaking? Why It Happens and How to Fix It
          </h1>
          <p className="text-muted-foreground">
            By {AUTHOR} · Published {new Date(PUBLISH_DATE).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </header>

        <div className="prose prose-invert max-w-none space-y-6">
          <p className="text-lg text-muted-foreground leading-relaxed">
            You set up a website monitor. You pick the element you want to track, configure your CSS selector, and everything works perfectly. For days, maybe weeks, the monitor hums along — capturing changes, sending alerts, doing exactly what it should. Then one morning you check your dashboard and find nothing. No data. The selector stopped matching.
          </p>
          <p>
            This is the single most common reason website change monitors stop working. Not bot blocking, not rate limiting, not CAPTCHAs — selector breakage. The element you were targeting still exists on the page, the value you care about is still there, but the path your selector used to reach it no longer works. The monitor sees an empty result and, depending on the tool, either alerts you to an error or — far worse — silently records nothing and moves on as if everything is fine.
          </p>
          <p>
            It happens because modern websites are not static documents. The DOM is a moving target. Class names change between deployments, elements get restructured during feature work, and front-end frameworks generate unpredictable markup that shifts every time the development team pushes an update. The page looks the same to a human visitor, but the underlying structure your selector depends on has changed completely.
          </p>
          <p>
            This article explains the five main reasons CSS selectors break on modern websites, how to write selectors that survive longer, and what to do when they inevitably fail.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">Why CSS Selectors Break on Modern Websites</h2>
          <p>
            CSS selectors work by targeting a specific path through the DOM — a chain of elements, classes, IDs, and attributes that identifies exactly one node (or a set of nodes) on the page. The selector <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">div.product-card &gt; div:nth-child(2) &gt; span.price</code> says: find a div with class "product-card," then its second child div, then a span with class "price" inside that. Every link in that chain must match for the selector to return a result.
          </p>
          <p>
            On a static HTML site from 2010, those chains rarely changed. The developer wrote the HTML by hand, the class names were meaningful and stable, and the structure only changed during intentional redesigns. On a modern site built with React, Next.js, Vue, or Svelte, the story is completely different. Build tools transform class names. Component libraries abstract away structure. Deployments happen daily or even multiple times per day, each one potentially altering the DOM in ways that break selector chains. The content stays the same — the scaffolding around it shifts constantly.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">The 5 Most Common Causes of Selector Breakage</h2>

          <h3 className="text-xl font-display font-semibold mt-6 mb-3">1. Hashed and Auto-Generated Class Names</h3>
          <p>
            CSS-in-JS libraries like styled-components, Emotion, and CSS Modules — along with build tools like Tailwind's JIT compiler — generate class names automatically. Instead of a human-readable class like <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">.product-price</code>, you get something like <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">.price_a3x7q</code> or <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">.css-1dbjc4n</code>. These hashes are derived from the component's source code, stylesheet contents, or a build-time hash. Every time the source changes — even a minor CSS tweak — the hash regenerates.
          </p>
          <p>
            If your selector relies on one of these hashed classes, it will break the next time the site deploys. On an active product, that could be multiple times per day. Consider this example: before a deployment, the page contains <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">&lt;span class="price_d8f2a"&gt;$49.99&lt;/span&gt;</code>. After the deployment, the exact same element renders as <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">&lt;span class="price_k9m3x"&gt;$49.99&lt;/span&gt;</code>. The content is identical. The selector targeting <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">.price_d8f2a</code> is broken.
          </p>

          <h3 className="text-xl font-display font-semibold mt-6 mb-3">2. DOM Restructuring and Wrapper Changes</h3>
          <p>
            Developers routinely add wrapper divs, change component hierarchies, or restructure layouts during feature work. A selector like <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">div.product-card &gt; div:nth-child(2) &gt; span.price</code> breaks if someone wraps the price in an additional <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">&lt;div&gt;</code> for layout purposes, or moves it inside a different parent component. The child combinator (<code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">&gt;</code>) requires a direct parent-child relationship — any element inserted between them severs the chain.
          </p>
          <p>
            This is especially common during redesigns, A/B tests, and CMS template changes. The content doesn't change — the structure around it does. A developer adding a tooltip wrapper, a new flex container, or a responsive layout adjustment has no idea they've broken an external monitor's selector, and they have no reason to care.
          </p>

          <h3 className="text-xl font-display font-semibold mt-6 mb-3">3. A/B Testing and Feature Flags</h3>
          <p>
            Many sites serve different DOM structures to different users at different times. A/B testing tools like Optimizely and VWO, along with feature flag systems like LaunchDarkly, inject or modify elements dynamically based on which variant a visitor is assigned to. Your monitor might see variant A on Monday — with a clean card layout and a <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">.plan-price</code> class — and variant B on Wednesday, where the same price is rendered inside a tabbed interface with completely different class names and DOM hierarchy.
          </p>
          <p>
            This is one of the hardest breakage modes to debug because the site looks perfectly normal when you visit it in your browser. You see the variant assigned to your session, and the selector appears to work. But the monitor, running from a different IP and session, sees a different variant with a different DOM structure entirely.
          </p>

          <h3 className="text-xl font-display font-semibold mt-6 mb-3">4. Framework Hydration and Client-Side Rendering</h3>
          <p>
            React, Vue, and similar frameworks often render a skeleton or placeholder on the server, then "hydrate" the real content on the client side. If a monitoring tool captures the DOM too early — before hydration completes — the selector might target a loading spinner, a placeholder element, or a skeleton UI that gets replaced milliseconds later with the actual content.
          </p>
          <p>
            Some frameworks also use portals, suspense boundaries, or lazy loading that restructure the DOM after the initial render. An element that exists at <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">t=2s</code> might not exist at <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">t=0.5s</code> because it hasn't been loaded yet, or it might temporarily live in a different location in the tree before being moved to its final position. A selector that works in a fully loaded page may match nothing during the hydration window.
          </p>

          <h3 className="text-xl font-display font-semibold mt-6 mb-3">5. Third-Party Script Injection</h3>
          <p>
            Chat widgets from services like Intercom and Drift, analytics scripts, consent banners, and ad networks all inject elements into the DOM after page load. These injected elements can shift element indices — breaking <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">:nth-child()</code> selectors — or add new parent containers that invalidate descendant selectors. A cookie consent banner that wraps the body content in an overlay div is enough to break a deeply nested selector chain that started from the document root.
          </p>
          <p>
            Third-party scripts are particularly unpredictable because the site's own developers don't control when or how these elements are injected. A marketing team enabling a new chat widget or updating the consent management platform can break your selectors without any change to the site's core codebase.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">How to Write CSS Selectors That Survive Longer</h2>
          <p>
            No selector is permanent, but some are far more resilient than others. The following practices significantly reduce how often your selectors break.
          </p>

          <div className="space-y-4 ml-4">
            <div>
              <p><strong className="text-foreground">Prefer data attributes and IDs over class names.</strong> Elements with <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">data-testid="product-price"</code> or <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">id="main-price"</code> are typically stable because they serve a functional purpose — they're used by the site's own test suite or JavaScript logic. Class names are cosmetic and disposable; IDs and data attributes are structural and intentional. Selectors that target them survive deployments that rename every CSS class on the page.</p>
            </div>
            <div>
              <p><strong className="text-foreground">Use short, shallow selectors.</strong> The longer the selector chain, the more points of failure it contains. <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">.product-price</code> is more resilient than <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">main &gt; div.content &gt; section:nth-child(3) &gt; div.card &gt; span.product-price</code>. Every additional level in the chain is another thing that can change. If you can target the element directly with a single class, ID, or attribute, do that. The extra specificity of a long chain doesn't help you — it only adds fragility.</p>
            </div>
            <div>
              <p><strong className="text-foreground">Avoid nth-child and positional selectors.</strong> Positional selectors like <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">:nth-child()</code> and <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">:first-child</code> break whenever the number or order of sibling elements changes. This happens constantly during redesigns, when dynamic content loads in a different order, or when third-party scripts inject additional siblings. If you find yourself using positional selectors, it's usually a sign that the element lacks a better identifying attribute — which is a warning that the selector is fragile.</p>
            </div>
            <div>
              <p><strong className="text-foreground">Target the closest unique ancestor.</strong> Instead of tracing a path from the document root, find the nearest element with a stable identifier and select relative to that. If there's a <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">&lt;div id="pricing"&gt;</code> nearby, use <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">#pricing .amount</code> rather than a long chain starting from <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">&lt;body&gt;</code>. The shorter the path between your anchor and your target, the fewer things that can break in between.</p>
            </div>
            <div>
              <p><strong className="text-foreground">Test your selector with a simple question:</strong> "If a developer added a wrapper div somewhere above this element, would my selector still work?" If the answer is no, simplify it. Most selector breakage comes from structural changes in the middle of the chain, not from the target element itself being removed. A selector that can tolerate an extra layer of nesting is dramatically more durable than one that demands an exact DOM path.</p>
            </div>
          </div>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">What to Do When a Selector Breaks</h2>
          <p>
            Even the most resilient selectors eventually break. Sites get redesigned, components get rewritten, and frameworks get upgraded. What matters is not preventing breakage entirely — that's impossible — but detecting it quickly and recovering efficiently.
          </p>
          <p>
            The worst outcome is silent failure. Most monitoring tools treat a missing selector the same way they treat "no change" — they report nothing. Your monitor appears healthy, showing a green status and no alerts, but it's returning empty results. You don't find out until you manually check the page and realize the price changed three weeks ago. By then, the data gap is too large to recover from. You can read more about this problem in <Link href="/blog/why-website-change-monitors-fail-silently" className="text-primary underline">our detailed write-up on why website change monitors fail silently</Link>.
          </p>
          <p>
            A good recovery workflow has three stages:
          </p>
          <ol className="list-decimal list-inside space-y-3 ml-4">
            <li><strong className="text-foreground">Detection</strong> — The monitoring tool should explicitly tell you the selector didn't match anything. Not silence — an active alert that says "selector not found." This is the difference between a tool that helps you and a tool that hides problems from you.</li>
            <li><strong className="text-foreground">Diagnosis</strong> — You need to see what the page looks like right now so you can understand what changed. Did the class name get rehashed? Did the DOM structure shift? Did the element move to a different part of the component tree? Without seeing the current state of the page, you're debugging blind.</li>
            <li><strong className="text-foreground">Recovery</strong> — Ideally the tool shows you the current page and helps you pick a new selector, or suggests alternatives based on the current DOM. Rebuilding a selector from scratch by manually inspecting a page in DevTools is tedious and error-prone. Having candidate selectors offered to you based on what changed is dramatically faster.</li>
          </ol>
          <p>
            This is the approach FetchTheChange takes — when a selector stops matching, it flags the error immediately and offers a Fix Selector flow that shows you the current page state and suggests new selectors based on what changed. Instead of discovering three weeks later that your monitor went silent, you find out the same day and can fix it in minutes.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">A Real-World Example</h2>
          <p>
            Consider a realistic scenario. You're monitoring a SaaS competitor's pricing page to track whether they change their plan prices. Your selector <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">.plan-card:nth-child(2) .plan-price</code> has been returning "$49/mo" for weeks. Everything looks stable. Then the competitor redesigns their pricing page. Same plans, same prices, new layout. They switch from a CSS grid of pricing cards to a tabbed interface where each plan is shown in a tab panel. Your selector returns nothing because there are no <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">.plan-card</code> elements anymore. For more on how to set up this kind of monitoring effectively, see <Link href="/blog/monitor-competitor-prices-without-getting-blocked" className="text-primary underline">our guide to monitoring competitor prices</Link>.
          </p>
          <p>
            Without selector failure detection, your dashboard continues showing the last known value — $49/mo — with no indication anything is wrong. The status is green. No alerts fired. Weeks later, you happen to visit the competitor's pricing page directly and discover they raised their Pro plan to $59/mo. You missed it entirely because your monitor was silently broken the whole time. Every decision you made based on that stale data was based on a number that stopped being real weeks ago.
          </p>
          <p>
            With selector failure detection, you get an alert within hours: "Selector <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">.plan-card:nth-child(2) .plan-price</code> returned no match." You open the fix-selector tool, see the new tabbed layout, inspect the current DOM structure, and pick a new selector — <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-sm">.tab-content [data-plan="pro"] .price</code> — that targets the same value in its new location. You're back in business the same day, with your monitoring history intact and only a small gap in the data.
          </p>
          <p>
            The difference isn't the breakage — that's inevitable on any actively maintained website. The difference is whether you know about it.
          </p>

          <h2 className="text-2xl font-display font-bold mt-10 mb-4">Key Takeaways</h2>
          <p>
            CSS selectors break because modern websites are dynamic. Hashed class names change on every deployment, DOM restructuring shifts elements into new hierarchies, A/B tests serve different markup to different sessions, framework hydration creates transient DOM states, and third-party scripts inject elements that shift indices and break chains. None of this is going away — it's the natural consequence of how modern web development works.
          </p>
          <p>
            You can reduce the frequency of breakage by writing short, shallow selectors that target stable attributes like IDs and data attributes instead of generated class names. Avoiding positional selectors, minimizing chain depth, and anchoring to the closest unique ancestor all help your selectors survive routine deployments and layout changes.
          </p>
          <p>
            But no selector is permanent. What matters most is detecting breakage immediately and having a fast path to recovery. A monitor that tells you "your selector stopped matching" on the same day it happens is infinitely more valuable than one that quietly returns empty results for weeks while you assume everything is working.
          </p>
          <p>
            Silent failure is the real enemy — not breakage itself. Selectors will always break eventually. The question is whether you'll know about it when it happens, or whether you'll discover the gap weeks later when the data you needed is already gone.
          </p>

          <div className="bg-secondary/50 rounded-lg p-6 mt-10 border border-border">
            <h3 className="text-xl font-display font-bold mb-3">Stop Losing Data to Broken Selectors</h3>
            <p className="text-muted-foreground mb-4">
              FetchTheChange detects selector breakage immediately and helps you fix it — so you never miss a change because your monitor silently stopped working.
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
