import { describe, it, expect, vi } from "vitest";

// Mock chrome APIs and build-time constants before importing
vi.mock("../shared/constants", () => ({
  BASE_URL: "https://ftc.bd73.com",
  AUTH_STARTED_KEY: "ftc_auth_started_at",
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

// Stub chrome global
const chromeMock = {
  runtime: { onMessage: { addListener: vi.fn() }, sendMessage: vi.fn() },
  tabs: { get: vi.fn(), remove: vi.fn(), onUpdated: { addListener: vi.fn() } },
  scripting: { insertCSS: vi.fn(), executeScript: vi.fn() },
  storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
  permissions: { contains: vi.fn(), request: vi.fn() },
};
vi.stubGlobal("chrome", chromeMock);

const { isValidAuthSender, extractTokenFromUrl } = await import("./service-worker");

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
