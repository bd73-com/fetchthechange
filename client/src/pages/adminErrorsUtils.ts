/**
 * Pure utility for computing the batch-delete payload for admin error logs.
 * Extracted so the branching logic can be unit-tested without React.
 */

export type BatchDeletePayload =
  | { ids: number[] }
  | { filters: { level?: string; source?: string }; excludeIds?: number[] };

/**
 * Decides which payload shape to send to POST /api/admin/error-logs/batch-delete.
 *
 * @returns the payload, or `null` when there is nothing to delete.
 */
export function buildBatchDeletePayload(opts: {
  selectAll: boolean;
  selectedIds: Set<number>;
  excludedIds: Set<number>;
  levelFilter: string;
  sourceFilter: string;
  logs: { id: number }[];
}): BatchDeletePayload | null {
  const { selectAll, selectedIds, excludedIds, levelFilter, sourceFilter, logs } = opts;

  if (!selectAll) {
    const ids = Array.from(selectedIds);
    return ids.length > 0 ? { ids } : null;
  }

  // selectAll path — prefer filter-based delete when a filter is active
  const filters: { level?: string; source?: string } = {};
  if (levelFilter !== "all") filters.level = levelFilter;
  if (sourceFilter !== "all") filters.source = sourceFilter;

  if (filters.level || filters.source) {
    const excluded = Array.from(excludedIds);
    return {
      filters,
      ...(excluded.length > 0 ? { excludeIds: excluded } : {}),
    };
  }

  // No filters — fall back to sending visible IDs directly
  const ids = logs.filter(l => !excludedIds.has(l.id)).map(l => l.id);
  return ids.length > 0 ? { ids } : null;
}
