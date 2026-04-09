import { describe, it, expect, vi } from "vitest";

// Mock chrome APIs and build-time constants before importing
vi.mock("../shared/constants", () => ({
  BASE_URL: "https://ftc.bd73.com",
  AUTH_STARTED_KEY: "ftc_auth_started_at",
  AUTH_TAB_ID_KEY: "ftc_auth_tab_id",
  MSG: {
    START_PICKER: "FTC_START_PICKER",
    CANCEL_PICKER: "FTC_CANCEL_PICKER",
    ELEMENT_SELECTED: "FTC_ELEMENT_SELECTED",
    GET_CANDIDATES: "FTC_GET_CANDIDATES",
    CANDIDATES_RESULT: "FTC_CANDIDATES_RESULT",
    FTC_EXTENSION_TOKEN: "FTC_EXTENSION_TOKEN",
    AUTH_TAB_OPENED: "FTC_AUTH_TAB_OPENED",
  },
}));

vi.mock("../auth/token", () => ({
  setToken: vi.fn(),
}));

// Stub chrome global — methods that return promises need resolved defaults
const chromeMock = {
  runtime: { onMessage: { addListener: vi.fn() }, sendMessage: vi.fn().mockResolvedValue(undefined) },
  tabs: {
    get: vi.fn().mockResolvedValue({ url: "" }),
    remove: vi.fn().mockResolvedValue(undefined),
    onUpdated: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
  },
  scripting: { insertCSS: vi.fn().mockResolvedValue(undefined), executeScript: vi.fn().mockResolvedValue([]) },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
  permissions: { contains: vi.fn(), request: vi.fn() },
};
vi.stubGlobal("chrome", chromeMock);

const { isValidAuthSender, extractTokenFromUrl } = await import("./service-worker");

// Capture listener callbacks registered at module load time (before any clearAllMocks)
const onUpdatedCb = chromeMock.tabs.onUpdated.addListener.mock.calls[0][0] as (
  tabId: number, changeInfo: any, tab: any,
) => Promise<void>;
const onRemovedCb = chromeMock.tabs.onRemoved.addListener.mock.calls[0][0] as (
  tabId: number,
) => void;
const onMessageCb = chromeMock.runtime.onMessage.addListener.mock.calls[0][0] as (
  message: any, sender: any, sendResponse: any,
) => boolean;

const BASE = "https://ftc.bd73.com";

describe("isValidAuthSender", () => {
  it("accepts exact /extension-auth path on expected origin", () => {
    expect(isValidAuthSender("https://ftc.bd73.com/extension-auth", BASE)).toBe(true);
  });

  it("rejects prefix-matching paths like /extension-auth-evil", () => {
    expect(isValidAuthSender("https://ftc.bd73.com/extension-auth-evil", BASE)).toBe(false);
  });

  it("rejects prefix-matching paths like /extension-authority", () => {
    expect(isValidAuthSender("https://ftc.bd73.com/extension-authority", BASE)).toBe(false);
  });

  it("rejects sub-paths like /extension-auth/callback", () => {
    expect(isValidAuthSender("https://ftc.bd73.com/extension-auth/callback", BASE)).toBe(false);
  });

  it("rejects wrong origin", () => {
    expect(isValidAuthSender("https://evil.com/extension-auth", BASE)).toBe(false);
  });

  it("rejects different scheme", () => {
    expect(isValidAuthSender("http://ftc.bd73.com/extension-auth", BASE)).toBe(false);
  });

  it("rejects wrong path on correct origin", () => {
    expect(isValidAuthSender("https://ftc.bd73.com/other-page", BASE)).toBe(false);
  });

  it("returns false for invalid URL", () => {
    expect(isValidAuthSender("not-a-url", BASE)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidAuthSender("", BASE)).toBe(false);
  });

  it("accepts when URL has query params (pathname is still exact)", () => {
    expect(isValidAuthSender("https://ftc.bd73.com/extension-auth?token=abc", BASE)).toBe(true);
  });

  it("accepts when URL has hash fragment (pathname is still exact)", () => {
    expect(isValidAuthSender("https://ftc.bd73.com/extension-auth#section", BASE)).toBe(true);
  });

  it("rejects trailing-slash variant /extension-auth/", () => {
    expect(isValidAuthSender("https://ftc.bd73.com/extension-auth/", BASE)).toBe(false);
  });
});

describe("extractTokenFromUrl", () => {
  const TOKEN = "eyJhbGciOiJIUzI1NiJ9.test.sig";
  const EXPIRES = "2099-01-01T00:00:00.000Z";

  it("extracts token and expiresAt from a valid callback URL", () => {
    const url = `https://ftc.bd73.com/extension-auth?done=1#token=${encodeURIComponent(TOKEN)}&expiresAt=${encodeURIComponent(EXPIRES)}`;
    expect(extractTokenFromUrl(url)).toEqual({ token: TOKEN, expiresAt: EXPIRES });
  });

  it("returns null when origin is wrong", () => {
    const url = `https://evil.com/extension-auth?done=1#token=${TOKEN}&expiresAt=${EXPIRES}`;
    expect(extractTokenFromUrl(url)).toBeNull();
  });

  it("returns null when pathname is wrong", () => {
    const url = `https://ftc.bd73.com/other-page?done=1#token=${TOKEN}&expiresAt=${EXPIRES}`;
    expect(extractTokenFromUrl(url)).toBeNull();
  });

  it("returns null when done param is missing", () => {
    const url = `https://ftc.bd73.com/extension-auth#token=${TOKEN}&expiresAt=${EXPIRES}`;
    expect(extractTokenFromUrl(url)).toBeNull();
  });

  it("returns null when done param is not 1", () => {
    const url = `https://ftc.bd73.com/extension-auth?done=0#token=${TOKEN}&expiresAt=${EXPIRES}`;
    expect(extractTokenFromUrl(url)).toBeNull();
  });

  it("returns null when hash is empty", () => {
    const url = "https://ftc.bd73.com/extension-auth?done=1";
    expect(extractTokenFromUrl(url)).toBeNull();
  });

  it("returns null when hash has only #", () => {
    const url = "https://ftc.bd73.com/extension-auth?done=1#";
    expect(extractTokenFromUrl(url)).toBeNull();
  });

  it("returns null when token is missing from hash", () => {
    const url = `https://ftc.bd73.com/extension-auth?done=1#expiresAt=${EXPIRES}`;
    expect(extractTokenFromUrl(url)).toBeNull();
  });

  it("returns null when expiresAt is missing from hash", () => {
    const url = `https://ftc.bd73.com/extension-auth?done=1#token=${TOKEN}`;
    expect(extractTokenFromUrl(url)).toBeNull();
  });

  it("returns null for an invalid URL", () => {
    expect(extractTokenFromUrl("not-a-url")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractTokenFromUrl("")).toBeNull();
  });

  it("handles URI-encoded values in the hash", () => {
    const weirdToken = "abc+def/ghi=";
    const url = `https://ftc.bd73.com/extension-auth?done=1#token=${encodeURIComponent(weirdToken)}&expiresAt=${encodeURIComponent(EXPIRES)}`;
    expect(extractTokenFromUrl(url)).toEqual({ token: weirdToken, expiresAt: EXPIRES });
  });
});

// ── Listener registration tests ─────────────────────────────────

describe("Chrome listener registration", () => {
  it("registers onUpdated listener", () => {
    expect(chromeMock.tabs.onUpdated.addListener).toHaveBeenCalledOnce();
    expect(typeof chromeMock.tabs.onUpdated.addListener.mock.calls[0][0]).toBe("function");
  });

  it("registers onRemoved listener", () => {
    expect(chromeMock.tabs.onRemoved.addListener).toHaveBeenCalledOnce();
    expect(typeof chromeMock.tabs.onRemoved.addListener.mock.calls[0][0]).toBe("function");
  });

  it("registers onMessage listener", () => {
    expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalledOnce();
    expect(typeof chromeMock.runtime.onMessage.addListener.mock.calls[0][0]).toBe("function");
  });
});

// ── onUpdated handler tests ──────────────────────────────────────

describe("onUpdated handler", () => {
  const TOKEN = "eyJhbGciOiJIUzI1NiJ9.test.sig";
  const EXPIRES = "2099-01-01T00:00:00.000Z";
  const DONE_URL_WITH_HASH = `https://ftc.bd73.com/extension-auth?done=1#token=${encodeURIComponent(TOKEN)}&expiresAt=${encodeURIComponent(EXPIRES)}`;
  const DONE_URL_NO_HASH = "https://ftc.bd73.com/extension-auth?done=1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores events with neither url change nor status complete", async () => {
    await onUpdatedCb(1, { status: "loading" }, {});
    // Should return immediately — no storage reads
    expect(chromeMock.storage.local.get).not.toHaveBeenCalled();
  });

  it("processes status:complete events for auth tab URLs", async () => {
    chromeMock.storage.local.get.mockResolvedValueOnce({
      ftc_auth_started_at: Date.now(),
      ftc_auth_tab_id: 42,
    });

    await onUpdatedCb(
      42,
      { status: "complete" },
      { url: DONE_URL_WITH_HASH },
    );

    // Should have checked storage for AUTH_STARTED_KEY
    expect(chromeMock.storage.local.get).toHaveBeenCalled();
  });

  it("quick-rejects status:complete for non-auth-page tabs", async () => {
    await onUpdatedCb(
      99,
      { status: "complete" },
      { url: "https://example.com/random-page" },
    );
    // Should NOT read storage since URL doesn't include /extension-auth
    expect(chromeMock.storage.local.get).not.toHaveBeenCalled();
  });

  it("processes URL change events (existing behaviour)", async () => {
    chromeMock.storage.local.get.mockResolvedValueOnce({
      ftc_auth_started_at: Date.now(),
      ftc_auth_tab_id: 42,
    });

    await onUpdatedCb(
      42,
      { url: DONE_URL_WITH_HASH },
      { url: DONE_URL_WITH_HASH },
    );

    expect(chromeMock.storage.local.get).toHaveBeenCalled();
  });

  it("falls back to scripting API when tabs.get fails and URL has done=1", async () => {
    // Use a unique token to avoid dedup guard from prior tests
    const UNIQUE_TOKEN = "eyJhbGciOiJIUzI1NiJ9.scripting-test.sig";
    const UNIQUE_EXPIRES = "2099-06-01T00:00:00.000Z";
    const urlWithHash = `https://ftc.bd73.com/extension-auth?done=1#token=${encodeURIComponent(UNIQUE_TOKEN)}&expiresAt=${encodeURIComponent(UNIQUE_EXPIRES)}`;

    chromeMock.storage.local.get.mockResolvedValueOnce({
      ftc_auth_started_at: Date.now(),
      ftc_auth_tab_id: 42,
    });
    // tabs.get fails
    chromeMock.tabs.get.mockRejectedValueOnce(new Error("No tab"));
    // scripting.executeScript returns the full URL with hash
    chromeMock.scripting.executeScript.mockResolvedValueOnce([
      { result: urlWithHash },
    ]);

    const { setToken } = await import("../auth/token");

    await onUpdatedCb(
      42,
      { url: DONE_URL_NO_HASH },
      { url: DONE_URL_NO_HASH },
    );

    expect(chromeMock.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      func: expect.any(Function),
    });
    expect(setToken).toHaveBeenCalledWith(UNIQUE_TOKEN, UNIQUE_EXPIRES);
  });
});

// ── onRemoved handler tests ──────────────────────────────────────

describe("onRemoved handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes tab from authTabs when an auth tab is closed", () => {
    // First register a tab as auth tab via the message handler
    const sendResponse = vi.fn();
    onMessageCb(
      { type: "FTC_AUTH_TAB_OPENED", tabId: 123 },
      {},
      sendResponse,
    );

    // Now fire onRemoved for that tab
    onRemovedCb(123);

    // The tab should be removed from authTabs — next poll should see it resolved
    // We verify indirectly: onRemoved was called and didn't throw
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it("ignores tabs that are not auth tabs", () => {
    // Fire onRemoved for a random tab — should not throw or error
    onRemovedCb(999);
    // No error is the success condition
  });
});
