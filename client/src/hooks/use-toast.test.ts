/**
 * Tests: use-toast reducer and toast function
 * Coverage: reducer (ADD_TOAST, UPDATE_TOAST, DISMISS_TOAST, REMOVE_TOAST)
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reducer } from "./use-toast";

const makeToast = (id: string, title: string) => ({
  id,
  title,
  open: true,
  onOpenChange: () => {},
});

describe("toast reducer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ADD_TOAST adds a toast to the list", () => {
    const state = { toasts: [] };
    const toast = makeToast("1", "Hello");

    const next = reducer(state, { type: "ADD_TOAST", toast });

    expect(next.toasts).toHaveLength(1);
    expect(next.toasts[0].title).toBe("Hello");
  });

  it("ADD_TOAST limits to TOAST_LIMIT (1)", () => {
    const state = { toasts: [makeToast("1", "First")] };
    const toast = makeToast("2", "Second");

    const next = reducer(state, { type: "ADD_TOAST", toast });

    // TOAST_LIMIT = 1, so only the newest toast should remain
    expect(next.toasts).toHaveLength(1);
    expect(next.toasts[0].title).toBe("Second");
  });

  it("UPDATE_TOAST updates matching toast", () => {
    const state = { toasts: [makeToast("1", "Original")] };

    const next = reducer(state, {
      type: "UPDATE_TOAST",
      toast: { id: "1", title: "Updated" },
    });

    expect(next.toasts[0].title).toBe("Updated");
  });

  it("UPDATE_TOAST does not affect non-matching toasts", () => {
    const state = { toasts: [makeToast("1", "Original")] };

    const next = reducer(state, {
      type: "UPDATE_TOAST",
      toast: { id: "999", title: "Nope" },
    });

    expect(next.toasts[0].title).toBe("Original");
  });

  it("DISMISS_TOAST sets open to false for matching toast", () => {
    const state = { toasts: [makeToast("1", "Hello")] };

    const next = reducer(state, { type: "DISMISS_TOAST", toastId: "1" });

    expect(next.toasts[0].open).toBe(false);
  });

  it("DISMISS_TOAST without toastId dismisses all", () => {
    const t1 = makeToast("1", "First");
    const t2 = makeToast("2", "Second");
    // Manually set limit > 1 for this test by constructing state directly
    const state = { toasts: [t1, t2] };

    const next = reducer(state, { type: "DISMISS_TOAST" });

    expect(next.toasts.every((t) => t.open === false)).toBe(true);
  });

  it("REMOVE_TOAST removes matching toast", () => {
    const state = { toasts: [makeToast("1", "Hello")] };

    const next = reducer(state, { type: "REMOVE_TOAST", toastId: "1" });

    expect(next.toasts).toHaveLength(0);
  });

  it("REMOVE_TOAST without toastId removes all", () => {
    const state = { toasts: [makeToast("1", "A"), makeToast("2", "B")] };

    const next = reducer(state, { type: "REMOVE_TOAST" });

    expect(next.toasts).toHaveLength(0);
  });
});
