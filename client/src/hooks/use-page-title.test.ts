/**
 * Tests: usePageTitle hook (GitHub issue #441)
 *
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { usePageTitle } from "./use-page-title";

describe("usePageTitle", () => {
  beforeEach(() => {
    document.title = "initial";
  });

  it("sets document.title on mount", () => {
    renderHook(() => usePageTitle("My Page — FetchTheChange"));
    expect(document.title).toBe("My Page — FetchTheChange");
  });

  it("restores the previous title on unmount", () => {
    document.title = "previous";
    const { unmount } = renderHook(() => usePageTitle("My Page"));
    expect(document.title).toBe("My Page");
    unmount();
    expect(document.title).toBe("previous");
  });

  it("does not change title when given undefined", () => {
    document.title = "unchanged";
    renderHook(() => usePageTitle(undefined));
    expect(document.title).toBe("unchanged");
  });

  it("does not change title when given an empty string", () => {
    // Locks down the `!title` guard so a future tightening to `=== undefined`
    // doesn't silently clobber document.title with "".
    document.title = "unchanged";
    renderHook(() => usePageTitle(""));
    expect(document.title).toBe("unchanged");
  });

  it("updates title when the prop changes", () => {
    const { rerender } = renderHook(
      ({ title }: { title: string }) => usePageTitle(title),
      { initialProps: { title: "First" } },
    );
    expect(document.title).toBe("First");
    rerender({ title: "Second" });
    expect(document.title).toBe("Second");
  });

  it("nested unmount still restores the outer title", () => {
    document.title = "outer";
    const outer = renderHook(() => usePageTitle("outer-page"));
    expect(document.title).toBe("outer-page");
    const inner = renderHook(() => usePageTitle("inner-page"));
    expect(document.title).toBe("inner-page");
    inner.unmount();
    // After inner unmounts its title effect restores the value that was
    // current when it mounted — which was outer-page.
    expect(document.title).toBe("outer-page");
    outer.unmount();
    expect(document.title).toBe("outer");
  });
});
