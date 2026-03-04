/**
 * Browserless Circuit Breaker
 *
 * Tracks Browserless infrastructure health at the system level to prevent
 * cascading failures when the service is down. When the circuit is OPEN,
 * Browserless calls are skipped entirely — saving ~30s timeout per check.
 *
 * State machine:
 *   CLOSED  → (3 infra failures within window) → OPEN
 *   OPEN    → (cooldown expires)               → HALF_OPEN
 *   HALF_OPEN → (success)                      → CLOSED
 *   HALF_OPEN → (failure)                      → OPEN
 */

export type CircuitState = "closed" | "open" | "half_open";

const FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export class BrowserlessCircuitBreaker {
  private state: CircuitState = "closed";
  private failures: number[] = []; // timestamps of recent infra failures
  private openedAt = 0;
  private halfOpenProbeConsumed = false;

  /** Returns true if Browserless calls should proceed. */
  isAvailable(): boolean {
    if (this.state === "closed") return true;

    if (this.state === "open") {
      // Check if cooldown has elapsed → transition to half_open
      if (Date.now() - this.openedAt >= COOLDOWN_MS) {
        this.state = "half_open";
        this.halfOpenProbeConsumed = false;
      } else {
        return false;
      }
    }

    // half_open: allow exactly one probe until success/failure is recorded
    if (this.halfOpenProbeConsumed) return false;
    this.halfOpenProbeConsumed = true;
    return true;
  }

  /** Record a successful Browserless call. Resets the circuit to CLOSED. */
  recordSuccess(): void {
    this.state = "closed";
    this.failures = [];
    this.openedAt = 0;
    this.halfOpenProbeConsumed = false;
  }

  /** Record an infrastructure failure. May open the circuit. */
  recordInfraFailure(): void {
    const now = Date.now();

    if (this.state === "half_open") {
      // Probe failed — re-open
      this.state = "open";
      this.openedAt = now;
      this.halfOpenProbeConsumed = false;
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

  /** Current state for observability / logging. */
  getState(): CircuitState {
    // Re-evaluate in case cooldown elapsed since last check
    if (this.state === "open" && Date.now() - this.openedAt >= COOLDOWN_MS) {
      this.state = "half_open";
      this.halfOpenProbeConsumed = false;
    }
    return this.state;
  }

  /** Reset to initial state (useful for tests). */
  reset(): void {
    this.state = "closed";
    this.failures = [];
    this.openedAt = 0;
    this.halfOpenProbeConsumed = false;
  }
}

/** Singleton instance shared across the application. */
export const browserlessCircuitBreaker = new BrowserlessCircuitBreaker();
