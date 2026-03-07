import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, Globe, MessageSquare, Eye, EyeOff, ExternalLink } from "lucide-react";
import {
  useNotificationChannels,
  useUpsertNotificationChannel,
  useDeleteNotificationChannel,
  useRevealWebhookSecret,
} from "@/hooks/use-notification-channels";
import { useSlackStatus, useSlackChannels, useDisconnectSlack } from "@/hooks/use-slack";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@shared/routes";
import { getSlackDisplayState } from "./slack-display-state";

interface NotificationChannelsPanelProps {
  monitorId: number;
}

export function NotificationChannelsPanel({ monitorId }: NotificationChannelsPanelProps) {
  const { user } = useAuth();
  const isFreeTier = (user as any)?.tier === "free" || !(user as any)?.tier;

  const { data: channels = [], isLoading } = useNotificationChannels(monitorId);
  const upsertChannel = useUpsertNotificationChannel();
  const deleteChannel = useDeleteNotificationChannel();

  const emailChannel = channels.find((c) => c.channel === "email");
  const webhookChannel = channels.find((c) => c.channel === "webhook");
  const slackChannel = channels.find((c) => c.channel === "slack");

  // Webhook state
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const revealSecret = useRevealWebhookSecret(monitorId);

  // Slack state
  const { data: slackStatus, isLoading: isSlackStatusLoading } = useSlackStatus();
  const { data: slackChannelsList = [] } = useSlackChannels();
  const disconnectSlack = useDisconnectSlack();
  const [selectedSlackChannel, setSelectedSlackChannel] = useState("");

  // Initialize webhook URL from existing config
  const currentWebhookUrl = (webhookChannel?.config as any)?.url || "";
  const displayUrl = webhookUrl || currentWebhookUrl;

  const handleToggleChannel = (channel: string, enabled: boolean, config: Record<string, unknown> = {}) => {
    upsertChannel.mutate({ monitorId, channel, enabled, config });
  };

  const handleSaveWebhook = () => {
    if (!webhookUrl && !currentWebhookUrl) return;
    upsertChannel.mutate({
      monitorId,
      channel: "webhook",
      enabled: true,
      config: { url: webhookUrl || currentWebhookUrl },
    });
  };

  const handleRevealSecret = async () => {
    if (showSecret) {
      setShowSecret(false);
      setRevealedSecret(null);
      return;
    }
    try {
      const result = await revealSecret.mutateAsync();
      setRevealedSecret(result.secret);
      setShowSecret(true);
    } catch {
      setShowSecret(false);
      setRevealedSecret(null);
    }
  };

  const handleSaveSlack = () => {
    if (!selectedSlackChannel) return;
    const channel = slackChannelsList.find((c) => c.id === selectedSlackChannel);
    upsertChannel.mutate({
      monitorId,
      channel: "slack",
      enabled: true,
      config: { channelId: selectedSlackChannel, channelName: channel ? `#${channel.name}` : "" },
    });
  };

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Notification Channels</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Email Channel */}
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-center gap-3">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Email</p>
              <p className="text-sm text-muted-foreground">Receive change notifications via email</p>
            </div>
          </div>
          <Switch
            checked={emailChannel?.enabled ?? true}
            onCheckedChange={(checked) => handleToggleChannel("email", checked, {})}
          />
        </div>

        {/* Webhook Channel */}
        <div className="p-4 border rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">Webhook</p>
                  {isFreeTier && <Badge variant="secondary">Pro</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">Send JSON payloads to a URL when changes are detected</p>
              </div>
            </div>
            {!isFreeTier && (
              <Switch
                checked={webhookChannel?.enabled ?? false}
                onCheckedChange={(checked) => {
                  if (checked && !currentWebhookUrl && !webhookUrl) return;
                  handleToggleChannel("webhook", checked, { url: displayUrl });
                }}
              />
            )}
          </div>

          {isFreeTier ? (
            <p className="text-sm text-muted-foreground">
              Upgrade to Pro or Power to use webhook notifications.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="webhook-url">Webhook URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="webhook-url"
                    placeholder="https://example.com/webhook"
                    value={webhookUrl || currentWebhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                  />
                  <Button onClick={handleSaveWebhook} disabled={upsertChannel.isPending} size="sm">
                    Save
                  </Button>
                </div>
              </div>

              {webhookChannel && (
                <div className="space-y-2">
                  <Label>Signing Secret</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-muted rounded text-sm font-mono truncate">
                      {showSecret && revealedSecret ? revealedSecret : "whsec_****...****"}
                    </code>
                    <Button variant="ghost" size="sm" onClick={handleRevealSecret} disabled={revealSecret.isPending}>
                      {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Use this secret to verify webhook signatures via the X-FTC-Signature-256 header.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Slack Channel */}
        <div className="p-4 border rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">Slack</p>
                  {isFreeTier && <Badge variant="secondary">Pro</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">Post change alerts to a Slack channel</p>
              </div>
            </div>
            {!isFreeTier && slackStatus?.connected && (
              <Switch
                checked={slackChannel?.enabled ?? false}
                onCheckedChange={(checked) => {
                  const config = slackChannel?.config as { channelId?: string; channelName?: string } | undefined;
                  if (checked && !config?.channelId && !selectedSlackChannel) return;
                  handleToggleChannel("slack", checked, {
                    channelId: config?.channelId || selectedSlackChannel,
                    channelName: config?.channelName || "",
                  });
                }}
              />
            )}
          </div>

          {isSlackStatusLoading && !isFreeTier ? (
            <p className="text-sm text-muted-foreground">Loading Slack status…</p>
          ) : getSlackDisplayState(isFreeTier, slackStatus ?? undefined) === "upgrade" ? (
            <p className="text-sm text-muted-foreground">
              Upgrade to Pro or Power to use Slack notifications.
            </p>
          ) : getSlackDisplayState(isFreeTier, slackStatus ?? undefined) === "not-configured" ? (
            <p className="text-sm text-muted-foreground">
              Slack integration is not configured on this server. Contact your administrator to set up the Slack app.
            </p>
          ) : getSlackDisplayState(isFreeTier, slackStatus ?? undefined) === "connect" ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Connect your Slack workspace to enable notifications.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { window.location.href = api.integrations.slack.install.path; }}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Connect to Slack
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Connected to <strong>{slackStatus?.teamName}</strong>
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => disconnectSlack.mutate()}
                  disabled={disconnectSlack.isPending}
                >
                  Disconnect
                </Button>
              </div>
              <div className="flex gap-2">
                <Select
                  value={selectedSlackChannel || (slackChannel?.config as any)?.channelId || ""}
                  onValueChange={setSelectedSlackChannel}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {slackChannelsList.map((ch) => (
                      <SelectItem key={ch.id} value={ch.id}>
                        #{ch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleSaveSlack} disabled={upsertChannel.isPending} size="sm">
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
