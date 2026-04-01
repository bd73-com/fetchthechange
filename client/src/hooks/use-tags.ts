import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

// GET /api/tags
export function useTags() {
  return useQuery({
    queryKey: [api.tags.list.path],
    queryFn: async () => {
      const res = await fetch(api.tags.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tags");
      return api.tags.list.responses[200].parse(await res.json());
    },
  });
}

// POST /api/tags
export function useCreateTag() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: { name: string; colour: string }) => {
      const res = await fetch(api.tags.create.path, {
        method: api.tags.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to create tag");
      }
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tags.list.path] });
      toast({ title: "Tag created" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// PATCH /api/tags/:id
export function useUpdateTag() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number; name?: string; colour?: string }) => {
      const url = buildUrl(api.tags.update.path, { id });
      const res = await fetch(url, {
        method: api.tags.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to update tag");
      }
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tags.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.monitors.list.path] });
      toast({ title: "Tag updated" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// DELETE /api/tags/:id
export function useDeleteTag() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.tags.delete.path, { id });
      const res = await fetch(url, {
        method: api.tags.delete.method,
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to delete tag");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tags.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.monitors.list.path] });
      toast({ title: "Tag deleted" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// PUT /api/monitors/:id/tags
export function useSetMonitorTags() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ monitorId, tagIds }: { monitorId: number; tagIds: number[] }) => {
      const url = buildUrl(api.monitors.setTags.path, { id: monitorId });
      const res = await fetch(url, {
        method: api.monitors.setTags.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds }),
        credentials: "include",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to update tags");
      }
      return await res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.monitors.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.monitors.get.path, variables.monitorId] });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}
