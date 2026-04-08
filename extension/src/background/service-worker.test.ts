import { describe, it, expect, vi } from "vitest";

// Mock chrome APIs and build-time constants before importing
vi.mock("../shared/constants", () => ({
  BASE_URL: "https://ftc.bd73.com",
  MSG: {
    START_PICKER: "FTC_START_PICKER",
    CANCEL_PICKER: "FTC_CANCEL_PICKER",
    ELEMENT_SELECTED: "FTC_ELEMENT_SELECTED",
    GET_CANDIDATES: "FTC_GET_CANDIDATES",
    CANDIDATES_RESULT: "FTC_CANDIDATES_RESULT",
    FTC_EXTENSION_TOKEN: "FTC_EXTENSION_TOKEN",
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

const { isValidAuthSender } = await import("./service-worker");

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
