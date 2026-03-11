import { describe, it, expect, afterEach } from "vitest";
import { createCorsOriginChecker, SENSITIVE_LOG_PATHS } from "./cors";

function callChecker(
  checker: ReturnType<typeof createCorsOriginChecker>,
  origin: string | undefined
): Promise<{ err: Error | null; allow?: boolean }> {
  return new Promise((resolve) => {
    checker(origin, (err, allow) => resolve({ err, allow }));
  });
}

describe("createCorsOriginChecker", () => {
  const allowedOrigins = ["https://myapp.example.com", "https://alt.example.com"];

  afterEach(() => {
    delete process.env.CHROME_EXTENSION_ID;
  });

  describe("basic origin matching", () => {
    it("allows requests with no origin (same-origin / server-to-server)", async () => {
      const checker = createCorsOriginChecker(allowedOrigins, false);
      const result = await callChecker(checker, undefined);
      expect(result.err).toBeNull();
      expect(result.allow).toBe(true);
    });

    it("allows a listed origin", async () => {
      const checker = createCorsOriginChecker(allowedOrigins, false);
      const result = await callChecker(checker, "https://myapp.example.com");
      expect(result.err).toBeNull();
      expect(result.allow).toBe(true);
    });

    it("rejects an unlisted origin in production", async () => {
      const checker = createCorsOriginChecker(allowedOrigins, false);
      const result = await callChecker(checker, "https://evil.com");
      expect(result.err).toBeInstanceOf(Error);
      expect(result.err!.message).toBe("Not allowed by CORS");
    });
  });

  describe("chrome extension restriction", () => {
    it("rejects any chrome-extension origin when CHROME_EXTENSION_ID is not set", async () => {
      delete process.env.CHROME_EXTENSION_ID;
      const checker = createCorsOriginChecker(allowedOrigins, false);
      const result = await callChecker(checker, "chrome-extension://abcdef1234567890");
      expect(result.err).toBeInstanceOf(Error);
    });

    it("allows the exact configured chrome-extension origin", async () => {
      process.env.CHROME_EXTENSION_ID = "abcdef1234567890";
      const checker = createCorsOriginChecker(allowedOrigins, false);
      const result = await callChecker(checker, "chrome-extension://abcdef1234567890");
      expect(result.err).toBeNull();
      expect(result.allow).toBe(true);
    });

    it("rejects a different chrome-extension ID even when env var is set", async () => {
      process.env.CHROME_EXTENSION_ID = "abcdef1234567890";
      const checker = createCorsOriginChecker(allowedOrigins, false);
      const result = await callChecker(checker, "chrome-extension://differentextensionid");
      expect(result.err).toBeInstanceOf(Error);
    });

    it("rejects chrome-extension with empty CHROME_EXTENSION_ID", async () => {
      process.env.CHROME_EXTENSION_ID = "";
      const checker = createCorsOriginChecker(allowedOrigins, false);
      const result = await callChecker(checker, "chrome-extension://anything");
      expect(result.err).toBeInstanceOf(Error);
    });

    it("trims whitespace from CHROME_EXTENSION_ID", async () => {
      process.env.CHROME_EXTENSION_ID = "  abcdef1234567890  ";
      const checker = createCorsOriginChecker(allowedOrigins, false);
      const result = await callChecker(checker, "chrome-extension://abcdef1234567890");
      expect(result.err).toBeNull();
      expect(result.allow).toBe(true);
    });
  });

  describe("dev mode localhost", () => {
    it("allows localhost in dev mode", async () => {
      const checker = createCorsOriginChecker(allowedOrigins, true);
      const result = await callChecker(checker, "http://localhost:5173");
      expect(result.err).toBeNull();
      expect(result.allow).toBe(true);
    });

    it("allows 127.0.0.1 in dev mode", async () => {
      const checker = createCorsOriginChecker(allowedOrigins, true);
      const result = await callChecker(checker, "http://127.0.0.1:3000");
      expect(result.err).toBeNull();
      expect(result.allow).toBe(true);
    });

    it("rejects localhost in production mode", async () => {
      const checker = createCorsOriginChecker(allowedOrigins, false);
      const result = await callChecker(checker, "http://localhost:5173");
      expect(result.err).toBeInstanceOf(Error);
    });

    it("allows IPv6 localhost [::1] in dev mode", async () => {
      const checker = createCorsOriginChecker(allowedOrigins, true);
      const result = await callChecker(checker, "http://[::1]:5173");
      expect(result.err).toBeNull();
      expect(result.allow).toBe(true);
    });

    it("rejects https localhost in dev mode (only http allowed)", async () => {
      const checker = createCorsOriginChecker(allowedOrigins, true);
      const result = await callChecker(checker, "https://localhost:5173");
      expect(result.err).toBeInstanceOf(Error);
    });
  });
});

describe("SENSITIVE_LOG_PATHS", () => {
  it("includes /api/keys for API key response redaction", () => {
    expect(SENSITIVE_LOG_PATHS).toContain("/api/keys");
  });

  it("includes all expected sensitive paths", () => {
    expect(SENSITIVE_LOG_PATHS).toContain("/api/stripe/");
    expect(SENSITIVE_LOG_PATHS).toContain("/api/admin/");
    expect(SENSITIVE_LOG_PATHS).toContain("/api/callback");
    expect(SENSITIVE_LOG_PATHS).toContain("/api/login");
    expect(SENSITIVE_LOG_PATHS).toContain("/api/keys");
  });
});
