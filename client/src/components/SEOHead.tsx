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
  ogImage?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  jsonLd?: Record<string, unknown>;
}

const DEFAULT_OG_IMAGE = "/images/fix-selector-showcase.png";

export default function SEOHead({
  title,
  description,
  path,
  ogType = "website",
  ogTitle,
  ogDescription,
  ogImage,
  twitterTitle,
  twitterDescription,
  jsonLd,
}: SEOHeadProps) {
  useEffect(() => {
    const canonicalUrl = getCanonicalUrl(path);
    const imageUrl = getCanonicalUrl(ogImage ?? DEFAULT_OG_IMAGE);

    document.title = title;

    const metaTags: MetaTag[] = [
      { name: "description", content: description },
      { property: "og:site_name", content: "FetchTheChange" },
      { property: "og:title", content: ogTitle ?? title },
      { property: "og:description", content: ogDescription ?? description },
      { property: "og:type", content: ogType },
      { property: "og:url", content: canonicalUrl },
      { property: "og:image", content: imageUrl },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: twitterTitle ?? title },
      {
        name: "twitter:description",
        content: twitterDescription ?? description,
      },
      { name: "twitter:image", content: imageUrl },
    ];

    const created: HTMLElement[] = [];
    const previousValues: { el: HTMLElement; attr: string; value: string }[] =
      [];

    metaTags.forEach((tag) => {
      const selector = tag.name
        ? `meta[name="${tag.name}"]`
        : `meta[property="${tag.property}"]`;
      const existing = document.head.querySelector<HTMLMetaElement>(selector);
      if (existing) {
        previousValues.push({
          el: existing,
          attr: "content",
          value: existing.getAttribute("content") ?? "",
        });
        existing.setAttribute("content", tag.content);
      } else {
        const meta = document.createElement("meta");
        if (tag.name) meta.setAttribute("name", tag.name);
        if (tag.property) meta.setAttribute("property", tag.property);
        meta.setAttribute("content", tag.content);
        document.head.appendChild(meta);
        created.push(meta);
      }
    });

    let canonicalLink = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (canonicalLink) {
      previousValues.push({
        el: canonicalLink,
        attr: "href",
        value: canonicalLink.getAttribute("href") ?? "",
      });
      canonicalLink.setAttribute("href", canonicalUrl);
    } else {
      canonicalLink = document.createElement("link");
      canonicalLink.setAttribute("rel", "canonical");
      canonicalLink.setAttribute("href", canonicalUrl);
      document.head.appendChild(canonicalLink);
      created.push(canonicalLink);
    }

    let jsonLdScript: HTMLScriptElement | null = null;
    if (jsonLd) {
      jsonLdScript = document.createElement("script");
      jsonLdScript.type = "application/ld+json";
      jsonLdScript.text = JSON.stringify(jsonLd);
      document.head.appendChild(jsonLdScript);
    }

    return () => {
      created.forEach((el) => {
        el.remove();
      });
      previousValues.forEach((pv) => {
        pv.el.setAttribute(pv.attr, pv.value);
      });
      jsonLdScript?.remove();
    };
  }, [title, description, path, ogType, ogTitle, ogDescription, twitterTitle, twitterDescription, jsonLd]);

  return null;
}
