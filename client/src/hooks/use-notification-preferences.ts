import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import type { NotificationPreference } from "@shared/schema";

const PREFS_KEY = "notification-preferences";

export function useNotificationPreferences(monitorId: number) {
  return useQuery({
    queryKey: [PREFS_KEY, monitorId],
    queryFn: async (): Promise<NotificationPreference> => {
      const url = buildUrl(api.monitors.notificationPreferences.get.path, { id: monitorId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notification preferences");
      return res.json().catch(() => {
        throw new Error("Unexpected response format from server");
      });
    },
    enabled: !!monitorId,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ monitorId, ...data }: { monitorId: number } & Record<string, unknown>) => {
      const url = buildUrl(api.monitors.notificationPreferences.put.path, { id: monitorId });
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to update notification preferences");
      }
      return res.json().catch(() => {
        throw new Error("Unexpected response format from server");
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [PREFS_KEY, variables.monitorId] });
      toast({ title: "Preferences saved", description: "Notification preferences updated" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

export function useDeleteNotificationPreferences() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (monitorId: number) => {
      const url = buildUrl(api.monitors.notificationPreferences.delete.path, { id: monitorId });
      const res = await fetch(url, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to delete notification preferences");
      }
    },
    onSuccess: (_, monitorId) => {
      queryClient.invalidateQueries({ queryKey: [PREFS_KEY, monitorId] });
      toast({ title: "Preferences reset", description: "Notification preferences removed" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}
