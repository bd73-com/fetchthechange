/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";

/**
 * Extract the prefill-param parsing logic from Dashboard so it can be unit-tested
 * without mounting the full component (which has many provider dependencies).
 *
 * This mirrors the useMemo in Dashboard.tsx that reads ?url=&selector=&name=
 * query params from the URL when the extension opens the dashboard.
 */
function parsePrefillParams(searchString: string) {
  const params = new URLSearchParams(searchString);
  if (params.has("checkout")) return null;
  const url = params.get("url");
  if (!url) return null;
  return {
    url,
    selector: params.get("selector") || undefined,
    name: params.get("name") || undefined,
  };
}

describe("Dashboard prefill param parsing", () => {
  it("extracts url, selector, and name from query string", () => {
    const result = parsePrefillParams("?url=https%3A%2F%2Fexample.com&selector=.price&name=My+Monitor");
    expect(result).toEqual({
      url: "https://example.com",
      selector: ".price",
      name: "My Monitor",
    });
  });

  it("works without leading ? in search string", () => {
    const result = parsePrefillParams("url=https%3A%2F%2Fexample.com&selector=.price");
    expect(result).toEqual({
      url: "https://example.com",
      selector: ".price",
      name: undefined,
    });
  });

  it("returns null when url param is missing", () => {
    expect(parsePrefillParams("?selector=.price")).toBeNull();
  });

  it("returns null when url param is empty", () => {
    expect(parsePrefillParams("?url=&selector=.price")).toBeNull();
  });

  it("returns null when checkout param is present (Stripe redirect)", () => {
    const result = parsePrefillParams("?checkout=success&url=https%3A%2F%2Fexample.com");
    expect(result).toBeNull();
  });

  it("returns null when checkout=cancelled is present", () => {
    const result = parsePrefillParams("?checkout=cancelled&url=https%3A%2F%2Fexample.com");
    expect(result).toBeNull();
  });

  it("returns null for empty search string", () => {
    expect(parsePrefillParams("")).toBeNull();
  });

  it("preserves complex URLs with query params and fragments", () => {
    const complexUrl = "https://example.com/page?a=1&b=2#section";
    const encoded = new URLSearchParams({ url: complexUrl, selector: "div.main" }).toString();
    const result = parsePrefillParams(encoded);
    expect(result).toEqual({
      url: complexUrl,
      selector: "div.main",
      name: undefined,
    });
  });

  it("omits selector and name when not provided", () => {
    const result = parsePrefillParams("?url=https%3A%2F%2Fexample.com");
    expect(result).toEqual({
      url: "https://example.com",
      selector: undefined,
      name: undefined,
    });
  });
});
