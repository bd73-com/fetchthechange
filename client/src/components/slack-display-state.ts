/**
 * Determines which UI state to show for the Slack notification section.
 * Extracted from NotificationChannelsPanel for testability.
 */

export type SlackDisplayState = "upgrade" | "not-configured" | "connect" | "connected";

interface SlackStatus {
  available: boolean;
  connected: boolean;
}

export function getSlackDisplayState(
  isFreeTier: boolean,
  slackStatus: SlackStatus | undefined,
): SlackDisplayState {
  if (isFreeTier) return "upgrade";
  if (slackStatus?.available === false) return "not-configured";
  if (!slackStatus?.connected) return "connect";
  return "connected";
}
