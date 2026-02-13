import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertMonitor } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

// GET /api/monitors
export function useMonitors() {
  return useQuery({
    queryKey: [api.monitors.list.path],
    queryFn: async () => {
      const res = await fetch(api.monitors.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch monitors");
      return api.monitors.list.responses[200].parse(await res.json());
    },
  });
}

// GET /api/monitors/:id
export function useMonitor(id: number) {
  return useQuery({
    queryKey: [api.monitors.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.monitors.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch monitor details");
      return api.monitors.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

// GET /api/monitors/:id/history
export function useMonitorHistory(id: number) {
  return useQuery({
    queryKey: [api.monitors.history.path, id],
    queryFn: async () => {
      const url = buildUrl(api.monitors.history.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch history");
      return api.monitors.history.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

// POST /api/monitors
export function useCreateMonitor() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertMonitor) => {
      const res = await fetch(api.monitors.create.path, {
        method: api.monitors.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        if (res.status === 429) {
          throw new Error(errorData.message || "Too many requests. Please try again later.");
        }
        if (res.status === 403 && errorData.code === "TIER_LIMIT_REACHED") {
          throw new Error(errorData.message);
        }
        if (res.status === 400) {
          throw new Error(errorData.message);
        }
        throw new Error("Failed to create monitor");
      }
      return api.monitors.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.monitors.list.path] });
      toast({ title: "Success", description: "Monitor created successfully" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// PATCH /api/monitors/:id
export function useUpdateMonitor() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertMonitor>) => {
      const url = buildUrl(api.monitors.update.path, { id });
      const res = await fetch(url, {
        method: api.monitors.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to update monitor");
      return api.monitors.update.responses[200].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.monitors.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.monitors.get.path, variables.id] });
      toast({ title: "Success", description: "Monitor updated" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// DELETE /api/monitors/:id
export function useDeleteMonitor() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.monitors.delete.path, { id });
      const res = await fetch(url, {
        method: api.monitors.delete.method,
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to delete monitor");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.monitors.list.path] });
      toast({ title: "Deleted", description: "Monitor removed successfully" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// POST /api/monitors/:id/check
export function useCheckMonitor() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.monitors.check.path, { id });
      const res = await fetch(url, {
        method: api.monitors.check.method,
        credentials: "include",
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (res.status === 429) {
          throw new Error(errorData.message || "Rate limit reached. Please try again later.");
        }
        throw new Error(errorData.message || "Failed to check monitor");
      }
      return api.monitors.check.responses[200].parse(await res.json());
    },
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: [api.monitors.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.monitors.get.path, id] });
      queryClient.invalidateQueries({ queryKey: [api.monitors.history.path, id] });
      
      if (data.changed) {
        toast({ title: "Change Detected!", description: "The content has changed since the last check." });
      } else {
        toast({ title: "No Changes", description: "The content matches the last check." });
      }
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// POST /api/monitors/:id/check (silent version for fix selector flow)
export function useCheckMonitorSilent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.monitors.check.path, { id });
      const res = await fetch(url, {
        method: api.monitors.check.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to check monitor");
      return api.monitors.check.responses[200].parse(await res.json());
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: [api.monitors.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.monitors.get.path, id] });
      queryClient.invalidateQueries({ queryKey: [api.monitors.history.path, id] });
    },
  });
}

// POST /api/monitors/:id/suggest-selectors
export function useSuggestSelectors() {
  return useMutation({
    mutationFn: async ({ id, expectedText }: { id: number; expectedText?: string }) => {
      const url = buildUrl(api.monitors.suggestSelectors.path, { id });
      const res = await fetch(url, {
        method: api.monitors.suggestSelectors.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedText }),
        credentials: "include",
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to get selector suggestions");
      }
      return api.monitors.suggestSelectors.responses[200].parse(await res.json());
    },
  });
}

// PATCH /api/monitors/:id (silent version for fix selector flow)
export function useUpdateMonitorSilent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertMonitor>) => {
      const url = buildUrl(api.monitors.update.path, { id });
      const res = await fetch(url, {
        method: api.monitors.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update monitor");
      return api.monitors.update.responses[200].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.monitors.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.monitors.get.path, variables.id] });
    },
  });
}
