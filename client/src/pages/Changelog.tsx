import PublicNav from "@/components/PublicNav";
import SEOHead from "@/components/SEOHead";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/date-format";
import { changelog } from "@/data/changelog";
import { parseBody, badgeVariant } from "@/data/changelog-utils";

export default function Changelog() {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="What's New | FetchTheChange"
        description="See what's new in FetchTheChange — latest features, bug fixes, and improvements."
        path="/changelog"
      />
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
                      {sections.map((section, i) => (
                        <div key={`${section.heading}-${i}`}>
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
                      {entry.body || "No release notes provided."}
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
