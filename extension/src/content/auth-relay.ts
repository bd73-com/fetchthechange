// This content script is injected into https://ftc.bd73.com/extension-auth*
// It listens for postMessage from the page and relays the token to the service worker.

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== "FTC_EXTENSION_TOKEN") return;

  const { token, expiresAt } = event.data;
  if (typeof token !== "string" || typeof expiresAt !== "string") return;

  chrome.runtime.sendMessage({
    type: "FTC_EXTENSION_TOKEN",
    token,
    expiresAt,
  });
});
