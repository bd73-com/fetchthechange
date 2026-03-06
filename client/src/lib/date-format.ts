import { format } from "date-fns";

/** "Mar 6, 2026" */
export function formatDate(date: Date | string): string {
  return format(new Date(date), "MMM d, yyyy");
}

/** "1557" */
export function formatTime(date: Date | string): string {
  return format(new Date(date), "HHmm");
}

/** "Mar 6, 2026 1557" */
export function formatDateTime(date: Date | string): string {
  return format(new Date(date), "MMM d, yyyy HHmm");
}
