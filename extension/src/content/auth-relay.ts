// This content script is injected into https://ftc.bd73.com/extension-auth
// It listens for postMessage from the page and relays the token to the
// service worker AND writes directly to chrome.storage.local as a fallback.

import { BASE_URL, TOKEN_STORAGE_KEY, TOKEN_EXPIRY_KEY, AUTH_STARTED_KEY } from "../shared/constants";

const TAG = "[FTC:auth-relay]";
const EXPECTED_ORIGIN = new URL(BASE_URL).origin;

console.log(TAG, "loaded on", window.location.href.split("#")[0]);

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.origin !== EXPECTED_ORIGIN) return;
  if (event.data?.type !== "FTC_EXTENSION_TOKEN") return;

  const { token, expiresAt } = event.data;
  if (typeof token !== "string" || typeof expiresAt !== "string") {
    console.warn(TAG, "received FTC_EXTENSION_TOKEN but payload is invalid");
    return;
  }

  // Basic JWT structure check
  if (token.split(".").length !== 3) {
    console.warn(TAG, "token doesn't look like a JWT, ignoring");
    return;
  }

  console.log(TAG, "token received, storing directly + relaying to SW...");

  // Primary path: write directly to chrome.storage.local.
  // This works even if the service worker is terminated.
  chrome.storage.local.set({
    [TOKEN_STORAGE_KEY]: token,
    [TOKEN_EXPIRY_KEY]: expiresAt,
  }, () => {
    if (chrome.runtime.lastError) {
      console.error(TAG, "direct storage write failed:", chrome.runtime.lastError.message);
    } else {
      console.log(TAG, "token stored directly in chrome.storage.local");
      // Clear the auth-started flag so popup knows it succeeded
      chrome.storage.local.remove(AUTH_STARTED_KEY);
    }
  });

  // Secondary path: relay to service worker for tab cleanup + popup notification.
  chrome.runtime.sendMessage(
    { type: "FTC_EXTENSION_TOKEN", token, expiresAt },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error(TAG, "sendMessage failed:", chrome.runtime.lastError.message);
        return;
      }
      if (response?.ok) {
        console.log(TAG, "service worker acknowledged token");
      } else {
        console.warn(TAG, "service worker rejected token:", response?.error);
      }
    },
  );
});
