/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import SEOHead, { getCanonicalUrl } from "./SEOHead";

function getMeta(selector: string): string | null {
  const el = document.head.querySelector<HTMLMetaElement>(selector);
  return el?.getAttribute("content") ?? null;
}

describe("SEOHead", () => {
  beforeEach(() => {
    document.head
      .querySelectorAll('meta, link[rel="canonical"], script[type="application/ld+json"]')
      .forEach((el) => el.remove());
    document.title = "";
  });

  afterEach(() => {
    cleanup();
  });

  it("sets title, description and canonical", () => {
    render(
      <SEOHead title="Page Title" description="A description" path="/pricing" />,
    );
    expect(document.title).toBe("Page Title");
    expect(getMeta('meta[name="description"]')).toBe("A description");
    expect(
      document.head
        .querySelector<HTMLLinkElement>('link[rel="canonical"]')
        ?.getAttribute("href"),
    ).toBe(getCanonicalUrl("/pricing"));
  });

  it("emits og:site_name = FetchTheChange", () => {
    render(<SEOHead title="T" description="D" path="/" />);
    expect(getMeta('meta[property="og:site_name"]')).toBe("FetchTheChange");
  });

  it("upgrades twitter:card to summary_large_image", () => {
    render(<SEOHead title="T" description="D" path="/" />);
    expect(getMeta('meta[name="twitter:card"]')).toBe("summary_large_image");
  });

  it("uses the default og:image when ogImage is not provided", () => {
    render(<SEOHead title="T" description="D" path="/" />);
    const expected = getCanonicalUrl("/images/fix-selector-showcase.png");
    expect(getMeta('meta[property="og:image"]')).toBe(expected);
    expect(getMeta('meta[name="twitter:image"]')).toBe(expected);
  });

  it("uses the provided ogImage when one is passed", () => {
    render(
      <SEOHead
        title="T"
        description="D"
        path="/"
        ogImage="/images/custom.png"
      />,
    );
    const expected = getCanonicalUrl("/images/custom.png");
    expect(getMeta('meta[property="og:image"]')).toBe(expected);
    expect(getMeta('meta[name="twitter:image"]')).toBe(expected);
  });

  it("re-runs the effect when ogImage changes", () => {
    const { rerender } = render(
      <SEOHead title="T" description="D" path="/" ogImage="/images/a.png" />,
    );
    expect(getMeta('meta[property="og:image"]')).toBe(
      getCanonicalUrl("/images/a.png"),
    );

    rerender(
      <SEOHead title="T" description="D" path="/" ogImage="/images/b.png" />,
    );
    expect(getMeta('meta[property="og:image"]')).toBe(
      getCanonicalUrl("/images/b.png"),
    );
  });

  it("emits a JSON-LD script when jsonLd is provided", () => {
    const schema = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "FetchTheChange",
    };
    render(<SEOHead title="T" description="D" path="/" jsonLd={schema} />);
    const script = document.head.querySelector<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    );
    expect(script).not.toBeNull();
    expect(JSON.parse(script!.text)).toEqual(schema);
  });

  it("does not emit a JSON-LD script when jsonLd is absent", () => {
    render(<SEOHead title="T" description="D" path="/" />);
    expect(
      document.head.querySelector('script[type="application/ld+json"]'),
    ).toBeNull();
  });

  it("cleans up created meta tags on unmount", () => {
    const { unmount } = render(<SEOHead title="T" description="D" path="/" />);
    expect(getMeta('meta[property="og:site_name"]')).toBe("FetchTheChange");
    unmount();
    expect(
      document.head.querySelector('meta[property="og:site_name"]'),
    ).toBeNull();
  });
});
