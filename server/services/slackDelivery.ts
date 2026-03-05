import type { Monitor, MonitorChange } from "@shared/schema";

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

export async function deliver(
  monitor: Monitor,
  change: MonitorChange,
  channelId: string,
  botToken: string
): Promise<SlackDeliveryResult> {
  const message = buildBlockKitMessage(monitor, change);

  try {
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
    });

    const data = await response.json() as { ok: boolean; error?: string; ts?: string };

    if (data.ok) {
      console.log(`[Slack] Message posted (monitorId=${monitor.id}, channel=${channelId})`);
      return { success: true, slackTs: data.ts };
    }

    console.warn(`[Slack] Delivery failed (monitorId=${monitor.id}, channelId=${channelId}, error=${data.error})`);
    return { success: false, error: data.error || "Unknown Slack API error" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Slack] Delivery failed (monitorId=${monitor.id}, channelId=${channelId}, error=${message})`);
    return { success: false, error: message };
  }
}

export async function listChannels(botToken: string): Promise<SlackChannel[]> {
  const response = await fetch(
    "https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=1000",
    {
      headers: {
        Authorization: `Bearer ${botToken}`,
      },
    }
  );

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
