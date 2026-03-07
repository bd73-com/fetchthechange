import { useEffect } from "react";

export function getCanonicalUrl(path: string): string {
  const baseUrl =
    import.meta.env.VITE_PUBLIC_BASE_URL ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "https://fetch-the-change.replit.app");
  return `${baseUrl}${path}`;
}

interface MetaTag {
  name?: string;
  property?: string;
  content: string;
}

export interface SEOHeadProps {
  title: string;
  description: string;
  path: string;
  ogType?: "website" | "article";
  ogTitle?: string;
  ogDescription?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  jsonLd?: Record<string, unknown>;
}

export default function SEOHead({
  title,
  description,
  path,
  ogType = "website",
  ogTitle,
  ogDescription,
  twitterTitle,
  twitterDescription,
  jsonLd,
}: SEOHeadProps) {
  useEffect(() => {
    const canonicalUrl = getCanonicalUrl(path);

    document.title = title;

    const metaTags: MetaTag[] = [
      { name: "description", content: description },
      { property: "og:title", content: ogTitle ?? title },
      { property: "og:description", content: ogDescription ?? description },
      { property: "og:type", content: ogType },
      { property: "og:url", content: canonicalUrl },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: twitterTitle ?? title },
      {
        name: "twitter:description",
        content: twitterDescription ?? description,
      },
    ];

    const elements: HTMLElement[] = [];

    metaTags.forEach((tag) => {
      const meta = document.createElement("meta");
      if (tag.name) meta.setAttribute("name", tag.name);
      if (tag.property) meta.setAttribute("property", tag.property);
      meta.setAttribute("content", tag.content);
      document.head.appendChild(meta);
      elements.push(meta);
    });

    const canonicalLink = document.createElement("link");
    canonicalLink.setAttribute("rel", "canonical");
    canonicalLink.setAttribute("href", canonicalUrl);
    document.head.appendChild(canonicalLink);
    elements.push(canonicalLink);

    if (jsonLd) {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.text = JSON.stringify(jsonLd);
      document.head.appendChild(script);
      elements.push(script);
    }

    return () => {
      elements.forEach((el) => el.remove());
    };
  }, [title, description, path, ogType, ogTitle, ogDescription, twitterTitle, twitterDescription, jsonLd]);

  return null;
}
