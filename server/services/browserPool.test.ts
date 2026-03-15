import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserPool, type PoolableBrowser } from "./browserPool";

function makeBrowser(connected = true): PoolableBrowser {
  return {
    isConnected: vi.fn().mockReturnValue(connected),
    newContext: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("BrowserPool", () => {
  let pool: BrowserPool;

  beforeEach(() => {
    pool = new BrowserPool();
  });

  describe("drain", () => {
    it("closes pooled browsers", async () => {
      const browser = makeBrowser();
      const connectFn = vi.fn().mockResolvedValue(browser);
      const { browser: acquired } = await pool.acquire(connectFn);
      pool.release(acquired);

      await pool.drain();

      expect(browser.close).toHaveBeenCalledOnce();
    });

    it("closes in-use (checked-out) browsers", async () => {
      const browser = makeBrowser();
      const connectFn = vi.fn().mockResolvedValue(browser);
      await pool.acquire(connectFn);
      // Do NOT call release — browser is still checked out

      await pool.drain();

      expect(browser.close).toHaveBeenCalledOnce();
    });

    it("closes both pooled and in-use browsers simultaneously", async () => {
      const browser1 = makeBrowser();
      const browser2 = makeBrowser();
      const browser3 = makeBrowser();

      // Acquire 3 browsers (POOL_MAX=2, so third is ephemeral)
      await pool.acquire(vi.fn().mockResolvedValue(browser1));
      await pool.acquire(vi.fn().mockResolvedValue(browser2));
      const { browser: b3 } = await pool.acquire(vi.fn().mockResolvedValue(browser3));

      // Release browser3 back to pool (slot available since pool entries is 0)
      pool.release(b3);

      // Now browser1 + browser2 are in-use, browser3 is pooled
      await pool.drain();

      expect(browser1.close).toHaveBeenCalledOnce();
      expect(browser2.close).toHaveBeenCalledOnce();
      expect(browser3.close).toHaveBeenCalledOnce();
    });

    it("does not double-close a browser that was released before drain", async () => {
      const browser = makeBrowser();
      const connectFn = vi.fn().mockResolvedValue(browser);
      const { browser: acquired } = await pool.acquire(connectFn);
      pool.release(acquired);

      await pool.drain();

      // Should have been closed exactly once (from pool, not from inUse)
      expect(browser.close).toHaveBeenCalledOnce();
    });

    it("handles close() rejections gracefully", async () => {
      const browser = makeBrowser();
      (browser.close as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("close failed"));
      const connectFn = vi.fn().mockResolvedValue(browser);
      await pool.acquire(connectFn);

      // Should not throw
      await expect(pool.drain()).resolves.toBeUndefined();
    });
  });

  describe("draining guard", () => {
    it("rejects acquire() while drain is in progress", async () => {
      const browser = makeBrowser();
      // Make close() block so drain stays in progress
      let resolveClose: () => void;
      (browser.close as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise<void>((r) => { resolveClose = r; })
      );
      const connectFn = vi.fn().mockResolvedValue(browser);
      await pool.acquire(connectFn);

      const drainPromise = pool.drain();

      // While drain is in progress, acquire should throw
      const connectFn2 = vi.fn().mockResolvedValue(makeBrowser());
      await expect(pool.acquire(connectFn2)).rejects.toThrow("draining");
      expect(connectFn2).not.toHaveBeenCalled();

      resolveClose!();
      await drainPromise;
    });

    it("allows acquire() after drain completes", async () => {
      await pool.drain();

      const browser = makeBrowser();
      const connectFn = vi.fn().mockResolvedValue(browser);
      const result = await pool.acquire(connectFn);
      expect(result.browser).toBe(browser);
    });

    it("closes browser from slow connectFn that resolves after drain starts", async () => {
      // Simulate a connectFn that is in-flight when drain() begins
      const slowBrowser = makeBrowser();
      let resolveConnect: (b: PoolableBrowser) => void;
      const slowConnectFn = vi.fn().mockReturnValue(
        new Promise<PoolableBrowser>((r) => { resolveConnect = r; })
      );

      const acquirePromise = pool.acquire(slowConnectFn);

      // Start drain while connectFn is still pending
      const drainPromise = pool.drain();

      // Now resolve the slow connect — pool should close the browser and reject
      resolveConnect!(slowBrowser);
      await expect(acquirePromise).rejects.toThrow("draining");
      expect(slowBrowser.close).toHaveBeenCalledOnce();

      await drainPromise;
    });
  });

  describe("inUse tracking", () => {
    it("tracks acquired browser as in-use", async () => {
      const browser = makeBrowser();
      const connectFn = vi.fn().mockResolvedValue(browser);
      await pool.acquire(connectFn);

      // Drain should close the in-use browser
      await pool.drain();
      expect(browser.close).toHaveBeenCalled();
    });

    it("removes browser from in-use set on release", async () => {
      const browser = makeBrowser();
      const connectFn = vi.fn().mockResolvedValue(browser);
      const { browser: acquired } = await pool.acquire(connectFn);
      pool.release(acquired);

      // After release, drain should close it from the pool (not in-use)
      // Close count should be 1, not 2
      await pool.drain();
      expect(browser.close).toHaveBeenCalledOnce();
    });
  });
});
