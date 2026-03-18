import { BASE_URL, MSG } from "../shared/constants";
import { setToken } from "../auth/token";

// Listen for messages from popup and content scripts
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
    try {
      const parsed = new URL(senderUrl);
      const expectedOrigin = new URL(BASE_URL).origin;
      if (parsed.origin !== expectedOrigin || parsed.pathname !== "/extension-auth") {
        sendResponse({ ok: false, error: "unexpected origin" });
        return false;
      }
    } catch {
      sendResponse({ ok: false, error: "invalid sender URL" });
      return false;
    }
    handleTokenReceived(message.token, message.expiresAt, sender.tab?.id);
    sendResponse({ ok: true });
    return false;
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
