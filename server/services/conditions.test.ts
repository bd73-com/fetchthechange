import { describe, it, expect } from "vitest";
import { evaluateConditions, extractNumber, isSafeRegex } from "./conditions";
import type { MonitorCondition } from "@shared/schema";

function makeCondition(overrides: Partial<MonitorCondition> = {}): MonitorCondition {
  return {
    id: 1,
    monitorId: 1,
    type: "numeric_lt",
    value: "100",
    groupIndex: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("extractNumber", () => {
  it("extracts a simple integer", () => {
    expect(extractNumber("150")).toBe(150);
  });

  it("extracts a decimal", () => {
    expect(extractNumber("$12.99")).toBe(12.99);
  });

  it("strips commas", () => {
    expect(extractNumber("$1,299.99")).toBe(1299.99);
  });

  it("handles negative numbers", () => {
    expect(extractNumber("-5.5%")).toBe(-5.5);
  });

  it("returns null for no number", () => {
    expect(extractNumber("Out of stock")).toBeNull();
  });

  it("returns null for null", () => {
    expect(extractNumber(null)).toBeNull();
  });
});

describe("evaluateConditions", () => {
  it("returns true when conditions array is empty", () => {
    expect(evaluateConditions([], "old", "new")).toBe(true);
  });

  // numeric_lt
  it("numeric_lt: returns true when extracted number < threshold", () => {
    const c = makeCondition({ type: "numeric_lt", value: "200" });
    expect(evaluateConditions([c], null, "$150")).toBe(true);
  });

  it("numeric_lt: returns false when extracted number >= threshold", () => {
    const c = makeCondition({ type: "numeric_lt", value: "100" });
    expect(evaluateConditions([c], null, "$150")).toBe(false);
  });

  it("numeric_lt: returns false when value contains no number", () => {
    const c = makeCondition({ type: "numeric_lt", value: "100" });
    expect(evaluateConditions([c], null, "Out of stock")).toBe(false);
  });

  it("numeric_lt: strips currency symbols and commas before extracting", () => {
    const c = makeCondition({ type: "numeric_lt", value: "2000" });
    expect(evaluateConditions([c], null, "$1,299.99")).toBe(true);
  });

  // numeric_lte
  it("numeric_lte: returns true for equal value", () => {
    const c = makeCondition({ type: "numeric_lte", value: "150" });
    expect(evaluateConditions([c], null, "150")).toBe(true);
  });

  // numeric_gt
  it("numeric_gt: returns true when number > threshold", () => {
    const c = makeCondition({ type: "numeric_gt", value: "100" });
    expect(evaluateConditions([c], null, "$150")).toBe(true);
  });

  // numeric_gte
  it("numeric_gte: returns true for equal value", () => {
    const c = makeCondition({ type: "numeric_gte", value: "150" });
    expect(evaluateConditions([c], null, "150")).toBe(true);
  });

  // numeric_change_pct
  it("numeric_change_pct: returns true when abs change exceeds threshold", () => {
    const c = makeCondition({ type: "numeric_change_pct", value: "10" });
    expect(evaluateConditions([c], "$100", "$120")).toBe(true);
  });

  it("numeric_change_pct: returns false when oldValue is null", () => {
    const c = makeCondition({ type: "numeric_change_pct", value: "10" });
    expect(evaluateConditions([c], null, "$120")).toBe(false);
  });

  it("numeric_change_pct: returns false when oldValue extracts to 0", () => {
    const c = makeCondition({ type: "numeric_change_pct", value: "10" });
    expect(evaluateConditions([c], "$0", "$120")).toBe(false);
  });

  // text_contains
  it("text_contains: case-insensitive match returns true", () => {
    const c = makeCondition({ type: "text_contains", value: "in stock" });
    expect(evaluateConditions([c], null, "Currently In Stock")).toBe(true);
  });

  // text_not_contains
  it("text_not_contains: returns false when text is present", () => {
    const c = makeCondition({ type: "text_not_contains", value: "sold out" });
    expect(evaluateConditions([c], null, "Sold Out")).toBe(false);
  });

  it("text_not_contains: returns true when text is absent", () => {
    const c = makeCondition({ type: "text_not_contains", value: "sold out" });
    expect(evaluateConditions([c], null, "In Stock")).toBe(true);
  });

  // text_equals
  it("text_equals: returns true for exact match (trimmed, lowercased)", () => {
    const c = makeCondition({ type: "text_equals", value: "In Stock" });
    expect(evaluateConditions([c], null, "  in stock  ")).toBe(true);
  });

  // regex
  it("regex: returns true when pattern matches", () => {
    const c = makeCondition({ type: "regex", value: "\\bIn Stock\\b" });
    expect(evaluateConditions([c], null, "Item In Stock now")).toBe(true);
  });

  it("regex: returns false on invalid regex (does not throw)", () => {
    const c = makeCondition({ type: "regex", value: "[invalid" });
    expect(evaluateConditions([c], null, "test")).toBe(false);
  });

  // AND logic
  it("AND logic: both conditions in group 0 must pass", () => {
    const c1 = makeCondition({ id: 1, type: "numeric_gt", value: "50", groupIndex: 0 });
    const c2 = makeCondition({ id: 2, type: "numeric_lt", value: "200", groupIndex: 0 });
    expect(evaluateConditions([c1, c2], null, "$100")).toBe(true);
  });

  it("AND logic: returns false if one condition in group fails", () => {
    const c1 = makeCondition({ id: 1, type: "numeric_gt", value: "50", groupIndex: 0 });
    const c2 = makeCondition({ id: 2, type: "numeric_lt", value: "80", groupIndex: 0 });
    expect(evaluateConditions([c1, c2], null, "$100")).toBe(false);
  });

  // OR logic
  it("OR logic: returns true if group 1 passes even when group 0 fails", () => {
    const c1 = makeCondition({ id: 1, type: "numeric_lt", value: "50", groupIndex: 0 });
    const c2 = makeCondition({ id: 2, type: "text_contains", value: "sale", groupIndex: 1 });
    expect(evaluateConditions([c1, c2], null, "Big Sale $100")).toBe(true);
  });

  // null newValue
  it("newValue null: all conditions return false (no notification)", () => {
    const c = makeCondition({ type: "numeric_lt", value: "200" });
    expect(evaluateConditions([c], null, null)).toBe(false);
  });

  it("newValue null: text_contains returns false", () => {
    const c = makeCondition({ type: "text_contains", value: "test" });
    expect(evaluateConditions([c], null, null)).toBe(false);
  });

  // ReDoS protection
  it("regex: returns false for catastrophic backtracking patterns", () => {
    const c = makeCondition({ type: "regex", value: "(a+)+" });
    expect(evaluateConditions([c], null, "aaaaaaaaaaaa")).toBe(false);
  });
});

describe("isSafeRegex", () => {
  it("accepts simple patterns", () => {
    expect(isSafeRegex("\\bIn Stock\\b")).toBe(true);
  });

  it("accepts normal quantifiers", () => {
    expect(isSafeRegex("\\d+\\.\\d+")).toBe(true);
  });

  it("rejects nested quantifiers (a+)+", () => {
    expect(isSafeRegex("(a+)+")).toBe(false);
  });

  it("rejects nested quantifiers (a*)*", () => {
    expect(isSafeRegex("(a*)*")).toBe(false);
  });

  it("rejects invalid regex", () => {
    expect(isSafeRegex("[invalid")).toBe(false);
  });

  it("accepts simple group with quantifier", () => {
    expect(isSafeRegex("(abc)+")).toBe(true);
  });

  it("rejects alternation group with quantifier (a|a)+", () => {
    expect(isSafeRegex("(a|a)+")).toBe(false);
  });

  it("rejects alternation group with star (cat|dog)*", () => {
    expect(isSafeRegex("(cat|dog)*")).toBe(false);
  });

  it("accepts alternation without quantifier (a|b)", () => {
    expect(isSafeRegex("(a|b)")).toBe(true);
  });

  it("rejects (\\w+)+", () => {
    expect(isSafeRegex("(\\w+)+")).toBe(false);
  });

  it("rejects ([a-zA-Z]+)*", () => {
    expect(isSafeRegex("([a-zA-Z]+)*")).toBe(false);
  });
});
