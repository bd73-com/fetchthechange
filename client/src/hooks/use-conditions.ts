import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import type { MonitorCondition } from "@shared/schema";

const CONDITIONS_KEY = "monitor-conditions";

export function useMonitorConditions(monitorId: number) {
  return useQuery({
    queryKey: [CONDITIONS_KEY, monitorId],
    queryFn: async (): Promise<MonitorCondition[]> => {
      const url = buildUrl(api.monitors.conditions.list.path, { id: monitorId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch conditions");
      return res.json();
    },
    enabled: !!monitorId,
  });
}

export function useAddCondition() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      monitorId,
      type,
      value,
      groupIndex,
    }: {
      monitorId: number;
      type: string;
      value: string;
      groupIndex: number;
    }) => {
      const url = buildUrl(api.monitors.conditions.create.path, { id: monitorId });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, value, groupIndex }),
        credentials: "include",
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || "Failed to add condition");
      }
      return res.json() as Promise<MonitorCondition>;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [CONDITIONS_KEY, variables.monitorId] });
      toast({ title: "Condition added", description: "Alert condition saved" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

export function useDeleteCondition() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ monitorId, conditionId }: { monitorId: number; conditionId: number }) => {
      const url = buildUrl(api.monitors.conditions.delete.path, { id: monitorId, conditionId });
      const res = await fetch(url, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to delete condition");
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [CONDITIONS_KEY, variables.monitorId] });
      toast({ title: "Condition removed", description: "Alert condition deleted" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}
