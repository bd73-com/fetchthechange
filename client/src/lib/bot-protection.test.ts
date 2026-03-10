import { describe, it, expect } from "vitest";
import { detectBotProtectedUrl } from "./bot-protection";

describe("detectBotProtectedUrl", () => {
  it("returns warning for exact-match host", () => {
    expect(detectBotProtectedUrl("https://jomashop.com/watches")).toContain("bot protection");
  });

  it("returns warning for exact-match host with www prefix", () => {
    expect(detectBotProtectedUrl("https://www.amazon.com/dp/B01234")).toContain("bot protection");
  });

  it("returns warning for Scandinavian retail host", () => {
    expect(detectBotProtectedUrl("https://dekk365.no/product/123")).toContain("bot protection");
  });

  it("returns warning for ticketing site", () => {
    expect(detectBotProtectedUrl("https://www.ticketmaster.com/event/123")).toContain("bot protection");
  });

  it("returns warning for hostname containing shopify substring", () => {
    expect(detectBotProtectedUrl("https://my-store.myshopify.com/products/1")).toContain("bot protection");
  });

  it("returns warning for hostname containing bigcommerce substring", () => {
    expect(detectBotProtectedUrl("https://store.bigcommerce.com/product")).toContain("bot protection");
  });

  it("returns warning for hostname containing salesforce substring", () => {
    expect(detectBotProtectedUrl("https://shop.salesforce-commerce.example.com/item")).toContain("bot protection");
  });

  it("returns null for safe URL", () => {
    expect(detectBotProtectedUrl("https://example.com/page")).toBeNull();
  });

  it("returns null for invalid URL", () => {
    expect(detectBotProtectedUrl("not-a-url")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectBotProtectedUrl("")).toBeNull();
  });

  it("is case-insensitive for hostname", () => {
    expect(detectBotProtectedUrl("https://WWW.JOMASHOP.COM/watch")).toContain("bot protection");
  });

  it("matches amazon regional domains", () => {
    expect(detectBotProtectedUrl("https://amazon.co.uk/dp/B99")).toContain("bot protection");
    expect(detectBotProtectedUrl("https://amazon.de/dp/B99")).toContain("bot protection");
    expect(detectBotProtectedUrl("https://amazon.co.jp/dp/B99")).toContain("bot protection");
  });

  it("does not match partial hostname that is not a substring pattern", () => {
    // "amazon" is an exact match, not a substring — "notamazon.com" should not match
    expect(detectBotProtectedUrl("https://notamazon.com/page")).toBeNull();
  });

  it("does not match path containing blocked hostname", () => {
    expect(detectBotProtectedUrl("https://safe.com/jomashop.com")).toBeNull();
  });

  it("matches subdomains of exact hosts", () => {
    expect(detectBotProtectedUrl("https://shop.amazon.com/product")).toContain("bot protection");
    expect(detectBotProtectedUrl("https://smile.amazon.co.uk/wishlist")).toContain("bot protection");
    expect(detectBotProtectedUrl("https://music.amazon.de/albums")).toContain("bot protection");
  });

  it("matches deep subdomains of exact hosts", () => {
    expect(detectBotProtectedUrl("https://a.b.ebay.com/item")).toContain("bot protection");
  });
});
