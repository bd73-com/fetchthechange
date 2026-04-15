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
    const previousContent = existing?.getAttribute("content") ?? null;

    if (existing) {
      existing.setAttribute("content", "noindex");
    } else {
      const meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      meta.setAttribute("content", "noindex");
      document.head.appendChild(meta);
    }

    return () => {
      const current = document.head.querySelector<HTMLMetaElement>(
        'meta[name="robots"]',
      );
      if (!current) return;
      if (previousContent === null) {
        current.remove();
      } else {
        current.setAttribute("content", previousContent);
      }
    };
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            Did you forget to add the page to the router?
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
