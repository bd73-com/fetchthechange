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

  /**
   * Acquire a browser from the pool or create a new one via connectFn.
   * @returns `reusable: true` means the caller should return it via release().
   *          `reusable: false` means the caller should close it directly.
   */
  async acquire(connectFn: () => Promise<PoolableBrowser>): Promise<{ browser: PoolableBrowser; reusable: boolean }> {
    const now = Date.now();
    // Evict expired entries
    this.entries = this.entries.filter(e => now - e.lastUsed < POOL_IDLE_EXPIRY_MS);

    // Find an idle connected browser
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      try {
        if (!entry.browser.isConnected()) {
          this.entries.splice(i, 1);
          i--;
          continue;
        }
        this.entries.splice(i, 1); // remove from pool while in use
        return { browser: entry.browser, reusable: true };
      } catch {
        this.entries.splice(i, 1);
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
      return { browser, reusable };
    } finally {
      this.pendingAcquires--;
    }
  }

  /**
   * Return a browser to the pool, or close it if the pool is full.
   * Only call this when `reusable` was true from acquire().
   */
  release(browser: PoolableBrowser, reusable: boolean): void {
    if (!reusable) return; // ephemeral — caller closes it
    if (this.entries.length < POOL_MAX) {
      this.entries.push({ browser, lastUsed: Date.now() });
    } else {
      // Pool full (concurrent acquires can cause this) — close to prevent leak
      Promise.resolve(browser.close()).catch(() => {});
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
