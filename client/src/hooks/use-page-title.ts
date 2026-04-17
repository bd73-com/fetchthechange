import { useEffect } from "react";

/**
 * Sets document.title for authenticated, noindex pages where SEOHead isn't
 * warranted. Restores the previous title on unmount so navigating between
 * authenticated pages doesn't leave a stale label when one doesn't set its
 * own title. See GitHub issue #441.
 */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
