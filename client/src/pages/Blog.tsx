import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import PublicNav from "@/components/PublicNav";

const blogPosts = [
  {
    slug: "fetchthechange-vs-distill-visualping-hexowatch",
    title: "FetchTheChange vs Distill, Visualping, Hexowatch (and others): Which Website Change Monitor Should You Use?",
    description: "A neutral comparison of website change monitoring tools for JavaScript-heavy sites, selector breakage detection, and value-level monitoring.",
    category: "Comparison",
    date: "2026-02-01",
  },
  {
    slug: "why-website-change-monitors-fail-silently",
    title: "Why Website Change Monitors Fail Silently on JavaScript-Heavy Sites",
    description: "Modern websites render content dynamically with JavaScript. Most monitoring tools fetch static HTML and miss critical changes entirely.",
    category: "Website Monitoring",
    date: "2026-01-30",
  },
];

export default function Blog() {
  return (
    <div className="min-h-screen bg-background">
      <PublicNav />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <header className="mb-10">
          <h1 className="text-3xl md:text-4xl font-display font-bold mb-4" data-testid="text-blog-title">
            Blog
          </h1>
          <p className="text-muted-foreground text-lg">
            Insights on web monitoring, change detection, and staying ahead of website updates.
          </p>
        </header>

        <div className="space-y-6">
          {blogPosts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`}>
              <Card className="hover-elevate cursor-pointer" data-testid={`card-blog-${post.slug}`}>
                <CardHeader>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="secondary">{post.category}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {new Date(post.date).toLocaleDateString("en-US", { 
                        year: "numeric", 
                        month: "long", 
                        day: "numeric" 
                      })}
                    </span>
                  </div>
                  <CardTitle className="text-xl md:text-2xl">{post.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">{post.description}</p>
                  <span className="text-primary font-medium inline-flex items-center gap-1">
                    Read more <ArrowRight className="h-4 w-4" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
