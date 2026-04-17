import { useAuth } from "@/hooks/use-auth";
import { usePageTitle } from "@/hooks/use-page-title";
import { useMonitors, useCheckMonitor } from "@/hooks/use-monitors";
import { useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { CreateMonitorDialog } from "@/components/CreateMonitorDialog";
import { MonitorCard } from "@/components/MonitorCard";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import ApiKeysPanel from "@/components/ApiKeysPanel";
import DashboardNav from "@/components/DashboardNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutDashboard, RefreshCw, Loader2, Sparkles, X, Megaphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TIER_LIMITS, TAG_LIMITS, type UserTier } from "@shared/models/auth";
import { useState, useEffect, useMemo, useRef } from "react";
import { useSearch } from "wouter";
import { useTags } from "@/hooks/use-tags";
import { TagManager } from "@/components/TagManager";
import { Tags } from "lucide-react";
import { needsAttention } from "@/lib/monitor-health";

// TODO: Remove banner code after 2026-02-27 (cutoff date)
const BANNER_CUTOFF = new Date("2026-02-27T00:00:00Z");
const BANNER_KEY = "ftc-free-tier-banner-dismissed";

export default function Dashboard() {
  usePageTitle("Dashboard — FetchTheChange");
  const { user, logout } = useAuth();
  const { data: monitors, isLoading, error, refetch } = useMonitors();
  const { mutate: checkMonitor, isPending: isChecking } = useCheckMonitor();
  const queryClient = useQueryClient();
  const [isBulkRefreshing, setIsBulkRefreshing] = useState(false);
  // Tracks whether the component is still mounted so an in-flight bulk refresh
  // can bail out early and skip state updates / toasts after unmount. Plain
  // boolean via ref — we never re-render on the flip. The effect body must
  // re-set to true on mount because React 18 StrictMode runs the cleanup
  // between its double-invoke mount cycle; without re-setting, mountedRef
  // stays false for the rest of the component's life and handleRefresh bails
  // out immediately.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { toast } = useToast();
  const searchString = useSearch();

  const { data: userTags = [] } = useTags();
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [needsAttentionFilter, setNeedsAttentionFilter] = useState(false);

  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try { return localStorage.getItem(BANNER_KEY) === "1"; } catch { return false; }
  });
  const userTier = (user?.tier || "free") as UserTier;
  const showBanner = userTier === "free" && new Date() < BANNER_CUTOFF && !bannerDismissed;

  // Handle checkout success/cancel from Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const checkoutStatus = params.get("checkout");

    if (checkoutStatus === "success") {
      toast({
        title: "Subscription activated!",
        description: "Thank you for upgrading. Your new plan is now active.",
      });
      // Clear the query param
      window.history.replaceState({}, "", "/dashboard");
    } else if (checkoutStatus === "cancelled") {
      toast({
        variant: "destructive",
        title: "Checkout cancelled",
        description: "You can upgrade anytime from your dashboard.",
      });
      window.history.replaceState({}, "", "/dashboard");
    }
  }, [searchString, toast]);

  // Auto-open Create Monitor dialog when URL params are present (e.g. from extension).
  // Skip when checkout params are present to avoid conflicting with Stripe redirect.
  const prefillParams = useMemo(() => {
    const params = new URLSearchParams(searchString);
    if (params.has("checkout")) return null;
    const url = params.get("url");
    if (!url) return null;
    return {
      url,
      selector: params.get("selector") || undefined,
      name: params.get("name") || undefined,
    };
  }, [searchString]);

  const [prefillDialogOpen, setPrefillDialogOpen] = useState(false);
  // Store prefill values in state so they persist after the URL is cleared.
  // Without this, the CreateMonitorDialog may not be mounted yet when the
  // useEffect clears the URL (e.g. during the loading skeleton phase),
  // causing it to mount later with empty values.
  const [storedPrefill, setStoredPrefill] = useState<typeof prefillParams>(null);

  useEffect(() => {
    if (prefillParams) {
      setStoredPrefill(prefillParams);
      setPrefillDialogOpen(true);
      // Clear query params so reopening doesn't re-trigger
      window.history.replaceState({}, "", "/dashboard");
    }
  }, [prefillParams]);

  // The header dialog is the single externally-controlled instance that
  // auto-opens when prefill params arrive. The empty-state dialog below
  // must NOT be externally controlled, or both dialogs race on the same
  // externalOpen=true / onExternalOpenChange callback.
  //
  // Clear storedPrefill when the dialog closes so subsequent opens don't
  // carry stale extension values. Keyed on dialog close (not monitor
  // count) to avoid racing with React render batching.
  const prefillDialogProps = {
    initialValues: storedPrefill ?? undefined,
    // `undefined` (not `false`) when closed — avoids externally controlling
    // the dialog when there is no active prefill.
    externalOpen: prefillDialogOpen ? true : undefined,
    onExternalOpenChange: (v: boolean) => {
      if (!v) {
        setPrefillDialogOpen(false);
        setStoredPrefill(null);
      }
    },
  } as const;

  const handleRefresh = async () => {
    console.log("Refreshing monitors...");
    // Use the fresh data returned by refetch() instead of the stale closure variable
    const { data: freshMonitors, error: refetchError } = await refetch();

    // refetch() resolves with {data:undefined,error} on network/HTTP failure —
    // surface that distinctly so users aren't told "No monitors" when the real
    // cause is a failed GET /api/monitors. See GitHub issue #435.
    if (refetchError) {
      toast({
        variant: "destructive",
        title: "Refresh failed",
        description: refetchError.message || "Could not load monitors. Please try again.",
      });
      return;
    }

    if (!freshMonitors || freshMonitors.length === 0) {
      toast({ title: "No monitors", description: "Create a monitor first to refresh data." });
      return;
    }

    const activeMonitors = freshMonitors.filter(m => m.active);
    if (activeMonitors.length === 0) {
      toast({ title: "No active monitors", description: "Please activate your monitors to refresh them." });
      return;
    }

    toast({ title: "Refreshing...", description: `Checking ${activeMonitors.length} active monitors for changes.` });

    // Cap client-side concurrency so users with many monitors don't flood the
    // server (browser pool saturation, rate-limit bursts) or get spammed with
    // per-monitor toasts. See GitHub issue #431.
    const REFRESH_CONCURRENCY = 3;
    setIsBulkRefreshing(true);
    let changed = 0;
    let unchanged = 0;
    let failed = 0;
    let rateLimited = 0;

    // Fetch directly rather than via useCheckMonitorSilent: the hook's
    // onSuccess invalidates three query keys per resolved mutation, which
    // during a bulk run would fire 3×N invalidations and largely defeat the
    // concurrency cap with a refetch storm. We invalidate once at the end.
    // Also captures res.status on thrown errors so the summary toast can
    // classify 429s distinctly from genuine check failures — the regex
    // approach failed because the 429 body ("Free tier: You can check…")
    // doesn't contain "rate limit".
    const bulkCheckOne = async (id: number): Promise<{ changed: boolean }> => {
      const res = await fetch(buildUrl(api.monitors.check.path, { id }), {
        method: api.monitors.check.method,
        credentials: "include",
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const err = new Error(errorData.message || "Failed to check monitor") as Error & { status: number };
        err.status = res.status;
        throw err;
      }
      return api.monitors.check.responses[200].parse(await res.json().catch(() => {
        throw new Error("Unexpected response format from server");
      }));
    };

    try {
      for (let i = 0; i < activeMonitors.length; i += REFRESH_CONCURRENCY) {
        // If the user navigated away mid-refresh, stop issuing new batches.
        // In-flight requests continue (no AbortController plumbing yet) but
        // the orphaned-work blast radius is capped at one batch rather than
        // the full N monitors.
        if (!mountedRef.current) return;
        const batch = activeMonitors.slice(i, i + REFRESH_CONCURRENCY);
        const results = await Promise.allSettled(batch.map(m => bulkCheckOne(m.id)));
        for (const r of results) {
          if (r.status === "fulfilled") {
            if (r.value.changed) changed += 1; else unchanged += 1;
          } else {
            const status = (r.reason as { status?: number } | undefined)?.status;
            if (status === 429) rateLimited += 1; else failed += 1;
          }
        }
      }
    } finally {
      if (mountedRef.current) setIsBulkRefreshing(false);
    }

    // Single invalidation after the whole sweep (not per resolved check) —
    // every card re-renders once with fresh data instead of N times during
    // the sweep.
    if (changed + unchanged > 0) {
      queryClient.invalidateQueries({ queryKey: [api.monitors.list.path] });
    }

    if (!mountedRef.current) return;

    if (failed > 0 || rateLimited > 0) {
      const parts = [`${changed} changed`, `${unchanged} unchanged`];
      if (failed > 0) parts.push(`${failed} failed`);
      if (rateLimited > 0) parts.push(`${rateLimited} rate-limited`);
      const errorCount = failed + rateLimited;
      toast({
        variant: "destructive",
        title: `Refreshed with ${errorCount} error${errorCount === 1 ? "" : "s"}`,
        description: parts.join(", ") + ".",
      });
    } else {
      toast({
        title: changed > 0 ? `${changed} change${changed === 1 ? "" : "s"} detected` : "No changes",
        description: `${changed} changed, ${unchanged} unchanged.`,
      });
    }
  };

  if (isLoading && !monitors) {
    return (
      <div className="min-h-screen bg-background p-6 lg:p-10">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="flex justify-between items-center">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-10 w-32" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-64 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-destructive">Error Loading Dashboard</h2>
          <p className="text-muted-foreground">{error.message}</p>
          <Button onClick={() => refetch()}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav />

      {/* Temporary announcement banner for free tier upgrade */}
      {showBanner && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <Megaphone className="h-5 w-5 text-primary flex-shrink-0" />
            <p className="flex-1 text-sm">
              <strong>Great news!</strong> The free plan now includes <strong>3 monitors</strong> — up from 1. Start tracking more pages today!
            </p>
            <button
              onClick={() => {
                try { localStorage.setItem(BANNER_KEY, "1"); } catch {}
                setBannerDismissed(true);
              }}
              className="text-muted-foreground hover:text-foreground flex-shrink-0"
              aria-label="Dismiss announcement"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-muted-foreground">
                Manage your monitored pages and track detected changes.
              </p>
            </div>
            {/* Tier usage info */}
            {(() => {
              const tier = (user?.tier || "free") as UserTier;
              const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.free;
              const count = monitors?.length ?? 0;
              const isAtLimit = count >= limit;
              return (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant={tier === "free" ? "secondary" : "default"} className="capitalize">
                    {tier} Plan
                  </Badge>
                  <span className={`text-sm ${isAtLimit ? "text-destructive" : "text-muted-foreground"}`}>
                    {count} / {limit === Infinity ? "Unlimited" : limit} monitors used
                  </span>
                  {isAtLimit && tier !== "power" && (
                    <UpgradeDialog currentTier={tier}>
                      <Button variant="outline" size="sm" className="text-primary border-primary">
                        <Sparkles className="w-3 h-3 mr-1" />
                        Upgrade for more
                      </Button>
                    </UpgradeDialog>
                  )}
                  {tier !== "power" && !isAtLimit && (
                    <UpgradeDialog currentTier={tier}>
                      <Button variant="ghost" size="sm" className="text-muted-foreground">
                        <Sparkles className="w-3 h-3 mr-1" />
                        Upgrade
                      </Button>
                    </UpgradeDialog>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              disabled={isLoading || isChecking || isBulkRefreshing}
              title="Refresh all active monitors"
              data-testid="button-refresh"
            >
               {isLoading || isChecking || isBulkRefreshing ? (
                 <Loader2 className="h-4 w-4 animate-spin" />
               ) : (
                 <RefreshCw className="h-4 w-4" />
               )}
            </Button>
            <CreateMonitorDialog {...prefillDialogProps} />
          </div>
        </div>

        {/* Needs attention filter */}
        {monitors && monitors.length > 0 && (() => {
          const attentionCount = monitors.filter(m => needsAttention(m)).length;
          if (attentionCount === 0) return null;
          return (
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <button
                type="button"
                onClick={() => setNeedsAttentionFilter(false)}
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  !needsAttentionFilter
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/50 text-muted-foreground border-border/50 hover:bg-secondary"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setNeedsAttentionFilter(true)}
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  needsAttentionFilter
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
                    : "bg-secondary/50 text-muted-foreground border-border/50 hover:bg-secondary"
                }`}
              >
                Needs attention ({attentionCount})
              </button>
            </div>
          );
        })()}

        {/* Tag filter bar */}
        {userTags.length > 0 && monitors && monitors.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-6">
            <button
              type="button"
              onClick={() => setSelectedTagIds([])}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                selectedTagIds.length === 0
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary/50 text-muted-foreground border-border/50 hover:bg-secondary"
              }`}
            >
              All
            </button>
            {userTags.map((tag) => {
              const isActive = selectedTagIds.includes(tag.id);
              return (
                <button
                  type="button"
                  key={tag.id}
                  onClick={() => {
                    setSelectedTagIds(prev =>
                      isActive ? prev.filter(id => id !== tag.id) : [...prev, tag.id]
                    );
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    isActive
                      ? "bg-primary/10 text-foreground border-primary/30"
                      : "bg-secondary/50 text-muted-foreground border-border/50 hover:bg-secondary"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.colour }} />
                  {tag.name}
                </button>
              );
            })}
            <div className="ml-auto">
              <TagManager />
            </div>
          </div>
        )}
        {userTags.length === 0 && (TAG_LIMITS[userTier] ?? TAG_LIMITS.free) > 0 && monitors && monitors.length > 0 && (
          <div className="mb-6">
            <TagManager
              trigger={
                <Button variant="outline" size="sm" className="h-8 text-xs">
                  <Tags className="h-3.5 w-3.5 mr-1" />
                  Manage Tags
                </Button>
              }
            />
          </div>
        )}

        {(() => {
          const filteredMonitors = monitors?.filter(m => {
            if (selectedTagIds.length > 0 && !(m as any).tags?.some((t: any) => selectedTagIds.includes(t.id))) return false;
            if (needsAttentionFilter && !needsAttention(m)) return false;
            return true;
          });

          if (!monitors || monitors.length === 0) {
            return (
              <div className="border-2 border-dashed border-border rounded-xl p-12 text-center bg-card/30">
                <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <LayoutDashboard className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">No monitors yet</h3>
                <p className="text-muted-foreground max-w-sm mx-auto mb-6">
                  Start tracking web pages for changes by creating your first monitor. We'll notify you when content updates.
                </p>
                {/* Empty-state dialog is NOT externally controlled — the
                    header dialog above already auto-opens on prefill.
                    This instance can receive cached initialValues while
                    prefill is active, and clears cached prefill on close
                    to prevent stale extension values on later opens. */}
                <CreateMonitorDialog
                  initialValues={storedPrefill ?? undefined}
                  onExternalOpenChange={(v) => { if (!v) setStoredPrefill(null); }}
                />
              </div>
            );
          }

          return (
            <>
              {selectedTagIds.length > 0 && (
                <p className="text-sm text-muted-foreground mb-3">
                  Showing {filteredMonitors?.length ?? 0} of {monitors.length} monitors
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredMonitors?.map((monitor) => (
                  <MonitorCard key={monitor.id} monitor={monitor} />
                ))}
              </div>
            </>
          );
        })()}

        {/* API Keys section */}
        <div className="mt-10">
          <ApiKeysPanel />
        </div>
      </main>
    </div>
  );
}
