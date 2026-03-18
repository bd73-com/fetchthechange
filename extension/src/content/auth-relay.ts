// This content script is injected into https://ftc.bd73.com/extension-auth
// It listens for postMessage from the page and relays the token to the service worker.

import { BASE_URL } from "../shared/constants";

const EXPECTED_ORIGIN = new URL(BASE_URL).origin;

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.origin !== EXPECTED_ORIGIN) return;
  if (event.data?.type !== "FTC_EXTENSION_TOKEN") return;

  const { token, expiresAt } = event.data;
  if (typeof token !== "string" || typeof expiresAt !== "string") return;

  chrome.runtime.sendMessage({
    type: "FTC_EXTENSION_TOKEN",
    token,
    expiresAt,
  });
});
