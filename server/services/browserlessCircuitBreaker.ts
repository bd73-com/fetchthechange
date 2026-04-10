/**
 * Browserless Circuit Breaker
 *
 * Tracks Browserless infrastructure health at the system level to prevent
 * cascading failures when the service is down. When the circuit is OPEN,
 * Browserless calls are skipped entirely — saving ~30s timeout per check.
 *
 * State machine:
 *   CLOSED    → (3 infra failures within window) → OPEN
 *   OPEN      → (cooldown expires)               → HALF_OPEN
 *   HALF_OPEN → (any probe succeeds)             → CLOSED
 *   HALF_OPEN → (all probes fail)                → OPEN
 *
 * Recovery features:
 *   - Multiple probes in half_open (up to 3) — first success closes circuit
 *   - Exponential backoff on repeated open cycles (2 min → 4 min → 8 min → 10 min cap)
 *   - onClose callback for immediate downstream reaction
 */

export type CircuitState = "closed" | "open" | "half_open";

const FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const BASE_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes
const MAX_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const HALF_OPEN_PROBE_LIMIT = 3;

export class BrowserlessCircuitBreaker {
  private state: CircuitState = "closed";
  private failures: number[] = []; // timestamps of recent infra failures
  private openedAt = 0;
  private consecutiveOpenCycles = 0;
  private halfOpenProbesAllowed = 0;
  private halfOpenProbesInFlight = 0;
  private halfOpenSucceeded = false;
  private onCloseCallback: (() => void) | null = null;

  /** Returns true if Browserless calls should proceed. */
  isAvailable(): boolean {
    if (this.state === "closed") return true;

    if (this.state === "open") {
      // Check if cooldown has elapsed → transition to half_open
      if (Date.now() - this.openedAt >= this.getCurrentCooldownMs()) {
        this.state = "half_open";
        this.halfOpenProbesAllowed = HALF_OPEN_PROBE_LIMIT;
        this.halfOpenProbesInFlight = 0;
        this.halfOpenSucceeded = false;
      } else {
        return false;
      }
    }

    // half_open: allow up to HALF_OPEN_PROBE_LIMIT probes
    if (this.halfOpenProbesAllowed <= 0) return false;
    this.halfOpenProbesAllowed--;
    this.halfOpenProbesInFlight++;
    return true;
  }

  /**
   * Cancel a half_open probe slot that was acquired by isAvailable() but
   * never used (e.g. the caller was denied by a usage-cap check).
   * Returns the slot to the pool so a real probe can use it later.
   */
  cancelProbe(): void {
    if (this.state !== "half_open") return;
    if (this.halfOpenProbesInFlight <= 0) return;
    this.halfOpenProbesInFlight--;
    this.halfOpenProbesAllowed = Math.min(this.halfOpenProbesAllowed + 1, HALF_OPEN_PROBE_LIMIT);
  }

  /** Record a successful Browserless call. Resets the circuit to CLOSED. */
  recordSuccess(): void {
    const wasOpen = this.state !== "closed";
    if (this.state === "half_open") {
      this.halfOpenSucceeded = true;
    }
    this.state = "closed";
    this.failures = [];
    this.openedAt = 0;
    this.consecutiveOpenCycles = 0;
    this.halfOpenProbesAllowed = 0;
    this.halfOpenProbesInFlight = 0;
    this.halfOpenSucceeded = false;
    if (wasOpen && this.onCloseCallback) {
      try { this.onCloseCallback(); } catch {}
    }
  }

  /** Record an infrastructure failure. May open the circuit. */
  recordInfraFailure(): void {
    const now = Date.now();

    if (this.state === "half_open") {
      this.halfOpenProbesInFlight--;
      // Only reopen if ALL probes have resolved and none succeeded
      if (this.halfOpenProbesInFlight <= 0 && !this.halfOpenSucceeded) {
        this.state = "open";
        this.openedAt = now;
        this.consecutiveOpenCycles++;
        this.halfOpenProbesAllowed = 0;
        this.halfOpenProbesInFlight = 0;
      }
      return;
    }

    // Prune failures outside the window
    this.failures = this.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
    this.failures.push(now);

    if (this.failures.length >= FAILURE_THRESHOLD) {
      this.state = "open";
      this.openedAt = now;
    }
  }

  /** Current cooldown duration, with exponential backoff on repeated failures. */
  getCurrentCooldownMs(): number {
    const backoff = BASE_COOLDOWN_MS * Math.pow(2, Math.min(this.consecutiveOpenCycles, 3));
    return Math.min(backoff, MAX_COOLDOWN_MS);
  }

  /** Register a callback invoked when the circuit transitions to CLOSED. */
  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  /** Current state for observability / logging. */
  getState(): CircuitState {
    // Re-evaluate in case cooldown elapsed since last check
    if (this.state === "open" && Date.now() - this.openedAt >= this.getCurrentCooldownMs()) {
      this.state = "half_open";
      this.halfOpenProbesAllowed = HALF_OPEN_PROBE_LIMIT;
      this.halfOpenProbesInFlight = 0;
      this.halfOpenSucceeded = false;
    }
    return this.state;
  }

  /** Reset to initial state (useful for tests). */
  reset(): void {
    this.state = "closed";
    this.failures = [];
    this.openedAt = 0;
    this.consecutiveOpenCycles = 0;
    this.halfOpenProbesAllowed = 0;
    this.halfOpenProbesInFlight = 0;
    this.halfOpenSucceeded = false;
    this.onCloseCallback = null;
  }
}

/** Singleton instance shared across the application. */
export const browserlessCircuitBreaker = new BrowserlessCircuitBreaker();
