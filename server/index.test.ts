import { describe, it, expect } from "vitest";

/**
 * Tests for the webhook error classification logic in server/index.ts.
 *
 * The error handler in the Stripe and Resend webhook routes classifies errors
 * as signature failures (401) vs processing errors (500) based on substring
 * matching on the error message. These tests verify the classification logic
 * directly to prevent regressions (see GitHub issues #214, #215).
 */

// SYNC WARNING: These functions mirror the inline error classification conditions
// in server/index.ts webhook catch blocks. If you change the conditions in
// server/index.ts, update these functions to match.

// Mirrors the classification condition in server/index.ts (Stripe webhook handler, line ~133)
function isStripeSignatureError(msg: string): boolean {
  return msg.includes('signature') || msg.includes('No signatures found') || msg.includes('timestamp');
}

// Mirrors the classification condition in server/index.ts (Resend webhook handler, line ~165)
function isResendSignatureError(msg: string): boolean {
  return msg.includes('signature') || msg.includes('timestamp') || msg.includes('No signatures found');
}

describe("Stripe webhook error classification", () => {
  it("classifies Stripe signature verification errors as signature errors", () => {
    expect(isStripeSignatureError("No signatures found matching the expected signature for payload")).toBe(true);
    expect(isStripeSignatureError("Invalid signature")).toBe(true);
    expect(isStripeSignatureError("Webhook signature verification failed")).toBe(true);
    expect(isStripeSignatureError("timestamp outside tolerance")).toBe(true);
  });

  it("does NOT classify processing errors containing 'webhook' as signature errors", () => {
    // Issue #215: 'webhook' was previously in the condition, causing misclassification
    expect(isStripeSignatureError("Failed to process webhook event in database")).toBe(false);
    expect(isStripeSignatureError("Stripe webhook secret is not configured")).toBe(false);
    expect(isStripeSignatureError("webhook handler threw an unexpected error")).toBe(false);
  });

  it("does NOT classify generic processing errors as signature errors", () => {
    expect(isStripeSignatureError("Database connection failed")).toBe(false);
    expect(isStripeSignatureError("User not found")).toBe(false);
    expect(isStripeSignatureError("")).toBe(false);
  });
});

describe("Resend webhook error classification", () => {
  it("classifies Resend signature verification errors as signature errors", () => {
    expect(isResendSignatureError("Invalid signature")).toBe(true);
    expect(isResendSignatureError("No signatures found")).toBe(true);
    expect(isResendSignatureError("timestamp outside tolerance")).toBe(true);
  });

  it("does NOT classify processing errors containing 'webhook' as signature errors", () => {
    expect(isResendSignatureError("Failed to process webhook event")).toBe(false);
    expect(isResendSignatureError("Resend webhook secret missing")).toBe(false);
  });

  it("does NOT classify generic processing errors as signature errors", () => {
    expect(isResendSignatureError("Database error")).toBe(false);
    expect(isResendSignatureError("")).toBe(false);
  });
});

describe("REPLIT_DOMAINS guard", () => {
  it("optional chaining on undefined returns undefined", () => {
    // Mirrors the guard logic: process.env.REPLIT_DOMAINS?.split(',')[0]
    const domains: string | undefined = undefined;
    const result = domains?.split(',')[0];
    expect(result).toBeUndefined();
  });

  it("extracts first domain when REPLIT_DOMAINS is set", () => {
    const domains = "example.repl.co,other.repl.co";
    const result = domains?.split(',')[0];
    expect(result).toBe("example.repl.co");
  });

  it("handles single domain value", () => {
    const domains = "example.repl.co";
    const result = domains?.split(',')[0];
    expect(result).toBe("example.repl.co");
  });

  it("empty string is falsy (would skip webhook creation)", () => {
    const domains = "";
    const result = domains?.split(',')[0];
    expect(!result).toBe(true);
  });
});
