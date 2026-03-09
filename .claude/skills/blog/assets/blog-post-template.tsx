import { useMemo } from "react";
import { formatDate } from "@/lib/date-format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import PublicNav from "@/components/PublicNav";
import SEOHead, { getCanonicalUrl } from "@/components/SEOHead";

const BLOG_PATH = "__BLOG_PATH__";
const PUBLISH_DATE = "__PUBLISH_DATE__";
const AUTHOR = "Christian – developer of FetchTheChange";

export default function __COMPONENT_NAME__() {
  const jsonLd = useMemo(() => ({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "__HEADLINE__",
    description: "__DESCRIPTION__",
    author: { "@type": "Person", name: AUTHOR },
    publisher: { "@type": "Organization", name: "FetchTheChange" },
    mainEntityOfPage: getCanonicalUrl(BLOG_PATH),
    datePublished: PUBLISH_DATE,
    dateModified: PUBLISH_DATE,
  }), []);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="__HEADLINE__ | FetchTheChange"
        description="__DESCRIPTION__"
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
          <Badge variant="secondary" className="mb-4">__CATEGORY__</Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold leading-tight mb-4">
            __HEADLINE__
          </h1>
          <p className="text-muted-foreground">
            By {AUTHOR} · Published {formatDate(PUBLISH_DATE)}
          </p>
        </header>

        <div className="prose prose-invert max-w-none space-y-6">
          {/* TODO: Write article content here */}

          <p>
            {/* TODO: Include at least 3 internal links to existing blog posts. Example: */}
            Learn more in our <Link href="/blog/why-website-change-monitors-fail-silently" className="text-primary hover:underline">guide to silent monitor failures</Link>.
          </p>
          <p>
            See also <Link href="/blog/css-selectors-keep-breaking-why-and-how-to-fix" className="text-primary hover:underline">why CSS selectors break</Link> and
            our <Link href="/blog/fetchthechange-vs-distill-visualping-hexowatch" className="text-primary hover:underline">comparison of monitoring tools</Link>.
          </p>

          <div className="bg-secondary/50 rounded-lg p-6 mt-10 border border-border">
            <h3 className="text-xl font-display font-bold mb-3">Start Monitoring Today</h3>
            <p className="text-muted-foreground mb-4">
              Track changes on any webpage with FetchTheChange. Start with 5 free monitors.
            </p>
            <Button asChild data-testid="button-cta-get-started">
              <a href="/api/login">
                Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
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
