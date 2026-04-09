import { BASE_URL, MSG, AUTH_STARTED_KEY, AUTH_TAB_ID_KEY, PENDING_SELECTION_KEY } from "../shared/constants";
import { setToken } from "../auth/token";

const TAG = "[FTC:SW]";

/**
 * Validates that a sender URL matches the expected auth page origin and path.
 * Returns true only for the exact /extension-auth path on the expected origin.
 */
export function isValidAuthSender(senderUrl: string, baseUrl: string): boolean {
  try {
    const parsed = new URL(senderUrl);
    const expectedOrigin = new URL(baseUrl).origin;
    return parsed.origin === expectedOrigin && parsed.pathname === "/extension-auth";
  } catch {
    return false;
  }
}

/**
 * Extract token + expiresAt from a URL hash fragment.
 * Expected format: #token=<jwt>&expiresAt=<iso>
 */
export function extractTokenFromUrl(url: string): { token: string; expiresAt: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== EXPECTED_AUTH_ORIGIN) return null;
    if (parsed.pathname !== "/extension-auth") return null;
    if (parsed.searchParams.get("done") !== "1") return null;
    if (!parsed.hash || parsed.hash.length < 2) return null;

    const hashParams = new URLSearchParams(parsed.hash.slice(1));
    const token = hashParams.get("token");
    const expiresAt = hashParams.get("expiresAt");

    if (!token || !expiresAt) return null;
    return { token, expiresAt };
  } catch {
    return null;
  }
}

const EXPECTED_AUTH_ORIGIN = new URL(BASE_URL).origin;

// ── Auth tab tracking ───────────────────────────────────────────
// Set of tab IDs we're watching for auth completion.
// Cleared when token is received or tab is closed.
const authTabs = new Set<number>();

// ── Tab URL monitoring for auth fallback ────────────────────────
// Chrome 127+ treats host_permissions as optional, so the static
// content script (auth-relay.js) may never be injected. As a
// fallback the auth page navigates to
//   /extension-auth?done=1#token=<jwt>&expiresAt=<iso>
// and we pick up the token from the tab URL change.
//
// Chrome fires onUpdated separately for URL changes and status changes:
//   1. {url: "...?done=1"} — URL without hash (Chrome strips # from changeInfo.url)
//   2. {status: "complete"} — page loaded; tab.url now includes the hash fragment
// We must handle BOTH events to reliably extract the token.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const urlChanged = !!changeInfo.url;
  const pageComplete = changeInfo.status === "complete";
  if (!urlChanged && !pageComplete) return;

  // Only accept tokens from tabs we opened for auth — prevents token
  // fixation via attacker-crafted links in other tabs.
  // Fast path: in-memory Set (works when service worker hasn't restarted).
  // Slow path: check AUTH_STARTED_KEY in storage (survives SW termination;
  // Chrome MV3 aggressively kills SWs after ~30 s of inactivity).
  if (!authTabs.has(tabId)) {
    // Quick-reject: skip storage reads for tabs whose URL doesn't look
    // like the auth page.  Applies to both URL-change and status-complete
    // events so we avoid waking the SW for every navigation in the browser.
    const tabUrl = tab.url || changeInfo.url || "";
    if (!tabUrl.includes("/extension-auth")) return;

    const stored = await chrome.storage.local.get([AUTH_STARTED_KEY, AUTH_TAB_ID_KEY]);
    const startedAt = Number(stored[AUTH_STARTED_KEY]);
    if (!Number.isFinite(startedAt) || Date.now() - startedAt > 120_000) return;
    // Verify this is the specific tab we opened for auth, not an
    // attacker-crafted link in another tab (token fixation prevention).
    const storedTabId = Number(stored[AUTH_TAB_ID_KEY]);
    if (Number.isFinite(storedTabId) && storedTabId !== tabId) return;
    console.log(TAG, "onUpdated: tab not in authTabs (SW restarted?), but recent auth attempt found");
  }

  const fullUrl = tab.url || changeInfo.url || "";

  // First try the URL we already have
  let result = extractTokenFromUrl(fullUrl);

  // Hash fragments can be absent from changeInfo.url in some Chrome
  // versions.  If the URL matches the done pattern but has no hash,
  // re-read the tab to get the full URL including the fragment.
  if (!result && fullUrl.includes("/extension-auth") && fullUrl.includes("done=1")) {
    try {
      const freshTab = await chrome.tabs.get(tabId);
      if (freshTab.url) {
        console.log(TAG, "onUpdated: re-read tab URL:", freshTab.url.split("#")[0]);
        result = extractTokenFromUrl(freshTab.url);
      }
    } catch {
      // Tab may have been closed; try scripting fallback
    }

    // Last resort: if tabs.get didn't return the hash, try reading it
    // via scripting API (requires host permission to be granted).
    if (!result) {
      try {
        const frames = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.location.href,
        });
        const pageUrl = frames?.[0]?.result;
        if (typeof pageUrl === "string") {
          console.log(TAG, "onUpdated: scripting fallback URL:", pageUrl.split("#")[0]);
          result = extractTokenFromUrl(pageUrl);
        }
      } catch {
        // No host permission — scripting not available
      }
    }
  }

  if (!result) return;

  console.log(TAG, "onUpdated: token found in tab URL, storing...");
  authTabs.delete(tabId);
  handleTokenReceived(result.token, result.expiresAt, tabId).catch((err) => {
    console.error(TAG, "onUpdated: handleTokenReceived failed:", err);
    chrome.storage.local.remove(AUTH_STARTED_KEY).catch(() => {});
  });
});

// ── Tab closure tracking ────────────────────────────────────────
// Use onRemoved for accurate tab-closed detection instead of relying
// on chrome.tabs.get() errors (which can be transient in MV3).
const closedTabs = new Set<number>();
chrome.tabs.onRemoved.addListener((tabId) => {
  if (authTabs.has(tabId)) {
    console.log(TAG, `onRemoved: auth tab ${tabId} closed without token`);
    authTabs.delete(tabId);
    closedTabs.add(tabId);
    // Clean up auth flags so the popup doesn't show a false
    // "Connection failed" screen when the user simply closed the tab.
    chrome.storage.local.remove([AUTH_STARTED_KEY, AUTH_TAB_ID_KEY]).catch(() => {});
    // Clean up after 60 s to avoid memory leaks
    setTimeout(() => closedTabs.delete(tabId), 60_000);
  }
});

// ── Polling fallback ────────────────────────────────────────────
// If chrome.tabs.onUpdated doesn't fire (e.g. hash-only change),
// we poll the auth tab URL every 2 s for up to 2 min.
async function pollAuthTab(tabId: number): Promise<void> {
  console.log(TAG, `poll: starting for tab ${tabId}`);
  let consecutiveErrors = 0;

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    // Already handled by onUpdated or content script?
    if (!authTabs.has(tabId)) {
      console.log(TAG, `poll: tab ${tabId} already resolved, stopping`);
      return;
    }

    // Tab confirmed closed by onRemoved?
    if (closedTabs.has(tabId)) {
      console.log(TAG, `poll: tab ${tabId} confirmed closed, stopping`);
      return;
    }

    try {
      const tab = await chrome.tabs.get(tabId);
      consecutiveErrors = 0; // reset on success
      if (!tab.url) continue;

      const result = extractTokenFromUrl(tab.url);
      if (result) {
        console.log(TAG, `poll: token found in tab ${tabId} URL on attempt ${i + 1}`);
        authTabs.delete(tabId);
        await handleTokenReceived(result.token, result.expiresAt, tabId);
        return;
      }
    } catch (err) {
      consecutiveErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(TAG, `poll: tabs.get(${tabId}) error #${consecutiveErrors}: ${msg}`);
      // Only give up after 3 consecutive errors — transient failures
      // are common in MV3 when the SW just woke up.
      if (consecutiveErrors >= 3) {
        console.log(TAG, `poll: tab ${tabId} unreachable after ${consecutiveErrors} errors, stopping`);
        authTabs.delete(tabId);
        return;
      }
    }
  }

  console.warn(TAG, `poll: timed out for tab ${tabId} after 2 min`);
  authTabs.delete(tabId);
}

// ── Message listener ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.START_PICKER) {
    injectPicker(message.tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === MSG.CANCEL_PICKER) {
    removePicker(message.tabId);
    sendResponse({ ok: true });
    return false;
  }

  // Popup tells us which tab to watch for auth completion
  if (message.type === MSG.AUTH_TAB_OPENED) {
    const tabId = message.tabId as number;
    console.log(TAG, `auth tab opened: ${tabId}`);
    authTabs.add(tabId);
    // Persist tab ID so the onUpdated fallback can verify the correct
    // tab after a SW restart (prevents token fixation via other tabs).
    chrome.storage.local.set({ [AUTH_TAB_ID_KEY]: tabId }).catch(() => {});
    pollAuthTab(tabId).catch((err) =>
      console.error(TAG, "pollAuthTab error:", err),
    );
    sendResponse({ ok: true });
    return false;
  }

  // Content script relayed token via postMessage → auth-relay → here
  if (message.type === MSG.FTC_EXTENSION_TOKEN) {
    const senderUrl = sender.tab?.url;
    console.log(TAG, "token received via content script relay, sender:", senderUrl?.slice(0, 80));

    if (!senderUrl) {
      console.warn(TAG, "rejected: no sender tab URL");
      sendResponse({ ok: false, error: "no sender tab" });
      return false;
    }
    if (!isValidAuthSender(senderUrl, BASE_URL)) {
      console.warn(TAG, "rejected: unexpected origin/path");
      sendResponse({ ok: false, error: "unexpected origin" });
      return false;
    }

    // Mark this tab as handled so the poller stops
    if (sender.tab?.id) authTabs.delete(sender.tab.id);

    // Return true to keep the message port open while we await async storage
    handleTokenReceived(message.token, message.expiresAt, sender.tab?.id)
      .then(() => {
        console.log(TAG, "token stored successfully (content script path)");
        sendResponse({ ok: true });
      })
      .catch((err) => {
        console.error(TAG, "handleTokenReceived failed:", err);
        chrome.storage.local.remove(AUTH_STARTED_KEY).catch(() => {});
        sendResponse({ ok: false, error: "storage failed" });
      });
    return true;
  }

  // Relay candidate results from content script to popup (popup is still open)
  if (message.type === MSG.CANDIDATES_RESULT) {
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup may not be open; ignore
    });
    return false;
  }

  // Element selected — popup is likely closed (Chrome closes it on page click).
  // Persist to storage so the popup can pick it up when it reopens.
  if (message.type === MSG.ELEMENT_SELECTED) {
    const payload = {
      selector: message.selector,
      currentValue: message.currentValue,
      url: message.url,
      pageTitle: message.pageTitle,
    };
    chrome.storage.local.set({ [PENDING_SELECTION_KEY]: payload }).then(() => {
      console.log(TAG, "selection stored, attempting to reopen popup");
      // Best-effort: reopen the popup so the user sees the confirm screen.
      // chrome.action.openPopup() throws in non-interactive contexts and on Chrome < 127.
      try {
        chrome.action.openPopup().catch(() => {});
      } catch {
        // Not available — the user can click the extension icon manually
      }
    }).catch((err) => {
      console.error(TAG, "failed to store pending selection:", err);
    });
    // Fast path: forward to popup in case it's still open (rare)
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  return false;
});

async function injectPicker(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
      return;
    }

    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["picker.css"],
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["picker.js"],
    });
  } catch (err) {
    console.error(TAG, "Failed to inject picker:", err);
  }
}

async function removePicker(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const event = new CustomEvent("ftc-cancel-picker");
        document.dispatchEvent(event);
      },
    });
  } catch (err) {
    console.error(TAG, "Failed to remove picker:", err);
  }
}

// Guard against duplicate calls from overlapping delivery layers
let lastStoredToken = "";

async function handleTokenReceived(
  token: string,
  expiresAt: string,
  tabId?: number,
): Promise<void> {
  // Dedup: skip if we already stored this exact token
  if (token === lastStoredToken) {
    console.log(TAG, "duplicate token, skipping storage");
    // Still close the tab if it's open
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
    return;
  }

  // Basic JWT structure check (3 dot-separated parts)
  if (token.split(".").length !== 3) {
    console.warn(TAG, "rejected: token doesn't look like a JWT");
    await chrome.storage.local.remove(AUTH_STARTED_KEY);
    return;
  }

  console.log(TAG, "storing token, expiresAt:", expiresAt);
  lastStoredToken = token;
  await setToken(token, expiresAt);
  // Clear the auth-started flags so the popup knows it succeeded
  await chrome.storage.local.remove([AUTH_STARTED_KEY, AUTH_TAB_ID_KEY]);
  console.log(TAG, "token stored OK");

  // Close the auth tab
  if (tabId) {
    try {
      await chrome.tabs.remove(tabId);
      console.log(TAG, `auth tab ${tabId} closed`);
    } catch {
      // Tab may already be closed
    }
  }

  // Notify open popups to refresh
  chrome.runtime.sendMessage({ type: "FTC_AUTH_COMPLETE" }).catch(() => {
    // Popup may not be open
  });
}
