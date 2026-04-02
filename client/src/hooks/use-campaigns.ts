import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { Campaign, CampaignRecipient, AutomatedCampaignConfig } from "@shared/schema";

const CAMPAIGNS_KEY = "/api/admin/campaigns";
const DASHBOARD_KEY = "/api/admin/campaigns/dashboard";

async function fetchJson(url: string, options?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...options });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => {
    throw new Error("Unexpected response format from server");
  });
}

// GET /api/admin/campaigns
export function useCampaigns(status?: string) {
  const url = status ? `${CAMPAIGNS_KEY}?status=${status}` : CAMPAIGNS_KEY;
  return useQuery<Campaign[]>({
    queryKey: [CAMPAIGNS_KEY, status],
    queryFn: () => fetchJson(url),
  });
}

// GET /api/admin/campaigns/:id
export function useCampaign(id: number) {
  return useQuery<Campaign>({
    queryKey: [CAMPAIGNS_KEY, id],
    queryFn: () => fetchJson(`${CAMPAIGNS_KEY}/${id}`),
    enabled: !!id,
  });
}

// GET /api/admin/campaigns/dashboard
export function useCampaignDashboard() {
  return useQuery<{
    totalCampaigns: number;
    totalSent: number;
    totalOpened: number;
    totalClicked: number;
    avgOpenRate: number;
    avgClickRate: number;
    recentCampaigns: Campaign[];
  }>({
    queryKey: [DASHBOARD_KEY],
    queryFn: () => fetchJson(DASHBOARD_KEY),
    refetchInterval: 30000,
  });
}

// GET /api/admin/campaigns/:id/analytics
export function useCampaignAnalytics(id: number) {
  return useQuery<{
    campaign: Campaign;
    recipientBreakdown: Record<string, number>;
    recipients: CampaignRecipient[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: [CAMPAIGNS_KEY, id, "analytics"],
    queryFn: () => fetchJson(`${CAMPAIGNS_KEY}/${id}/analytics`),
    enabled: !!id,
    refetchInterval: 15000,
  });
}

// POST /api/admin/campaigns
export function useCreateCampaign() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: {
      name: string;
      subject: string;
      htmlBody: string;
      textBody?: string;
      filters?: Record<string, any>;
    }) =>
      fetchJson(CAMPAIGNS_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CAMPAIGNS_KEY] });
      queryClient.invalidateQueries({ queryKey: [DASHBOARD_KEY] });
      toast({ title: "Campaign created", description: "Your campaign draft has been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// PATCH /api/admin/campaigns/:id
export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, ...updates }: { id: number } & Partial<{
      name: string;
      subject: string;
      htmlBody: string;
      textBody: string;
      filters: Record<string, any>;
    }>) =>
      fetchJson(`${CAMPAIGNS_KEY}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [CAMPAIGNS_KEY] });
      queryClient.invalidateQueries({ queryKey: [CAMPAIGNS_KEY, variables.id] });
      queryClient.invalidateQueries({ queryKey: [DASHBOARD_KEY] });
      toast({ title: "Campaign updated", description: "Changes saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// DELETE /api/admin/campaigns/:id
export function useDeleteCampaign() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: number) =>
      fetchJson(`${CAMPAIGNS_KEY}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CAMPAIGNS_KEY] });
      queryClient.invalidateQueries({ queryKey: [DASHBOARD_KEY] });
      toast({ title: "Deleted", description: "Campaign deleted." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// POST /api/admin/campaigns/:id/preview
export function usePreviewRecipients() {
  return useMutation<
    { count: number; users: Array<{ id: string; email: string; firstName: string | null; tier: string; monitorCount: number }> },
    Error,
    { id: number; filters: Record<string, any> }
  >({
    mutationFn: ({ id, filters }) =>
      fetchJson(`${CAMPAIGNS_KEY}/${id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters }),
      }),
  });
}

// POST /api/admin/campaigns/:id/send-test
export function useSendTestCampaign() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, testEmail }: { id: number; testEmail?: string }) =>
      fetchJson(`${CAMPAIGNS_KEY}/${id}/send-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testEmail }),
      }),
    onSuccess: (data: any) => {
      toast({ title: "Test email sent", description: `Sent to ${data.sentTo}` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// POST /api/admin/campaigns/:id/send
export function useSendCampaign() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: number) =>
      fetchJson(`${CAMPAIGNS_KEY}/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [CAMPAIGNS_KEY] });
      queryClient.invalidateQueries({ queryKey: [DASHBOARD_KEY] });
      toast({
        title: "Campaign sending",
        description: `Sending to ${data.totalRecipients} recipients...`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// POST /api/admin/campaigns/recover
export function useRecoverCampaigns() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<
    { recovered: number; campaigns: Array<{ id: number; name: string; subject: string; totalRecipients: number }>; message?: string },
    Error,
    void
  >({
    mutationFn: () =>
      fetchJson(`${CAMPAIGNS_KEY}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [CAMPAIGNS_KEY] });
      queryClient.invalidateQueries({ queryKey: [DASHBOARD_KEY] });
      if (data.recovered > 0) {
        toast({ title: "Campaigns recovered", description: `Recovered ${data.recovered} campaign(s) from recipient data.` });
      } else {
        toast({ title: "No campaigns to recover", description: data.message || "No orphaned recipient data found." });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// POST /api/admin/campaigns/:id/cancel
export function useCancelCampaign() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: number) =>
      fetchJson(`${CAMPAIGNS_KEY}/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [CAMPAIGNS_KEY] });
      queryClient.invalidateQueries({ queryKey: [DASHBOARD_KEY] });
      toast({
        title: "Campaign cancelled",
        description: `${data.sentSoFar} sent, ${data.cancelled} cancelled.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// ------------------------------------------------------------------
// AUTOMATED CAMPAIGNS
// ------------------------------------------------------------------

const AUTO_CAMPAIGNS_KEY = "/api/admin/automated-campaigns";

// GET /api/admin/automated-campaigns
export function useAutomatedCampaigns() {
  return useQuery<AutomatedCampaignConfig[]>({
    queryKey: [AUTO_CAMPAIGNS_KEY],
    queryFn: () => fetchJson(AUTO_CAMPAIGNS_KEY),
  });
}

// PATCH /api/admin/automated-campaigns/:key
export function useUpdateAutomatedCampaign() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ key, ...updates }: { key: string } & Partial<{
      subject: string;
      htmlBody: string;
      textBody: string;
      enabled: boolean;
    }>) =>
      fetchJson(`${AUTO_CAMPAIGNS_KEY}/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [AUTO_CAMPAIGNS_KEY] });
      toast({ title: "Config updated", description: "Automated campaign config saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// POST /api/admin/automated-campaigns/:key/trigger
export function useTriggerAutomatedCampaign() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ key, signupAfter }: { key: string; signupAfter?: string }) =>
      fetchJson(`${AUTO_CAMPAIGNS_KEY}/${key}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupAfter ? { signupAfter } : {}),
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [AUTO_CAMPAIGNS_KEY] });
      queryClient.invalidateQueries({ queryKey: [CAMPAIGNS_KEY] });
      queryClient.invalidateQueries({ queryKey: [DASHBOARD_KEY] });
      if (data.skipped) {
        toast({ title: "No new recipients", description: "No new users since the last run." });
      } else {
        toast({
          title: "Campaign triggered",
          description: `Sending to ${data.totalRecipients} recipients...`,
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}
