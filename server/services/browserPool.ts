/**
 * Warm Browser Pool — reuses CDP connections across Browserless checks.
 *
 * Holds up to POOL_MAX idle browsers with a 5-minute expiry. Browsers are
 * validated via isConnected() on acquire and evicted if stale or disconnected.
 *
 * Note: context-level failures (crashed tab, wedged renderer) do NOT
 * invalidate a pooled browser — only full disconnects are detected. This is
 * acceptable at pool size 2 where the worst case is one wasted attempt before
 * the browser is replaced.
 */

/** Minimal interface for a pooled browser (subset of playwright-core Browser). */
export interface PoolableBrowser {
  isConnected(): boolean;
  newContext(options?: any): Promise<any>;
  close(): Promise<void>;
}

interface PoolEntry {
  browser: PoolableBrowser;
  lastUsed: number;
}

const POOL_MAX = 2;
const POOL_IDLE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export class BrowserPool {
  private entries: PoolEntry[] = [];
  private pendingAcquires = 0;
  /** Tracks which browsers were acquired as reusable (caller doesn't need to remember). */
  private reusableSet = new WeakSet<PoolableBrowser>();

  /**
   * Acquire a browser from the pool or create a new one via connectFn.
   * Call release(browser) when done — the pool decides internally whether
   * to reclaim or close it.
   */
  async acquire(connectFn: () => Promise<PoolableBrowser>): Promise<{ browser: PoolableBrowser; reusable: boolean }> {
    const now = Date.now();
    // Evict expired entries and close their CDP sessions
    const expired = this.entries.filter(e => now - e.lastUsed >= POOL_IDLE_EXPIRY_MS);
    this.entries = this.entries.filter(e => now - e.lastUsed < POOL_IDLE_EXPIRY_MS);
    for (const e of expired) {
      void Promise.resolve(e.browser.close()).catch(() => {});
    }

    // Find an idle connected browser
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      try {
        if (!entry.browser.isConnected()) {
          this.entries.splice(i, 1);
          void Promise.resolve(entry.browser.close()).catch(() => {});
          i--;
          continue;
        }
        this.entries.splice(i, 1); // remove from pool while in use
        this.reusableSet.add(entry.browser);
        return { browser: entry.browser, reusable: true };
      } catch {
        this.entries.splice(i, 1);
        void Promise.resolve(entry.browser.close()).catch(() => {});
        i--;
      }
    }

    // No idle browser — open a new one.
    // Track pending acquires so we can correctly decide reusability:
    // if many connects are in flight concurrently, we account for them
    // to avoid exceeding POOL_MAX on release.
    this.pendingAcquires++;
    try {
      const browser = await connectFn();
      const reusable = this.entries.length + this.pendingAcquires <= POOL_MAX;
      if (reusable) this.reusableSet.add(browser);
      return { browser, reusable };
    } finally {
      this.pendingAcquires--;
    }
  }

  /**
   * Return a browser to the pool, or close it if it was ephemeral or the pool is full.
   * Safe to call for any browser returned by acquire() — the pool tracks reusability
   * internally so callers don't need to thread the boolean through.
   */
  release(browser: PoolableBrowser, _reusable?: boolean): void {
    // Support both old (explicit boolean) and new (auto-tracked) call styles.
    const reusable = _reusable ?? this.reusableSet.has(browser);
    this.reusableSet.delete(browser);
    if (!reusable) return; // ephemeral — caller closes it
    if (this.entries.length < POOL_MAX) {
      this.entries.push({ browser, lastUsed: Date.now() });
    } else {
      // Pool full (concurrent acquires can cause this) — close to prevent leak
      void Promise.resolve(browser.close()).catch(() => {});
    }
  }

  /** Close and remove all pooled browsers. */
  async drain(): Promise<void> {
    const toClose = this.entries.splice(0);
    await Promise.allSettled(toClose.map(e => e.browser.close()));
  }
}

/** Singleton instance shared across the application. */
export const browserPool = new BrowserPool();
