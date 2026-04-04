import { describe, it, expect } from "vitest";
import {
  zapierSubscribeSchema,
  zapierUnsubscribeSchema,
  zapierChangesQuerySchema,
} from "./routes";

describe("zapierSubscribeSchema", () => {
  it("accepts valid hookUrl with no monitorId", () => {
    const result = zapierSubscribeSchema.safeParse({
      hookUrl: "https://hooks.zapier.com/abc123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hookUrl).toBe("https://hooks.zapier.com/abc123");
      expect(result.data.monitorId).toBeUndefined();
    }
  });

  it("accepts valid hookUrl with monitorId", () => {
    const result = zapierSubscribeSchema.safeParse({
      hookUrl: "https://hooks.zapier.com/abc",
      monitorId: 42,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.monitorId).toBe(42);
    }
  });

  it("rejects invalid URL", () => {
    const result = zapierSubscribeSchema.safeParse({ hookUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects missing hookUrl", () => {
    const result = zapierSubscribeSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects non-positive monitorId", () => {
    const result = zapierSubscribeSchema.safeParse({
      hookUrl: "https://hooks.zapier.com/abc",
      monitorId: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer monitorId", () => {
    const result = zapierSubscribeSchema.safeParse({
      hookUrl: "https://hooks.zapier.com/abc",
      monitorId: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("zapierUnsubscribeSchema", () => {
  it("accepts valid id", () => {
    const result = zapierUnsubscribeSchema.safeParse({ id: 1 });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const result = zapierUnsubscribeSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects non-positive id", () => {
    const result = zapierUnsubscribeSchema.safeParse({ id: -1 });
    expect(result.success).toBe(false);
  });
});

describe("zapierChangesQuerySchema", () => {
  it("applies default limit of 3", () => {
    const result = zapierChangesQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(3);
      expect(result.data.monitorId).toBeUndefined();
    }
  });

  it("coerces string monitorId from query params", () => {
    const result = zapierChangesQuerySchema.safeParse({ monitorId: "42" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.monitorId).toBe(42);
    }
  });

  it("coerces string limit from query params", () => {
    const result = zapierChangesQuerySchema.safeParse({ limit: "5" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(5);
    }
  });

  it("rejects limit above 10", () => {
    const result = zapierChangesQuerySchema.safeParse({ limit: "11" });
    expect(result.success).toBe(false);
  });

  it("rejects limit below 1", () => {
    const result = zapierChangesQuerySchema.safeParse({ limit: "0" });
    expect(result.success).toBe(false);
  });
});
