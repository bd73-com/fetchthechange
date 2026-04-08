import { BASE_URL, MSG, AUTH_STARTED_KEY } from "../shared/constants";
import { getToken, clearToken, isTokenValid } from "../auth/token";
import { escapeAttr, sanitizeTier } from "./utils";

const TAG = "[FTC:popup]";

// ──────────────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────────────

interface UserInfo {
  userId: string;
  tier: string;
  email: string;
}

interface Selection {
  selector: string;
  currentValue: string;
  url: string;
  pageTitle: string;
}

interface Candidate {
  selector: string;
  text: string;
  score: number;
}

type PopupState =
  | "unauthenticated"
  | "connecting"
  | "auth_failed"
  | "authenticated"
  | "picking"
  | "confirm"
  | "creating"
  | "success"
  | "error";

let state: PopupState = "unauthenticated";
let userInfo: UserInfo | null = null;
let selection: Selection | null = null;
let candidates: Candidate[] = [];
let currentTabUrl = "";
let currentTabTitle = "";
let currentTabId = 0;
let errorMessage = "";
let createdMonitorName = "";
let createdMonitorValue = "";
let dropdownOpen = false;

const content = document.getElementById("content")!;
const accountArea = document.getElementById("account-area")!;

// How long we consider an auth attempt "recent" — if no token was stored
// within this window, we show an error instead of the default connect screen.
// Must match the SW's fallback window (120 s in service-worker.ts onUpdated).
const AUTH_TIMEOUT_MS = 120_000;

// ──────────────────────────────────────────────────────────────────
// Initialise
// ──────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  console.log(TAG, "init start");

  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabUrl = tab.url || "";
    currentTabTitle = tab.title || "";
    currentTabId = tab.id || 0;
  }

  const valid = await isTokenValid();
  if (!valid) {
    console.log(TAG, "no valid token in storage");

    // Check if an auth attempt was recently started but failed
    const stored = await chrome.storage.local.get(AUTH_STARTED_KEY);
    const startedAt = Number(stored[AUTH_STARTED_KEY]);
    if (Number.isFinite(startedAt) && Date.now() - startedAt < AUTH_TIMEOUT_MS) {
      console.warn(TAG, "recent auth attempt found but no token — showing failure state");
      state = "auth_failed";
    } else {
      state = "unauthenticated";
    }

    render();
    return;
  }

  // Verify token with backend
  const token = await getToken();
  if (!token) {
    console.log(TAG, "getToken returned null despite isTokenValid");
    state = "unauthenticated";
    render();
    return;
  }

  console.log(TAG, "verifying token with backend...");
  try {
    const res = await fetch(`${BASE_URL}/api/extension/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.warn(TAG, "verify returned", res.status);
      await clearToken();
      state = "unauthenticated";
      render();
      return;
    }

    userInfo = await res.json().catch(() => null);
    if (!userInfo || typeof userInfo.userId !== "string" || typeof userInfo.tier !== "string") {
      console.warn(TAG, "verify response malformed:", userInfo);
      await clearToken();
      state = "unauthenticated";
      render();
      return;
    }
    // Cache userInfo for offline fallback
    await chrome.storage.local.set({ cachedUserInfo: userInfo });
    // Clear any stale auth-started flag
    await chrome.storage.local.remove(AUTH_STARTED_KEY);
    state = "authenticated";
    console.log(TAG, "authenticated as", userInfo.email);
  } catch (err) {
    console.warn(TAG, "verify network error:", err);
    // Network error — try to restore cached userInfo so tier/account display correctly
    const cached = await chrome.storage.local.get("cachedUserInfo");
    const c = cached.cachedUserInfo;
    if (c && typeof c.userId === "string" && typeof c.tier === "string" && typeof c.email === "string") {
      userInfo = c;
      state = "authenticated";
    } else {
      state = "unauthenticated";
    }
  }

  render();
}

// ──────────────────────────────────────────────────────────────────
// Listen for messages from background/content
// ──────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.ELEMENT_SELECTED) {
    selection = {
      selector: message.selector,
      currentValue: message.currentValue,
      url: message.url,
      pageTitle: message.pageTitle,
    };
    state = "confirm";
    render();
  }

  if (message.type === MSG.CANDIDATES_RESULT) {
    candidates = message.candidates || [];
    if (state === "authenticated" || state === "picking") {
      render();
    }
  }

  if (message.type === MSG.CANCEL_PICKER) {
    if (state === "picking") {
      state = "authenticated";
      render();
    }
  }

  if (message.type === "FTC_AUTH_COMPLETE") {
    // Re-initialise after auth
    init();
  }
});

// ──────────────────────────────────────────────────────────────────
// Render
// ──────────────────────────────────────────────────────────────────

function render(): void {
  renderAccount();

  switch (state) {
    case "unauthenticated":
      renderUnauth();
      break;
    case "connecting":
      renderConnecting();
      break;
    case "auth_failed":
      renderAuthFailed();
      break;
    case "authenticated":
      renderAuthenticated();
      break;
    case "picking":
      renderPicking();
      break;
    case "confirm":
      renderConfirm();
      break;
    case "creating":
      renderCreating();
      break;
    case "success":
      renderSuccess();
      break;
    case "error":
      renderError();
      break;
  }
}

function renderAccount(): void {
  if (!userInfo) {
    accountArea.innerHTML = "";
    return;
  }

  accountArea.innerHTML = `
    <button class="account-btn" id="account-toggle">
      ${escapeHtml(userInfo.email || "Connected")} &#9662;
    </button>
    <div class="account-dropdown ${dropdownOpen ? "" : "hidden"}" id="account-dropdown">
      <div class="dropdown-email">
        ${escapeHtml(userInfo.email || userInfo.userId)}
        <span class="tier-badge tier-${sanitizeTier(userInfo.tier)}">${escapeHtml(userInfo.tier)}</span>
      </div>
      <a class="dropdown-item" href="${BASE_URL}/dashboard" target="_blank">Open dashboard</a>
      <div class="dropdown-divider"></div>
      <button class="dropdown-item" id="disconnect-btn">Disconnect</button>
    </div>
  `;

  document.getElementById("account-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownOpen = !dropdownOpen;
    renderAccount();
  });

  document.getElementById("disconnect-btn")?.addEventListener("click", async () => {
    await clearToken();
    await chrome.storage.local.remove("cachedUserInfo");
    userInfo = null;
    dropdownOpen = false;
    state = "unauthenticated";
    render();
  });

  // Close dropdown on click outside
  document.addEventListener("click", () => {
    if (dropdownOpen) {
      dropdownOpen = false;
      renderAccount();
    }
  }, { once: true });
}

function renderUnauth(): void {
  content.innerHTML = `
    <div class="unauth">
      <h2>Track what matters on any webpage.</h2>
      <button class="btn btn-primary btn-full" id="connect-btn">Connect your account</button>
      <p>Already have an account? Sign in above.</p>
    </div>
  `;

  document.getElementById("connect-btn")?.addEventListener("click", startAuthFlow);
}

function renderAuthFailed(): void {
  content.innerHTML = `
    <div class="unauth">
      <h2>Connection failed</h2>
      <p>We couldn't connect the extension to your account. This can happen if your browser blocked the connection.</p>
      <button class="btn btn-primary btn-full" id="retry-connect-btn">Try again</button>
      <p style="margin-top: 12px; font-size: 12px; opacity: 0.7;">
        Tip: when Chrome asks to allow access to ftc.bd73.com, click <strong>Allow</strong>.
      </p>
    </div>
  `;

  document.getElementById("retry-connect-btn")?.addEventListener("click", startAuthFlow);
}

async function startAuthFlow(): Promise<void> {
  console.log(TAG, "starting auth flow");

  // Chrome 127+ treats host_permissions as optional.
  // Request the permission so the auth-relay content script gets injected.
  let permissionGranted = false;
  try {
    const origin = new URL(BASE_URL).origin;
    permissionGranted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
    console.log(TAG, "host permission already granted:", permissionGranted);
    if (!permissionGranted) {
      permissionGranted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      console.log(TAG, "host permission request result:", permissionGranted);
    }
  } catch (err) {
    console.warn(TAG, "permission request error:", err);
    // Fallback auth still works without the permission
  }

  // Record that we started an auth attempt so if the popup
  // re-opens without a token, we can show an error instead of
  // the generic "Connect your account" screen.
  await chrome.storage.local.set({ [AUTH_STARTED_KEY]: Date.now() });

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.create({ url: `${BASE_URL}/extension-auth` });
  } catch (err) {
    console.error(TAG, "failed to open auth tab:", err);
    state = "auth_failed";
    render();
    return;
  }
  console.log(TAG, "auth tab created:", tab.id);

  // Tell the service worker which tab to watch
  if (tab.id) {
    chrome.runtime.sendMessage({ type: MSG.AUTH_TAB_OPENED, tabId: tab.id }).catch((err) =>
      console.warn(TAG, "failed to notify service worker of auth tab:", err),
    );
  }

  state = "connecting";
  render();
}

function renderConnecting(): void {
  content.innerHTML = `
    <div class="connecting">
      <div class="spinner"></div>
      <p>Connecting...</p>
      <p>Waiting for you to sign in at FetchTheChange.</p>
      <button class="btn btn-secondary btn-sm" id="cancel-connect" style="margin-top: 16px;">Cancel</button>
    </div>
  `;

  document.getElementById("cancel-connect")?.addEventListener("click", async () => {
    await chrome.storage.local.remove(AUTH_STARTED_KEY);
    state = "unauthenticated";
    render();
  });
}

function renderAuthenticated(): void {
  const truncatedUrl = currentTabUrl.length > 45
    ? currentTabUrl.slice(0, 45) + "..."
    : currentTabUrl;

  let candidatesHtml = "";
  if (candidates.length > 0) {
    candidatesHtml = `
      <div class="section-header">Suggested elements</div>
      ${candidates
        .map(
          (c, i) => `
        <div class="candidate" data-idx="${i}">
          <span class="candidate-text">${escapeHtml(c.text)}</span>
          <span class="candidate-selector">${escapeHtml(c.selector)}</span>
          <button class="btn btn-primary btn-sm candidate-track" data-idx="${i}">Track this</button>
        </div>
      `
        )
        .join("")}
    `;
  }

  content.innerHTML = `
    <div class="current-url"><strong>Tracking:</strong> ${escapeHtml(truncatedUrl)}</div>
    ${candidatesHtml}
    <div class="section-header">Or pick manually</div>
    <button class="btn btn-primary btn-full" id="pick-btn">Pick an element on this page</button>
    <button class="advanced-toggle" id="advanced-toggle">&#9662; Advanced (CSS selector)</button>
    <div class="advanced-content" id="advanced-content">
      <div class="form-group">
        <input type="text" class="form-input" id="manual-selector" placeholder="e.g. .product-price">
      </div>
      <button class="btn btn-secondary btn-sm" id="manual-track-btn">Use this selector</button>
    </div>
  `;

  // Pick element button
  document.getElementById("pick-btn")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: MSG.START_PICKER, tabId: currentTabId });
    state = "picking";
    render();
  });

  // Candidate track buttons
  document.querySelectorAll(".candidate-track").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt((e.target as HTMLElement).dataset.idx || "0");
      const c = candidates[idx];
      if (c) {
        selection = {
          selector: c.selector,
          currentValue: c.text,
          url: currentTabUrl,
          pageTitle: currentTabTitle,
        };
        state = "confirm";
        render();
      }
    });
  });

  // Advanced toggle
  document.getElementById("advanced-toggle")?.addEventListener("click", () => {
    const el = document.getElementById("advanced-content");
    el?.classList.toggle("open");
  });

  // Manual selector
  document.getElementById("manual-track-btn")?.addEventListener("click", () => {
    const input = document.getElementById("manual-selector") as HTMLInputElement;
    const selector = input?.value.trim();
    if (selector) {
      selection = {
        selector,
        currentValue: "",
        url: currentTabUrl,
        pageTitle: "",
      };
      state = "confirm";
      render();
    }
  });
}

function renderPicking(): void {
  content.innerHTML = `
    <div class="picker-info">
      <div class="icon">&#127919;</div>
      <p><strong>Click any element on the page to track it.</strong></p>
      <p>Press Esc to cancel.</p>
      <button class="btn btn-secondary btn-sm" id="cancel-pick" style="margin-top: 16px;">Cancel picking</button>
    </div>
  `;

  document.getElementById("cancel-pick")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: MSG.CANCEL_PICKER, tabId: currentTabId });
    state = "authenticated";
    render();
  });
}

function renderConfirm(): void {
  if (!selection) return;

  const tier = userInfo?.tier || "free";
  const hourlyDisabled = tier === "free";
  const defaultName = (selection.pageTitle || "").slice(0, 100);

  content.innerHTML = `
    <div class="current-url"><strong>Tracking:</strong> ${escapeHtml(
      selection.url.length > 45 ? selection.url.slice(0, 45) + "..." : selection.url
    )}</div>
    <div class="confirm-card">
      <div class="label">Element selected</div>
      ${
        selection.currentValue
          ? `<div class="value">Currently: ${escapeHtml(selection.currentValue.slice(0, 100))}</div>`
          : ""
      }
      <div class="selector">${escapeHtml(selection.selector)}</div>
    </div>
    <div class="form-group">
      <label class="form-label">Monitor name</label>
      <input type="text" class="form-input" id="monitor-name" value="${escapeAttr(defaultName)}" maxlength="100">
    </div>
    <div class="form-group">
      <label class="form-label">Check frequency</label>
      <div class="radio-group">
        <label class="radio-label">
          <input type="radio" name="frequency" value="daily" checked> Daily
        </label>
        <label class="radio-label ${hourlyDisabled ? "disabled" : ""}">
          <input type="radio" name="frequency" value="hourly" ${hourlyDisabled ? "disabled" : ""}>
          Hourly
          ${hourlyDisabled ? '<span class="tooltip-text">(Pro+)</span>' : ""}
        </label>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="pick-again-btn">Pick again</button>
      <button class="btn btn-primary" id="create-btn">Create monitor</button>
    </div>
  `;

  document.getElementById("pick-again-btn")?.addEventListener("click", () => {
    selection = null;
    chrome.runtime.sendMessage({ type: MSG.START_PICKER, tabId: currentTabId });
    state = "picking";
    render();
  });

  document.getElementById("create-btn")?.addEventListener("click", createMonitor);
}

async function createMonitor(): Promise<void> {
  if (!selection || state === "creating") return;

  const nameInput = document.getElementById("monitor-name") as HTMLInputElement;
  const name = nameInput?.value.trim() || "Untitled monitor";
  const frequency =
    (document.querySelector('input[name="frequency"]:checked') as HTMLInputElement)?.value || "daily";

  state = "creating";
  createdMonitorName = name;
  createdMonitorValue = selection.currentValue;
  render();

  try {
    const token = await getToken();
    if (!token) {
      errorMessage = "Not authenticated. Please reconnect.";
      state = "error";
      render();
      return;
    }

    const res = await fetch(`${BASE_URL}/api/extension/monitors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        url: selection.url,
        selector: selection.selector,
        frequency,
      }),
    });

    if (res.ok) {
      state = "success";
      render();
      return;
    }

    const data = await res.json().catch(() => null);

    if (data?.code === "TIER_LIMIT_REACHED") {
      errorMessage = `${data.message || data.error || "Monitor limit reached."}`;
      state = "error";
      render();
      // Add upgrade link after render using DOM API
      const errContainer = content.querySelector(".error p");
      if (errContainer) {
        errContainer.appendChild(document.createElement("br"));
        const link = document.createElement("a");
        link.href = `${BASE_URL}/pricing`;
        link.target = "_blank";
        link.style.color = "#6366f1";
        link.textContent = "Upgrade your plan";
        errContainer.appendChild(link);
      }
      return;
    }

    errorMessage = data?.message || data?.error || `Failed (${res.status})`;
    state = "error";
    render();
  } catch {
    errorMessage = "Network error. Please try again.";
    state = "error";
    render();
  }
}

function renderCreating(): void {
  content.innerHTML = `
    <div class="connecting" style="padding-top: 64px;">
      <div class="spinner"></div>
      <p>Creating monitor...</p>
    </div>
  `;
}

function renderSuccess(): void {
  content.innerHTML = `
    <div class="success">
      <div class="icon">&#10003;</div>
      <h3>Monitor created!</h3>
      <p><strong>${escapeHtml(createdMonitorName)}</strong> is now being watched.</p>
      ${createdMonitorValue ? `<p>You'll be notified when <strong>${escapeHtml(createdMonitorValue.slice(0, 60))}</strong> changes.</p>` : ""}
      <div class="btn-row" style="margin-top: 24px; justify-content: center;">
        <a class="btn btn-primary btn-sm" href="${BASE_URL}/dashboard" target="_blank">View in dashboard</a>
        <button class="btn btn-secondary btn-sm" id="track-another-btn">Track another</button>
      </div>
    </div>
  `;

  document.getElementById("track-another-btn")?.addEventListener("click", () => {
    selection = null;
    candidates = [];
    state = "authenticated";
    render();
  });
}

function renderError(): void {
  content.innerHTML = `
    <div class="error">
      <div class="icon">&#10007;</div>
      <h3>Couldn't create monitor</h3>
      <p>${escapeHtml(errorMessage)}</p>
      <button class="btn btn-secondary" id="try-again-btn">Try again</button>
    </div>
  `;

  document.getElementById("try-again-btn")?.addEventListener("click", () => {
    state = selection ? "confirm" : "authenticated";
    render();
  });
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}


// ──────────────────────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────────────────────

init();
