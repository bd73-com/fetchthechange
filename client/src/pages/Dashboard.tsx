import { useAuth } from "@/hooks/use-auth";
import { useMonitors, useCheckMonitor } from "@/hooks/use-monitors";
import { CreateMonitorDialog } from "@/components/CreateMonitorDialog";
import { MonitorCard } from "@/components/MonitorCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LogOut, LayoutDashboard, RefreshCw, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { TIER_LIMITS, type UserTier } from "@shared/models/auth";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { data: monitors, isLoading, error, refetch } = useMonitors();
  const { mutate: checkMonitor, isPending: isChecking } = useCheckMonitor();
  const { toast } = useToast();

  const handleRefresh = async () => {
    console.log("Refreshing monitors...");
    // First refetch the list
    await refetch();
    
    if (!monitors || monitors.length === 0) {
      toast({ title: "No monitors", description: "Create a monitor first to refresh data." });
      return;
    }
    
    // Refresh all active monitors in parallel
    const activeMonitors = monitors.filter(m => m.active);
    if (activeMonitors.length === 0) {
      toast({ title: "No active monitors", description: "Please activate your monitors to refresh them." });
      return;
    }

    toast({ title: "Refreshing...", description: `Checking ${activeMonitors.length} active monitors for changes.` });
    
    activeMonitors.forEach(m => {
      checkMonitor(m.id);
    });
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
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-display font-bold">FetchTheChange</h1>
            <span className="hidden md:inline text-sm text-muted-foreground">- Reliable change monitoring for the modern web</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-sm text-muted-foreground">
              Welcome, <span className="font-medium text-foreground">{user?.firstName || user?.email}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => logout()} className="text-muted-foreground hover:text-destructive">
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

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
              const tier = ((user as any)?.tier || "free") as UserTier;
              const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.free;
              const count = monitors?.length ?? 0;
              const isAtLimit = count >= limit;
              return (
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant={tier === "free" ? "secondary" : "default"} className="capitalize">
                    {tier} Plan
                  </Badge>
                  <span className={`text-sm ${isAtLimit ? "text-destructive" : "text-muted-foreground"}`}>
                    {count} / {limit === Infinity ? "Unlimited" : limit} monitors used
                  </span>
                  {isAtLimit && (
                    <span className="text-sm text-destructive font-medium">
                      (limit reached)
                    </span>
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
              disabled={isLoading || isChecking}
              title="Refresh all active monitors"
              data-testid="button-refresh"
            >
               {isLoading || isChecking ? (
                 <Loader2 className="h-4 w-4 animate-spin" />
               ) : (
                 <RefreshCw className="h-4 w-4" />
               )}
            </Button>
            <CreateMonitorDialog />
          </div>
        </div>

        {monitors?.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-xl p-12 text-center bg-card/30">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <LayoutDashboard className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No monitors yet</h3>
            <p className="text-muted-foreground max-w-sm mx-auto mb-6">
              Start tracking web pages for changes by creating your first monitor. We'll notify you when content updates.
            </p>
            <CreateMonitorDialog />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {monitors?.map((monitor) => (
              <MonitorCard key={monitor.id} monitor={monitor} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
