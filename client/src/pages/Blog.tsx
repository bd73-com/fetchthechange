import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import PublicNav from "@/components/PublicNav";
import { blogPosts } from "@/lib/blog-posts";

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
