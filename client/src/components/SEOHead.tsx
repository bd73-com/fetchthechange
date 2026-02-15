import { useEffect } from "react";

interface SEOHeadProps {
  title: string;
  description: string;
  canonicalPath: string;
  author: string;
  publishDate: string;
}

function getCanonicalUrl(path: string) {
  const baseUrl = import.meta.env.VITE_PUBLIC_BASE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "https://fetch-the-change.replit.app");
  return `${baseUrl}${path}`;
}

export default function SEOHead({ title, description, canonicalPath, author, publishDate }: SEOHeadProps) {
  useEffect(() => {
    const canonicalUrl = getCanonicalUrl(canonicalPath);
    const todayDate = new Date().toISOString().split('T')[0];

    document.title = title;

    const metaTags = [
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "article" },
      { property: "og:url", content: canonicalUrl },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ];

    const createdMetas: HTMLMetaElement[] = [];
    metaTags.forEach(tag => {
      const meta = document.createElement("meta");
      if (tag.name) meta.setAttribute("name", tag.name);
      if (tag.property) meta.setAttribute("property", tag.property);
      meta.setAttribute("content", tag.content);
      document.head.appendChild(meta);
      createdMetas.push(meta);
    });

    const canonicalLink = document.createElement("link");
    canonicalLink.setAttribute("rel", "canonical");
    canonicalLink.setAttribute("href", canonicalUrl);
    document.head.appendChild(canonicalLink);

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": title,
      "description": description,
      "author": { "@type": "Person", "name": author },
      "publisher": { "@type": "Organization", "name": "FetchTheChange" },
      "mainEntityOfPage": canonicalUrl,
      "datePublished": publishDate,
      "dateModified": todayDate,
    };

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.text = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    return () => {
      createdMetas.forEach(meta => meta.remove());
      canonicalLink.remove();
      script.remove();
    };
  }, [title, description, canonicalPath, author, publishDate]);

  return null;
}
