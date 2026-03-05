import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import type { NotificationChannel, DeliveryLogEntry } from "@shared/schema";

const CHANNELS_KEY = "notification-channels";
const DELIVERY_LOG_KEY = "delivery-log";

export function useNotificationChannels(monitorId: number) {
  return useQuery({
    queryKey: [CHANNELS_KEY, monitorId],
    queryFn: async (): Promise<NotificationChannel[]> => {
      const url = buildUrl(api.monitors.channels.list.path, { id: monitorId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notification channels");
      return res.json();
    },
    enabled: !!monitorId,
  });
}

export function useUpsertNotificationChannel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      monitorId,
      channel,
      enabled,
      config,
    }: {
      monitorId: number;
      channel: string;
      enabled: boolean;
      config: Record<string, unknown>;
    }) => {
      const url = buildUrl(api.monitors.channels.put.path, { id: monitorId, channel });
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, config }),
        credentials: "include",
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to update channel");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [CHANNELS_KEY, variables.monitorId] });
      toast({ title: "Channel saved", description: `${variables.channel} channel updated` });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

export function useDeleteNotificationChannel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ monitorId, channel }: { monitorId: number; channel: string }) => {
      const url = buildUrl(api.monitors.channels.delete.path, { id: monitorId, channel });
      const res = await fetch(url, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to delete channel");
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [CHANNELS_KEY, variables.monitorId] });
      toast({ title: "Channel removed", description: `${variables.channel} channel deleted` });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

export function useRevealWebhookSecret(monitorId: number) {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const url = buildUrl(api.monitors.channels.revealSecret.path, { id: monitorId });
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to reveal secret");
      }
      return res.json() as Promise<{ secret: string }>;
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

export function useDeliveryLog(monitorId: number, channel?: string) {
  return useQuery({
    queryKey: [DELIVERY_LOG_KEY, monitorId, channel],
    queryFn: async (): Promise<DeliveryLogEntry[]> => {
      let url = buildUrl(api.monitors.channels.deliveries.path, { id: monitorId });
      if (channel) url += `?channel=${channel}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch delivery log");
      return res.json();
    },
    enabled: !!monitorId,
  });
}
