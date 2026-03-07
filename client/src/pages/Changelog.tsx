import { useEffect } from "react";
import PublicNav from "@/components/PublicNav";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/date-format";
import { changelog } from "@/data/changelog";

const CHANGELOG_PATH = "/changelog";

function SEOHead() {
  useEffect(() => {
    const baseUrl =
      import.meta.env.VITE_PUBLIC_BASE_URL ||
      (typeof window !== "undefined"
        ? window.location.origin
        : "https://fetch-the-change.replit.app");
    const canonicalUrl = `${baseUrl}${CHANGELOG_PATH}`;

    document.title = "What's New | FetchTheChange";

    const metaTags = [
      {
        name: "description",
        content:
          "See what's new in FetchTheChange — latest features, bug fixes, and improvements.",
      },
      { property: "og:title", content: "What's New | FetchTheChange" },
      {
        property: "og:description",
        content:
          "See what's new in FetchTheChange — latest features, bug fixes, and improvements.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonicalUrl },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "What's New | FetchTheChange" },
      {
        name: "twitter:description",
        content:
          "See what's new in FetchTheChange — latest features, bug fixes, and improvements.",
      },
    ];

    const elements: HTMLElement[] = [];

    metaTags.forEach((tag) => {
      const meta = document.createElement("meta");
      if (tag.name) meta.setAttribute("name", tag.name);
      if ((tag as any).property)
        meta.setAttribute("property", (tag as any).property);
      meta.setAttribute("content", tag.content);
      document.head.appendChild(meta);
      elements.push(meta);
    });

    const canonicalLink = document.createElement("link");
    canonicalLink.setAttribute("rel", "canonical");
    canonicalLink.setAttribute("href", canonicalUrl);
    document.head.appendChild(canonicalLink);
    elements.push(canonicalLink);

    return () => {
      elements.forEach((el) => el.remove());
    };
  }, []);

  return null;
}

/** Parse release-drafter markdown sections into structured blocks. */
function parseBody(body: string): { heading: string; items: string[] }[] {
  const sections: { heading: string; items: string[] }[] = [];
  let current: { heading: string; items: string[] } | null = null;

  for (const line of body.split("\n")) {
    const headingMatch = line.match(/^###\s+(.+)/);
    if (headingMatch) {
      current = { heading: headingMatch[1].trim(), items: [] };
      sections.push(current);
      continue;
    }
    const itemMatch = line.match(/^\s*[-*]\s+(.+)/);
    if (itemMatch && current) {
      current.items.push(itemMatch[1].trim());
    }
  }

  return sections;
}

function badgeVariant(
  heading: string,
): "default" | "secondary" | "destructive" | "outline" {
  const lower = heading.toLowerCase();
  if (lower.includes("breaking")) return "destructive";
  if (lower.includes("feature")) return "default";
  if (lower.includes("security")) return "outline";
  return "secondary";
}

export default function Changelog() {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead />
      <PublicNav />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <header className="mb-10">
          <h1
            className="text-3xl md:text-4xl font-display font-bold mb-4"
            data-testid="text-changelog-title"
          >
            What's New
          </h1>
          <p className="text-muted-foreground text-lg">
            A history of features, fixes, and improvements shipped to
            FetchTheChange.
          </p>
        </header>

        {changelog.length === 0 ? (
          <p className="text-muted-foreground" data-testid="text-changelog-empty">
            No releases yet. Check back soon!
          </p>
        ) : (
          <ol className="relative border-l border-border ml-3 space-y-10">
            {changelog.map((entry) => {
              const sections = parseBody(entry.body);
              return (
                <li key={entry.version} className="ml-6" data-testid={`changelog-${entry.version}`}>
                  <span className="absolute -left-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary ring-4 ring-background">
                    <span className="h-2 w-2 rounded-full bg-primary-foreground" />
                  </span>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h2 className="text-xl font-display font-bold">
                      v{entry.version}
                    </h2>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(entry.date)}
                    </span>
                  </div>

                  {sections.length > 0 ? (
                    <div className="space-y-4">
                      {sections.map((section) => (
                        <div key={section.heading}>
                          <Badge
                            variant={badgeVariant(section.heading)}
                            className="mb-2"
                          >
                            {section.heading}
                          </Badge>
                          <ul className="list-disc list-inside space-y-1 text-muted-foreground text-sm">
                            {section.items.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                      {entry.body}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
