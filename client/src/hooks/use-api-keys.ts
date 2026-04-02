import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface ApiKeyListItem {
  id: number;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface ApiKeyCreateResponse {
  id: number;
  name: string;
  keyPrefix: string;
  key: string;
  createdAt: string;
}

const API_KEYS_PATH = "/api/keys";

export function useApiKeys() {
  return useQuery<ApiKeyListItem[]>({
    queryKey: [API_KEYS_PATH],
    queryFn: async () => {
      const res = await fetch(API_KEYS_PATH, { credentials: "include" });
      if (res.status === 403) return [];
      if (!res.ok) throw new Error("Failed to fetch API keys");
      return res.json().catch(() => {
        throw new Error("Unexpected response format from server");
      });
    },
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<ApiKeyCreateResponse, Error, { name: string }>({
    mutationFn: async (data) => {
      const res = await fetch(API_KEYS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to create API key");
      }
      return res.json().catch(() => {
        throw new Error("Unexpected response format from server");
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_KEYS_PATH] });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const res = await fetch(`${API_KEYS_PATH}/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to revoke API key");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_KEYS_PATH] });
      toast({ title: "Key Revoked", description: "The API key has been revoked." });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}
