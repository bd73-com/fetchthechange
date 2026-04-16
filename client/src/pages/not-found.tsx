import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  // Inject `<meta name="robots" content="noindex">` so search engines do not
  // index unknown SPA routes. Without this, every miss returns HTTP 200 and
  // can be indexed as thin/soft-404 content. Restore prior state on unmount
  // so navigating away does not leave the noindex tag behind.
  useEffect(() => {
    const existing = document.head.querySelector<HTMLMetaElement>(
      'meta[name="robots"]',
    );
    // Differentiate "tag existed but had no content" from "no tag existed".
    // Both cases yield `getAttribute('content') === null`; without this
    // flag, cleanup would wrongly remove a pre-existing tag that simply
    // had no content attribute.
    const hadExistingTag = existing !== null;
    const hadContentAttribute = existing?.hasAttribute("content") ?? false;
    const previousContent = existing?.getAttribute("content");
    let injected: HTMLMetaElement | null = null;

    if (existing) {
      existing.setAttribute("content", "noindex");
    } else {
      const meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      meta.setAttribute("content", "noindex");
      document.head.appendChild(meta);
      injected = meta;
    }

    return () => {
      if (!hadExistingTag) {
        // We created the tag ourselves — remove it.
        if (injected?.isConnected) injected.remove();
        return;
      }

      // A tag was there before us; find the current one (fall back to a
      // fresh query in case the originally-captured node was replaced).
      const current =
        existing && existing.isConnected
          ? existing
          : document.head.querySelector<HTMLMetaElement>(
              'meta[name="robots"]',
            );
      if (!current) return;

      if (hadContentAttribute) {
        current.setAttribute("content", previousContent ?? "");
      } else {
        current.removeAttribute("content");
      }
    };
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
