/**
 * Determines which UI state to show for the Slack notification section.
 * Extracted from NotificationChannelsPanel for testability.
 */

import type { SlackStatus } from "@/hooks/use-slack";

export type SlackDisplayState = "upgrade" | "not-configured" | "not-ready" | "connect" | "connected";

export function getSlackDisplayState(
  isFreeTier: boolean,
  slackStatus: SlackStatus | undefined,
): SlackDisplayState {
  if (isFreeTier) return "upgrade";
  if (slackStatus?.available === false) {
    return slackStatus.unavailableReason === "tables-not-ready" ? "not-ready" : "not-configured";
  }
  if (!slackStatus?.connected) return "connect";
  return "connected";
}
