import { describe, it, expect } from "vitest";
import { escapeAttr, sanitizeTier } from "./utils";

describe("escapeAttr", () => {
  it("escapes ampersand before other entities", () => {
    expect(escapeAttr("A & B")).toBe("A &amp; B");
  });

  it("escapes double quotes", () => {
    expect(escapeAttr('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeAttr("it's")).toBe("it&#39;s");
  });

  it("escapes angle brackets", () => {
    expect(escapeAttr("<script>")).toBe("&lt;script&gt;");
  });

  it("does not double-escape existing entities", () => {
    // Input contains a literal "&quot;" — the & should be escaped first
    expect(escapeAttr("&quot;")).toBe("&amp;quot;");
  });

  it("handles strings with multiple special characters", () => {
    expect(escapeAttr('Price &lt; $5 "deal"')).toBe(
      "Price &amp;lt; $5 &quot;deal&quot;",
    );
  });

  it("returns empty string unchanged", () => {
    expect(escapeAttr("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(escapeAttr("hello world")).toBe("hello world");
  });
});

describe("sanitizeTier", () => {
  it("passes through known tiers", () => {
    expect(sanitizeTier("free")).toBe("free");
    expect(sanitizeTier("pro")).toBe("pro");
    expect(sanitizeTier("power")).toBe("power");
  });

  it("falls back to free for unknown tiers", () => {
    expect(sanitizeTier("enterprise")).toBe("free");
    expect(sanitizeTier("")).toBe("free");
    expect(sanitizeTier("FREE")).toBe("free");
  });
});
