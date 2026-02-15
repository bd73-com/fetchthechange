import { describe, it, expect } from "vitest";
import { api, buildUrl } from "./routes";

describe("buildUrl", () => {
  it("replaces a single :param placeholder", () => {
    expect(buildUrl("/api/monitors/:id", { id: 42 })).toBe("/api/monitors/42");
  });

  it("replaces multiple :param placeholders", () => {
    expect(buildUrl("/api/:type/:id/detail", { type: "monitors", id: 5 })).toBe(
      "/api/monitors/5/detail"
    );
  });

  it("returns path unchanged when no params provided", () => {
    expect(buildUrl("/api/monitors")).toBe("/api/monitors");
  });

  it("returns path unchanged when params object is empty", () => {
    expect(buildUrl("/api/monitors/:id", {})).toBe("/api/monitors/:id");
  });

  it("converts number params to string", () => {
    expect(buildUrl("/api/monitors/:id", { id: 123 })).toBe("/api/monitors/123");
  });

  it("handles string param values", () => {
    expect(buildUrl("/api/monitors/:id", { id: "abc" })).toBe("/api/monitors/abc");
  });

  it("ignores params not present in the path", () => {
    expect(buildUrl("/api/monitors", { id: 42 })).toBe("/api/monitors");
  });

  it("replaces only matching params, leaves others", () => {
    expect(buildUrl("/api/:a/:b", { a: "x" })).toBe("/api/x/:b");
  });
});

describe("api route definitions", () => {
  it("defines monitors.list as GET /api/monitors", () => {
    expect(api.monitors.list.method).toBe("GET");
    expect(api.monitors.list.path).toBe("/api/monitors");
  });

  it("defines monitors.get as GET /api/monitors/:id", () => {
    expect(api.monitors.get.method).toBe("GET");
    expect(api.monitors.get.path).toBe("/api/monitors/:id");
  });

  it("defines monitors.create as POST /api/monitors", () => {
    expect(api.monitors.create.method).toBe("POST");
    expect(api.monitors.create.path).toBe("/api/monitors");
  });

  it("defines monitors.update as PATCH /api/monitors/:id", () => {
    expect(api.monitors.update.method).toBe("PATCH");
    expect(api.monitors.update.path).toBe("/api/monitors/:id");
  });

  it("defines monitors.delete as DELETE /api/monitors/:id", () => {
    expect(api.monitors.delete.method).toBe("DELETE");
    expect(api.monitors.delete.path).toBe("/api/monitors/:id");
  });

  it("defines monitors.history as GET /api/monitors/:id/history", () => {
    expect(api.monitors.history.method).toBe("GET");
    expect(api.monitors.history.path).toBe("/api/monitors/:id/history");
  });

  it("defines monitors.check as POST /api/monitors/:id/check", () => {
    expect(api.monitors.check.method).toBe("POST");
    expect(api.monitors.check.path).toBe("/api/monitors/:id/check");
  });

  describe("create input validation", () => {
    const schema = api.monitors.create.input;

    it("accepts valid monitor input", () => {
      const result = schema.safeParse({
        name: "My Monitor",
        url: "https://example.com",
        selector: ".price",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing name", () => {
      const result = schema.safeParse({
        url: "https://example.com",
        selector: ".price",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing url", () => {
      const result = schema.safeParse({
        name: "My Monitor",
        selector: ".price",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing selector", () => {
      const result = schema.safeParse({
        name: "My Monitor",
        url: "https://example.com",
      });
      expect(result.success).toBe(false);
    });

    it("accepts optional frequency", () => {
      const result = schema.safeParse({
        name: "My Monitor",
        url: "https://example.com",
        selector: ".price",
        frequency: "hourly",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.frequency).toBe("hourly");
      }
    });

    it("accepts optional active flag", () => {
      const result = schema.safeParse({
        name: "My Monitor",
        url: "https://example.com",
        selector: ".price",
        active: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.active).toBe(false);
      }
    });

    it("accepts optional emailEnabled flag", () => {
      const result = schema.safeParse({
        name: "My Monitor",
        url: "https://example.com",
        selector: ".price",
        emailEnabled: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.emailEnabled).toBe(false);
      }
    });
  });

  describe("update input validation (partial)", () => {
    const schema = api.monitors.update.input;

    it("accepts partial update with just name", () => {
      const result = schema.safeParse({ name: "Updated Name" });
      expect(result.success).toBe(true);
    });

    it("accepts partial update with just url", () => {
      const result = schema.safeParse({ url: "https://new-url.com" });
      expect(result.success).toBe(true);
    });

    it("accepts empty object (no fields changed)", () => {
      const result = schema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts multiple partial fields", () => {
      const result = schema.safeParse({
        name: "New Name",
        selector: "#new-selector",
        active: false,
      });
      expect(result.success).toBe(true);
    });
  });
});
