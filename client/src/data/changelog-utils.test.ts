import { describe, it, expect } from "vitest";
import { parseBody, badgeVariant } from "./changelog-utils";

describe("parseBody", () => {
  it("parses a typical release-drafter body with multiple sections", () => {
    const body = [
      "## What's Changed",
      "",
      "### Features",
      "- Add changelog page by @user in #100",
      "- Add webhook support by @user in #101",
      "",
      "### Bug Fixes",
      "- Fix monitor polling by @user in #102",
      "",
      "**Full Changelog**: https://github.com/org/repo/compare/v1.0.0...v1.1.0",
    ].join("\n");

    const sections = parseBody(body);

    expect(sections).toEqual([
      {
        heading: "Features",
        items: [
          "Add changelog page by @user in #100",
          "Add webhook support by @user in #101",
        ],
      },
      {
        heading: "Bug Fixes",
        items: ["Fix monitor polling by @user in #102"],
      },
    ]);
  });

  it("ignores ## headings (only matches ###)", () => {
    const body = "## What's Changed\n- Some item\n### Features\n- Real item";
    const sections = parseBody(body);

    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("Features");
    expect(sections[0].items).toEqual(["Real item"]);
  });

  it("ignores bullet items before the first heading", () => {
    const body = "- orphan item\n### Features\n- Real item";
    const sections = parseBody(body);

    expect(sections).toHaveLength(1);
    expect(sections[0].items).toEqual(["Real item"]);
  });

  it("returns empty array for body with no ### headings", () => {
    expect(parseBody("Just some text\nwith no headings")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseBody("")).toEqual([]);
  });

  it("handles asterisk bullets", () => {
    const body = "### Security\n* Fix XSS vulnerability";
    const sections = parseBody(body);

    expect(sections[0].items).toEqual(["Fix XSS vulnerability"]);
  });

  it("handles indented bullets", () => {
    const body = "### Features\n  - Indented item";
    const sections = parseBody(body);

    expect(sections[0].items).toEqual(["Indented item"]);
  });

  it("trims whitespace from headings and items", () => {
    const body = "###   Features  \n-   Spaced item  ";
    const sections = parseBody(body);

    expect(sections[0].heading).toBe("Features");
    expect(sections[0].items).toEqual(["Spaced item"]);
  });

  it("handles multiple consecutive headings with no items", () => {
    const body = "### Features\n### Bug Fixes\n- A fix";
    const sections = parseBody(body);

    expect(sections).toHaveLength(2);
    expect(sections[0]).toEqual({ heading: "Features", items: [] });
    expect(sections[1]).toEqual({ heading: "Bug Fixes", items: ["A fix"] });
  });

  it("does not match **bold** lines as bullet items", () => {
    const body =
      "### Features\n- Real item\n**Full Changelog**: https://example.com";
    const sections = parseBody(body);

    expect(sections[0].items).toEqual(["Real item"]);
  });
});

describe("badgeVariant", () => {
  it('returns "destructive" for Breaking Changes', () => {
    expect(badgeVariant("Breaking Changes")).toBe("destructive");
  });

  it('returns "default" for Features', () => {
    expect(badgeVariant("Features")).toBe("default");
  });

  it('returns "outline" for Security', () => {
    expect(badgeVariant("Security")).toBe("outline");
  });

  it('returns "secondary" for Bug Fixes', () => {
    expect(badgeVariant("Bug Fixes")).toBe("secondary");
  });

  it('returns "secondary" for Maintenance', () => {
    expect(badgeVariant("Maintenance")).toBe("secondary");
  });

  it("is case-insensitive", () => {
    expect(badgeVariant("BREAKING CHANGES")).toBe("destructive");
    expect(badgeVariant("features")).toBe("default");
    expect(badgeVariant("SECURITY")).toBe("outline");
  });
});
