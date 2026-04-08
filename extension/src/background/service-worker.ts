import { BASE_URL, MSG } from "../shared/constants";
import { setToken } from "../auth/token";

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

const EXPECTED_AUTH_ORIGIN = new URL(BASE_URL).origin;

// ── Tab URL monitoring for auth fallback ────────────────────────
// Chrome 127+ treats host_permissions as optional, so the static
// content script (auth-relay.js) may never be injected. As a
// fallback the auth page navigates to
//   /extension-auth?done=1#token=<jwt>&expiresAt=<iso>
// and we pick up the token from the tab URL change.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  try {
    const fullUrl = tab.url || changeInfo.url;
    const url = new URL(fullUrl);

    if (url.origin !== EXPECTED_AUTH_ORIGIN) return;
    if (url.pathname !== "/extension-auth" || url.searchParams.get("done") !== "1") return;
    if (!url.hash || url.hash.length < 2) return;

    const hashParams = new URLSearchParams(url.hash.slice(1));
    const token = hashParams.get("token");
    const expiresAt = hashParams.get("expiresAt");

    if (!token || !expiresAt) return;

    handleTokenReceived(token, expiresAt, tabId).catch(console.error);
  } catch {
    // Ignore URL parsing errors
  }
});

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

  if (message.type === MSG.FTC_EXTENSION_TOKEN) {
    // Only accept tokens from the expected auth page
    const senderUrl = sender.tab?.url;
    if (!senderUrl) {
      sendResponse({ ok: false, error: "no sender tab" });
      return false;
    }
    if (!isValidAuthSender(senderUrl, BASE_URL)) {
      sendResponse({ ok: false, error: "unexpected origin" });
      return false;
    }
    // Return true to keep the message port open while we await the async storage
    handleTokenReceived(message.token, message.expiresAt, sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "storage failed" }));
    return true;
  }

  // Relay element selection and candidate results from content script to popup
  if (message.type === MSG.ELEMENT_SELECTED || message.type === MSG.CANDIDATES_RESULT) {
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup may not be open; ignore
    });
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
    console.error("[FTC] Failed to inject picker:", err);
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
    console.error("[FTC] Failed to remove picker:", err);
  }
}

async function handleTokenReceived(
  token: string,
  expiresAt: string,
  tabId?: number
): Promise<void> {
  await setToken(token, expiresAt);

  // Close the auth tab
  if (tabId) {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // Tab may already be closed
    }
  }

  // Notify open popups to refresh
  chrome.runtime.sendMessage({ type: "FTC_AUTH_COMPLETE" }).catch(() => {
    // Popup may not be open
  });
}
