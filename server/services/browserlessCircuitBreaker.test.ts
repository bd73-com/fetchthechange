import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { BrowserlessCircuitBreaker } from "./browserlessCircuitBreaker";

describe("BrowserlessCircuitBreaker", () => {
  let cb: BrowserlessCircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    cb = new BrowserlessCircuitBreaker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in closed state and is available", () => {
    expect(cb.getState()).toBe("closed");
    expect(cb.isAvailable()).toBe(true);
  });

  it("stays closed after fewer than threshold failures", () => {
    cb.recordInfraFailure();
    cb.recordInfraFailure();
    expect(cb.getState()).toBe("closed");
    expect(cb.isAvailable()).toBe(true);
  });

  it("opens after threshold consecutive failures", () => {
    cb.recordInfraFailure();
    cb.recordInfraFailure();
    cb.recordInfraFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.isAvailable()).toBe(false);
  });

  it("blocks calls while open", () => {
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    expect(cb.isAvailable()).toBe(false);
    expect(cb.isAvailable()).toBe(false);
  });

  it("transitions to half_open after cooldown (2 minutes base)", () => {
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    expect(cb.getState()).toBe("open");

    // Advance past base cooldown (2 minutes)
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(cb.getState()).toBe("half_open");
    expect(cb.isAvailable()).toBe(true);
  });

  it("allows up to 3 probes while half_open", () => {
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(cb.getState()).toBe("half_open");

    expect(cb.isAvailable()).toBe(true);   // probe 1
    expect(cb.isAvailable()).toBe(true);   // probe 2
    expect(cb.isAvailable()).toBe(true);   // probe 3
    expect(cb.isAvailable()).toBe(false);  // no more probes

    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    expect(cb.isAvailable()).toBe(true);
  });

  it("closes on success in half_open state", () => {
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(cb.getState()).toBe("half_open");

    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    expect(cb.isAvailable()).toBe(true);
  });

  it("re-opens only when all half_open probes fail", () => {
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(cb.getState()).toBe("half_open");

    // Consume all 3 probes
    cb.isAvailable();
    cb.isAvailable();
    cb.isAvailable();

    // First two failures don't reopen (probes still in flight)
    cb.recordInfraFailure();
    expect(cb.getState()).toBe("half_open");
    cb.recordInfraFailure();
    expect(cb.getState()).toBe("half_open");

    // Third failure: all probes resolved, none succeeded → reopen
    cb.recordInfraFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.isAvailable()).toBe(false);
  });

  it("first success in half_open closes circuit even with concurrent failures", () => {
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    vi.advanceTimersByTime(2 * 60 * 1000);

    // 3 probes consumed
    cb.isAvailable();
    cb.isAvailable();
    cb.isAvailable();

    // First probe fails
    cb.recordInfraFailure();
    expect(cb.getState()).toBe("half_open");

    // Second probe succeeds → circuit closes
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");

    // Third probe failure should not reopen (already closed)
    cb.recordInfraFailure();
    // Only 1 failure in window, not enough to open
    expect(cb.getState()).toBe("closed");
  });

  it("success resets failure count in closed state", () => {
    cb.recordInfraFailure();
    cb.recordInfraFailure();
    cb.recordSuccess();

    // Should need 3 fresh failures to open again
    cb.recordInfraFailure();
    cb.recordInfraFailure();
    expect(cb.getState()).toBe("closed");

    cb.recordInfraFailure();
    expect(cb.getState()).toBe("open");
  });

  it("prunes failures outside the 5-minute window", () => {
    cb.recordInfraFailure();
    cb.recordInfraFailure();

    // Advance past the failure window
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    // Old failures are pruned, need 3 fresh ones
    cb.recordInfraFailure();
    expect(cb.getState()).toBe("closed");
  });

  it("reset restores initial state", () => {
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    expect(cb.getState()).toBe("open");

    cb.reset();
    expect(cb.getState()).toBe("closed");
    expect(cb.isAvailable()).toBe(true);
  });

  it("recording failure when already open does not change state", () => {
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    expect(cb.getState()).toBe("open");

    // Additional failures while open should keep it open
    cb.recordInfraFailure();
    cb.recordInfraFailure();
    expect(cb.getState()).toBe("open");
  });

  it("handles multiple open-halfopen-open cycles with backoff", () => {
    // Cycle 1: open the circuit
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    expect(cb.getState()).toBe("open");

    // Wait for base cooldown (2 min) → half_open
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(cb.getState()).toBe("half_open");

    // All 3 probes fail → open again
    cb.isAvailable();
    cb.isAvailable();
    cb.isAvailable();
    cb.recordInfraFailure();
    cb.recordInfraFailure();
    cb.recordInfraFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.isAvailable()).toBe(false);

    // Cycle 2: cooldown should be 4 minutes (2 min * 2^1)
    vi.advanceTimersByTime(2 * 60 * 1000); // only 2 min — not enough
    expect(cb.getState()).toBe("open");
    vi.advanceTimersByTime(2 * 60 * 1000); // now 4 min total
    expect(cb.getState()).toBe("half_open");
    expect(cb.isAvailable()).toBe(true);

    // Probe succeeds → closed
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    expect(cb.isAvailable()).toBe(true);
  });

  it("backs off cooldown exponentially: 2 min → 4 min → 8 min → 10 min cap", () => {
    expect(cb.getCurrentCooldownMs()).toBe(2 * 60 * 1000); // base

    // Cycle 1
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    vi.advanceTimersByTime(2 * 60 * 1000);
    cb.isAvailable(); cb.isAvailable(); cb.isAvailable();
    cb.recordInfraFailure(); cb.recordInfraFailure(); cb.recordInfraFailure();
    expect(cb.getCurrentCooldownMs()).toBe(4 * 60 * 1000); // 2^1

    // Cycle 2
    vi.advanceTimersByTime(4 * 60 * 1000);
    cb.isAvailable(); cb.isAvailable(); cb.isAvailable();
    cb.recordInfraFailure(); cb.recordInfraFailure(); cb.recordInfraFailure();
    expect(cb.getCurrentCooldownMs()).toBe(8 * 60 * 1000); // 2^2

    // Cycle 3
    vi.advanceTimersByTime(8 * 60 * 1000);
    cb.isAvailable(); cb.isAvailable(); cb.isAvailable();
    cb.recordInfraFailure(); cb.recordInfraFailure(); cb.recordInfraFailure();
    expect(cb.getCurrentCooldownMs()).toBe(10 * 60 * 1000); // capped at 10 min
  });

  it("resets consecutiveOpenCycles to 0 on successful close", () => {
    // Build up consecutive cycles
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    vi.advanceTimersByTime(2 * 60 * 1000);
    cb.isAvailable(); cb.isAvailable(); cb.isAvailable();
    cb.recordInfraFailure(); cb.recordInfraFailure(); cb.recordInfraFailure();
    expect(cb.getCurrentCooldownMs()).toBe(4 * 60 * 1000);

    // Now succeed
    vi.advanceTimersByTime(4 * 60 * 1000);
    cb.isAvailable();
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");

    // Cooldown should be back to base
    expect(cb.getCurrentCooldownMs()).toBe(2 * 60 * 1000);
  });

  it("isAvailable transitions open to half_open on call after cooldown", () => {
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    expect(cb.isAvailable()).toBe(false);

    vi.advanceTimersByTime(2 * 60 * 1000);

    // isAvailable should itself trigger the transition
    expect(cb.isAvailable()).toBe(true);
    expect(cb.getState()).toBe("half_open");
  });

  it("success in closed state has no adverse effects", () => {
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    expect(cb.isAvailable()).toBe(true);
  });

  it("fires onClose callback when circuit transitions to closed", () => {
    const callback = vi.fn();
    cb.onClose(callback);

    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    vi.advanceTimersByTime(2 * 60 * 1000);
    cb.isAvailable();
    cb.recordSuccess();

    expect(callback).toHaveBeenCalledOnce();
  });

  it("does not fire onClose callback when recordSuccess is called in closed state", () => {
    const callback = vi.fn();
    cb.onClose(callback);

    cb.recordSuccess();
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not throw if onClose callback throws", () => {
    cb.onClose(() => { throw new Error("callback error"); });

    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    vi.advanceTimersByTime(2 * 60 * 1000);
    cb.isAvailable();

    expect(() => cb.recordSuccess()).not.toThrow();
    expect(cb.getState()).toBe("closed");
  });

  it("reset clears onClose callback", () => {
    const callback = vi.fn();
    cb.onClose(callback);
    cb.reset();
    cb.recordSuccess();
    expect(callback).not.toHaveBeenCalled();
  });
});
