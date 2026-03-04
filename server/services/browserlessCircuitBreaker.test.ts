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

  it("transitions to half_open after cooldown", () => {
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    expect(cb.getState()).toBe("open");

    // Advance past cooldown (5 minutes)
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(cb.getState()).toBe("half_open");
    expect(cb.isAvailable()).toBe(true);
  });

  it("closes on success in half_open state", () => {
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(cb.getState()).toBe("half_open");

    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    expect(cb.isAvailable()).toBe(true);
  });

  it("re-opens on failure in half_open state", () => {
    for (let i = 0; i < 3; i++) cb.recordInfraFailure();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(cb.getState()).toBe("half_open");

    cb.recordInfraFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.isAvailable()).toBe(false);
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
});
