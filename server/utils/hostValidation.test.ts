import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateHost } from "./hostValidation";

describe("validateHost", () => {
  const originalDomains = process.env.REPLIT_DOMAINS;

  afterEach(() => {
    if (originalDomains === undefined) {
      delete process.env.REPLIT_DOMAINS;
    } else {
      process.env.REPLIT_DOMAINS = originalDomains;
    }
  });

  it("returns null when host is undefined", () => {
    expect(validateHost(undefined)).toBeNull();
  });

  it("returns null when host is empty string", () => {
    expect(validateHost("")).toBeNull();
  });

  it("accepts any host when REPLIT_DOMAINS is not set", () => {
    delete process.env.REPLIT_DOMAINS;
    expect(validateHost("anything.example.com")).toBe("anything.example.com");
  });

  it("accepts any host when REPLIT_DOMAINS is empty", () => {
    process.env.REPLIT_DOMAINS = "";
    expect(validateHost("anything.example.com")).toBe("anything.example.com");
  });

  it("accepts host that is in REPLIT_DOMAINS", () => {
    process.env.REPLIT_DOMAINS = "app.example.com,other.example.com";
    expect(validateHost("app.example.com")).toBe("app.example.com");
  });

  it("rejects host that is not in REPLIT_DOMAINS", () => {
    process.env.REPLIT_DOMAINS = "app.example.com";
    expect(validateHost("evil.attacker.com")).toBeNull();
  });

  it("trims whitespace from REPLIT_DOMAINS entries", () => {
    process.env.REPLIT_DOMAINS = " app.example.com , other.example.com ";
    expect(validateHost("app.example.com")).toBe("app.example.com");
    expect(validateHost("other.example.com")).toBe("other.example.com");
  });
});
