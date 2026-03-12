import type { Monitor, MonitorChange } from "@shared/schema";

// In-flight join promises keyed by channelId to avoid concurrent join storms
const pendingJoins = new Map<string, Promise<{ ok: boolean; error?: string }>>();

export interface SlackDeliveryResult {
  success: boolean;
  error?: string;
  slackTs?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
}

function buildBlockKitMessage(monitor: Monitor, change: MonitorChange) {
  const appUrl = process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
    : "https://fetchthechange.com";

  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Change Detected: ${monitor.name}`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*URL:*\n<${monitor.url}|${new URL(monitor.url).hostname}>`,
          },
          {
            type: "mrkdwn",
            text: `*Detected at:*\n${change.detectedAt.toISOString()}`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Previous value:*\n\`\`\`${(change.oldValue || "(empty)").slice(0, 500)}\`\`\``,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*New value:*\n\`\`\`${(change.newValue || "(empty)").slice(0, 500)}\`\`\``,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View in FetchTheChange",
            },
            url: `${appUrl}/monitors/${monitor.id}`,
          },
        ],
      },
    ],
  };
}

async function postMessage(
  channelId: string,
  botToken: string,
  message: Record<string, unknown>
): Promise<{ ok: boolean; error?: string; ts?: string }> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({
      channel: channelId,
      ...message,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    return { ok: false, error: `slack_http_${response.status}` };
  }
  return response.json() as Promise<{ ok: boolean; error?: string; ts?: string }>;
}

async function joinChannel(
  channelId: string,
  botToken: string
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch("https://slack.com/api/conversations.join", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel: channelId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    return { ok: false, error: `slack_http_${response.status}` };
  }
  return response.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function deliver(
  monitor: Monitor,
  change: MonitorChange,
  channelId: string,
  botToken: string
): Promise<SlackDeliveryResult> {
  const message = buildBlockKitMessage(monitor, change);

  try {
    let data = await postMessage(channelId, botToken, message);

    if (!data.ok && data.error === "not_in_channel") {
      console.log(`[Slack] Bot not in channel ${channelId}, attempting to join...`);

      let joinPromise = pendingJoins.get(channelId);
      if (!joinPromise) {
        joinPromise = joinChannel(channelId, botToken);
        pendingJoins.set(channelId, joinPromise);
        const cleanup = () => pendingJoins.delete(channelId);
        joinPromise.then(cleanup, cleanup);
      }
      const joinResult = await joinPromise;

      if (joinResult.ok) {
        console.log(`[Slack] Joined channel ${channelId}, retrying message...`);
        data = await postMessage(channelId, botToken, message);
      } else {
        console.warn(`[Slack] Failed to join channel ${channelId} (error=${joinResult.error})`);
        return { success: false, error: joinResult.error || "Failed to join channel" };
      }
    }

    if (data.ok) {
      console.log(`[Slack] Message posted (monitorId=${monitor.id}, channel=${channelId})`);
      return { success: true, slackTs: data.ts };
    }

    console.warn(`[Slack] Delivery failed (monitorId=${monitor.id}, channelId=${channelId}, error=${data.error})`);
    return { success: false, error: data.error || "Unknown Slack API error" };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[Slack] Delivery failed (monitorId=${monitor.id}, channelId=${channelId}, error=${errMsg})`);
    return { success: false, error: errMsg };
  }
}

export async function listChannels(botToken: string): Promise<SlackChannel[]> {
  const response = await fetch(
    "https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=1000",
    {
      headers: {
        Authorization: `Bearer ${botToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) {
    throw new Error(`Slack API error: slack_http_${response.status}`);
  }

  const data = await response.json() as {
    ok: boolean;
    error?: string;
    channels?: Array<{ id: string; name: string }>;
  };

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  return (data.channels || []).map((c) => ({ id: c.id, name: c.name }));
}
