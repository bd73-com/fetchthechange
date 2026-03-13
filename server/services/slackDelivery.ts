import type { Monitor, MonitorChange } from "@shared/schema";

// In-flight join promises keyed by botToken:channelId to avoid concurrent join storms
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
            text: `*Detected at:*\n${change.detectedAt.toLocaleString("en-GB", { timeZone: "Europe/Berlin", timeZoneName: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}`,
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
  // Handle rate limiting: HTTP 429 or JSON-level ratelimited error
  const isHttp429 = response.status === 429;
  if (!response.ok && !isHttp429) {
    return { ok: false, error: `slack_http_${response.status}` };
  }
  const data = isHttp429
    ? { ok: false as const, error: "ratelimited" }
    : await response.json() as { ok: boolean; error?: string; ts?: string };

  if (!data.ok && (isHttp429 || data.error === "ratelimited")) {
    const retryAfter = Number(response.headers.get("Retry-After")) || 1;
    const delay = Math.max(0, Math.min(retryAfter, 5)) * 1000;
    console.log(`[Slack] Rate limited, retrying after ${delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    const retryResponse = await fetch("https://slack.com/api/chat.postMessage", {
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
    if (!retryResponse.ok) {
      return { ok: false, error: `slack_http_${retryResponse.status}` };
    }
    return await retryResponse.json() as { ok: boolean; error?: string; ts?: string };
  }

  return data;
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

      const joinKey = `${botToken}:${channelId}`;
      let joinPromise = pendingJoins.get(joinKey);
      if (!joinPromise) {
        joinPromise = joinChannel(channelId, botToken);
        pendingJoins.set(joinKey, joinPromise);
        const cleanup = () => pendingJoins.delete(joinKey);
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
  const allChannels: SlackChannel[] = [];
  let cursor: string | undefined;
  // Safety limit to avoid infinite loops
  const maxPages = 10;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "1000",
    });
    if (cursor) {
      params.set("cursor", cursor);
    }

    const response = await fetch(
      `https://slack.com/api/conversations.list?${params}`,
      {
        headers: {
          Authorization: `Bearer ${botToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      }
    );

    // Handle rate limiting: return channels collected so far
    if (response.status === 429) {
      console.warn(`[Slack] Rate limited during channel listing (page ${page + 1}), returning ${allChannels.length} channels collected so far`);
      break;
    }

    if (!response.ok) {
      throw new Error(`Slack API error: slack_http_${response.status}`);
    }

    const data = await response.json() as {
      ok: boolean;
      error?: string;
      channels?: Array<{ id: string; name: string }>;
      response_metadata?: { next_cursor?: string };
    };

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    for (const c of data.channels || []) {
      allChannels.push({ id: c.id, name: c.name });
    }

    cursor = data.response_metadata?.next_cursor;
    if (!cursor) {
      break;
    }
  }

  return allChannels;
}
