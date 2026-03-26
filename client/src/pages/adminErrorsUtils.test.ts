import { describe, it, expect } from "vitest";
import { buildBatchDeletePayload } from "./adminErrorsUtils";

const defaults = {
  selectAll: false,
  selectedIds: new Set<number>(),
  excludedIds: new Set<number>(),
  levelFilter: "all",
  sourceFilter: "all",
  logs: [{ id: 1 }, { id: 2 }, { id: 3 }],
};

describe("buildBatchDeletePayload", () => {
  // --- individual selection (selectAll = false) ---

  it("returns ids when individual entries are selected", () => {
    const result = buildBatchDeletePayload({
      ...defaults,
      selectedIds: new Set([1, 3]),
    });
    expect(result).toEqual({ ids: [1, 3] });
  });

  it("returns null when no individual entries are selected", () => {
    const result = buildBatchDeletePayload(defaults);
    expect(result).toBeNull();
  });

  // --- selectAll with filters ---

  it("returns filter-based payload when level filter is active", () => {
    const result = buildBatchDeletePayload({
      ...defaults,
      selectAll: true,
      levelFilter: "error",
    });
    expect(result).toEqual({ filters: { level: "error" } });
  });

  it("returns filter-based payload when source filter is active", () => {
    const result = buildBatchDeletePayload({
      ...defaults,
      selectAll: true,
      sourceFilter: "scheduler",
    });
    expect(result).toEqual({ filters: { source: "scheduler" } });
  });

  it("returns filter-based payload with both filters", () => {
    const result = buildBatchDeletePayload({
      ...defaults,
      selectAll: true,
      levelFilter: "warning",
      sourceFilter: "api",
    });
    expect(result).toEqual({ filters: { level: "warning", source: "api" } });
  });

  it("includes excludeIds when filters are active and entries are excluded", () => {
    const result = buildBatchDeletePayload({
      ...defaults,
      selectAll: true,
      levelFilter: "error",
      excludedIds: new Set([2]),
    });
    expect(result).toEqual({ filters: { level: "error" }, excludeIds: [2] });
  });

  it("omits excludeIds when the set is empty", () => {
    const result = buildBatchDeletePayload({
      ...defaults,
      selectAll: true,
      levelFilter: "error",
      excludedIds: new Set(),
    });
    expect(result).toEqual({ filters: { level: "error" } });
    expect(result).not.toHaveProperty("excludeIds");
  });

  // --- selectAll without filters (the bug fix) ---

  it("falls back to visible log ids when no filters are active", () => {
    const result = buildBatchDeletePayload({
      ...defaults,
      selectAll: true,
    });
    expect(result).toEqual({ ids: [1, 2, 3] });
  });

  it("excludes entries from the ids fallback when excludedIds is set", () => {
    const result = buildBatchDeletePayload({
      ...defaults,
      selectAll: true,
      excludedIds: new Set([2]),
    });
    expect(result).toEqual({ ids: [1, 3] });
  });

  it("returns null when selectAll is true but all entries are excluded", () => {
    const result = buildBatchDeletePayload({
      ...defaults,
      selectAll: true,
      excludedIds: new Set([1, 2, 3]),
    });
    expect(result).toBeNull();
  });

  it("returns null when selectAll is true with no filters and logs are empty", () => {
    const result = buildBatchDeletePayload({
      ...defaults,
      selectAll: true,
      logs: [],
    });
    expect(result).toBeNull();
  });
});
