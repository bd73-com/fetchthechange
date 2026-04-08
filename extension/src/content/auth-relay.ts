// This content script is injected into https://ftc.bd73.com/extension-auth
// It listens for postMessage from the page and relays the token to the service worker.

import { BASE_URL } from "../shared/constants";

const TAG = "[FTC:auth-relay]";
const EXPECTED_ORIGIN = new URL(BASE_URL).origin;

console.log(TAG, "loaded on", window.location.href);

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.origin !== EXPECTED_ORIGIN) return;
  if (event.data?.type !== "FTC_EXTENSION_TOKEN") return;

  const { token, expiresAt } = event.data;
  if (typeof token !== "string" || typeof expiresAt !== "string") {
    console.warn(TAG, "received FTC_EXTENSION_TOKEN but payload is invalid");
    return;
  }

  console.log(TAG, "relaying token to service worker...");

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
