import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

const SLACK_STATUS_KEY = "slack-status";
const SLACK_CHANNELS_KEY = "slack-channels";

interface SlackStatus {
  connected: boolean;
  available: boolean;
  teamName?: string;
  unavailableReason?: "tables-not-ready" | "oauth-not-configured";
}

interface SlackChannel {
  id: string;
  name: string;
}

export function useSlackStatus() {
  return useQuery({
    queryKey: [SLACK_STATUS_KEY],
    queryFn: async (): Promise<SlackStatus> => {
      const res = await fetch(api.integrations.slack.status.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Slack status");
      return res.json();
    },
  });
}

export function useSlackChannels() {
  const { data: status } = useSlackStatus();

  return useQuery({
    queryKey: [SLACK_CHANNELS_KEY],
    queryFn: async (): Promise<SlackChannel[]> => {
      const res = await fetch(api.integrations.slack.channels.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Slack channels");
      return res.json();
    },
    enabled: !!status?.connected,
  });
}

export function useDisconnectSlack() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.integrations.slack.disconnect.path, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to disconnect Slack");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SLACK_STATUS_KEY] });
      queryClient.invalidateQueries({ queryKey: [SLACK_CHANNELS_KEY] });
      toast({ title: "Slack disconnected", description: "Your Slack workspace has been disconnected" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}
