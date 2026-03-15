import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Resend constructor before importing the module under test
vi.mock("resend", () => {
  class MockResend {
    _apiKey: string;
    emails = { send: vi.fn() };
    constructor(apiKey: string) {
      this._apiKey = apiKey;
    }
  }
  return { Resend: MockResend };
});

describe("getResendClient", () => {
  beforeEach(() => {
    // Reset module registry so the singleton is fresh each test
    vi.resetModules();
    delete process.env.RESEND_API_KEY;
  });

  it("returns null when RESEND_API_KEY is not set", async () => {
    const { getResendClient } = await import("./resendClient");
    expect(getResendClient()).toBeNull();
  });

  it("returns null when RESEND_API_KEY is empty string", async () => {
    process.env.RESEND_API_KEY = "";
    const { getResendClient } = await import("./resendClient");
    expect(getResendClient()).toBeNull();
  });

  it("returns a Resend instance when RESEND_API_KEY is set", async () => {
    process.env.RESEND_API_KEY = "re_test_123";
    const { getResendClient } = await import("./resendClient");
    const client = getResendClient();
    expect(client).not.toBeNull();
    expect(client).toHaveProperty("emails");
  });

  it("returns the same instance on repeated calls (singleton)", async () => {
    process.env.RESEND_API_KEY = "re_test_123";
    const { getResendClient } = await import("./resendClient");
    const first = getResendClient();
    const second = getResendClient();
    const third = getResendClient();
    expect(first).toBe(second);
    expect(second).toBe(third);
  });
});
