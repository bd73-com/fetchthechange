import { type Monitor } from "@shared/schema";

export type HealthState = "healthy" | "degraded" | "paused";

export function getHealthState(monitor: Pick<Monitor, "active" | "consecutiveFailures">): HealthState {
  if (!monitor.active) return "paused";
  if (monitor.consecutiveFailures > 0) return "degraded";
  return "healthy";
}

/** Returns true when a monitor is degraded or paused — i.e. needs user attention. */
export function needsAttention(monitor: Pick<Monitor, "active" | "consecutiveFailures">): boolean {
  return !monitor.active || monitor.consecutiveFailures > 0;
}
