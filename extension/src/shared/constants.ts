// BASE_URL is injected at build time via esbuild define.
// Set BASE_URL env var to override (default: https://ftc.bd73.com)
declare const BASE_URL_INJECTED: string;
export const BASE_URL = BASE_URL_INJECTED;
export const TOKEN_STORAGE_KEY = "ftc_extension_token";
export const TOKEN_EXPIRY_KEY = "ftc_extension_token_expiry";
export const AUTH_STARTED_KEY = "ftc_auth_started_at";
export const AUTH_TAB_ID_KEY = "ftc_auth_tab_id";
export const PENDING_SELECTION_KEY = "ftc_pending_selection";

export const MSG = {
  START_PICKER: "FTC_START_PICKER",
  CANCEL_PICKER: "FTC_CANCEL_PICKER",
  ELEMENT_SELECTED: "FTC_ELEMENT_SELECTED",
  GET_CANDIDATES: "FTC_GET_CANDIDATES",
  CANDIDATES_RESULT: "FTC_CANDIDATES_RESULT",
  FTC_EXTENSION_TOKEN: "FTC_EXTENSION_TOKEN",
  AUTH_TAB_OPENED: "FTC_AUTH_TAB_OPENED",
} as const;
