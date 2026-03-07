/**
 * Determines which UI state to show for the Slack notification section.
 * Extracted from NotificationChannelsPanel for testability.
 */

export type SlackDisplayState = "upgrade" | "not-configured" | "not-ready" | "connect" | "connected";

interface SlackStatus {
  available: boolean;
  connected: boolean;
  unavailableReason?: "tables-not-ready" | "oauth-not-configured";
}

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
