/**
 * Tests: NotFound page
 * Coverage: robots meta tag lifecycle (inject on mount, restore on unmount)
 *           so SPA 404s don't get indexed as soft-404 content.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import NotFound from "./not-found";

function getRobotsMeta(): HTMLMetaElement | null {
  return document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
}

describe("NotFound noindex meta tag", () => {
  beforeEach(() => {
    // Clear any robots meta tags that leaked in from a previous test.
    document.head
      .querySelectorAll('meta[name="robots"]')
      .forEach((el) => el.remove());
  });

  afterEach(() => {
    document.head
      .querySelectorAll('meta[name="robots"]')
      .forEach((el) => el.remove());
  });

  it("injects <meta name='robots' content='noindex'> on mount when none existed", () => {
    expect(getRobotsMeta()).toBeNull();

    const { unmount } = render(<NotFound />);
    const meta = getRobotsMeta();
    expect(meta).not.toBeNull();
    expect(meta!.getAttribute("content")).toBe("noindex");

    unmount();
  });

  it("removes the injected meta tag on unmount when none existed before", () => {
    expect(getRobotsMeta()).toBeNull();

    const { unmount } = render(<NotFound />);
    expect(getRobotsMeta()).not.toBeNull();

    unmount();
    expect(getRobotsMeta()).toBeNull();
  });

  it("overrides an existing robots meta on mount and restores original content on unmount", () => {
    // Simulate a page that already set robots (e.g. a future page wants
    // "index,follow" as an explicit default). NotFound should stomp that
    // while mounted, then restore it on unmount.
    const existing = document.createElement("meta");
    existing.setAttribute("name", "robots");
    existing.setAttribute("content", "index,follow");
    document.head.appendChild(existing);

    const { unmount } = render(<NotFound />);
    const mountedMeta = getRobotsMeta();
    expect(mountedMeta).not.toBeNull();
    expect(mountedMeta!.getAttribute("content")).toBe("noindex");
    // Overriding an existing tag must not create a duplicate.
    expect(document.head.querySelectorAll('meta[name="robots"]').length).toBe(1);

    unmount();
    const afterUnmount = getRobotsMeta();
    expect(afterUnmount).not.toBeNull();
    expect(afterUnmount!.getAttribute("content")).toBe("index,follow");
  });

  it("preserves an existing robots meta that had no content attribute", () => {
    // Edge case: a page set up `<meta name="robots">` with no content value.
    // Cleanup must leave the tag in place with no content attribute — not
    // remove it (which would happen if we conflated "no content attribute"
    // with "no tag existed at all").
    const existing = document.createElement("meta");
    existing.setAttribute("name", "robots");
    document.head.appendChild(existing);

    const { unmount } = render(<NotFound />);
    const mountedMeta = getRobotsMeta();
    expect(mountedMeta).not.toBeNull();
    expect(mountedMeta!.getAttribute("content")).toBe("noindex");
    expect(document.head.querySelectorAll('meta[name="robots"]').length).toBe(1);

    unmount();
    const afterUnmount = getRobotsMeta();
    expect(afterUnmount).not.toBeNull();
    expect(afterUnmount!.hasAttribute("content")).toBe(false);
  });

  it("renders the 404 heading", () => {
    const { getByText, unmount } = render(<NotFound />);
    expect(getByText("404 Page Not Found")).toBeDefined();
    unmount();
  });
});
