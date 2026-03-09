import type { MonitorCondition } from "@shared/schema";

/** Maximum length of newValue to test against regex (ReDoS mitigation). */
const REGEX_INPUT_MAX_LENGTH = 10_000;

/**
 * Reject regex patterns with nested quantifiers that can cause catastrophic backtracking.
 * E.g. (a+)+ or (a*)*  or (a{1,}){1,}
 */
const CATASTROPHIC_PATTERN = /(\((?:[^()]*[+*}{][^()]*)\))[+*]|\(\?[^)]*[+*][^)]*\)[+*]/;

export function isSafeRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
  } catch {
    return false;
  }
  return !CATASTROPHIC_PATTERN.test(pattern);
}

/**
 * Extract the first number from a string, stripping commas.
 * Returns null if no number is found.
 */
export function extractNumber(value: string | null): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function evaluateSingle(
  condition: MonitorCondition,
  oldValue: string | null,
  newValue: string | null,
): boolean {
  try {
    switch (condition.type) {
      case "numeric_lt": {
        const num = extractNumber(newValue);
        if (num === null) return false;
        return num < parseFloat(condition.value);
      }
      case "numeric_lte": {
        const num = extractNumber(newValue);
        if (num === null) return false;
        return num <= parseFloat(condition.value);
      }
      case "numeric_gt": {
        const num = extractNumber(newValue);
        if (num === null) return false;
        return num > parseFloat(condition.value);
      }
      case "numeric_gte": {
        const num = extractNumber(newValue);
        if (num === null) return false;
        return num >= parseFloat(condition.value);
      }
      case "numeric_change_pct": {
        const oldNum = extractNumber(oldValue);
        const newNum = extractNumber(newValue);
        if (oldNum === null || oldNum === 0 || newNum === null) return false;
        const pctChange = Math.abs((newNum - oldNum) / oldNum) * 100;
        return pctChange > parseFloat(condition.value);
      }
      case "text_contains": {
        if (newValue === null) return false;
        return newValue.toLowerCase().includes(condition.value.toLowerCase());
      }
      case "text_not_contains": {
        if (newValue === null) return false;
        return !newValue.toLowerCase().includes(condition.value.toLowerCase());
      }
      case "text_equals": {
        if (newValue === null) return false;
        return newValue.trim().toLowerCase() === condition.value.trim().toLowerCase();
      }
      case "regex": {
        try {
          if (!isSafeRegex(condition.value)) return false;
          // Cap input length to mitigate ReDoS on large scraped content
          const input = (newValue ?? "").slice(0, REGEX_INPUT_MAX_LENGTH);
          return new RegExp(condition.value, "i").test(input);
        } catch {
          return false;
        }
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Evaluate a set of monitor conditions against old/new values.
 * Returns true if notifications should fire.
 *
 * - Empty conditions array → true (no conditions = always notify)
 * - AND within a group (same groupIndex), OR between groups
 * - Never throws
 */
export function evaluateConditions(
  conditions: MonitorCondition[],
  oldValue: string | null,
  newValue: string | null,
): boolean {
  if (conditions.length === 0) return true;

  // Group conditions by groupIndex
  const groups = new Map<number, MonitorCondition[]>();
  for (const c of conditions) {
    const group = groups.get(c.groupIndex) || [];
    group.push(c);
    groups.set(c.groupIndex, group);
  }

  // OR between groups: if any group passes entirely, return true
  const groupKeys = Array.from(groups.keys());
  for (const key of groupKeys) {
    const groupConditions = groups.get(key)!;
    const groupPassed = groupConditions.every((c: MonitorCondition) =>
      evaluateSingle(c, oldValue, newValue),
    );
    if (groupPassed) return true;
  }

  return false;
}
