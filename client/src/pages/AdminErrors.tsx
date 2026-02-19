import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { XCircle, AlertTriangle, Info, ArrowLeft, RefreshCw, Globe, Mail, Users } from "lucide-react";
import { Link } from "wouter";
import { queryClient } from "@/lib/queryClient";

interface ErrorLogEntry {
  id: number;
  timestamp: string;
  level: string;
  source: string;
  error_type: string | null;
  message: string;
  stack_trace: string | null;
  context: any;
  resolved: boolean;
}

interface BrowserlessUsageData {
  systemUsage: number;
  systemCap: number;
  tierCaps: { free: number; pro: number; power: number };
  topConsumers: Array<{ userId: string; callCount: number }>;
  tierBreakdown: Record<string, { users: number; totalCalls: number }>;
  resetDate: string;
}

interface ResendUsageData {
  dailyUsage: number;
  dailyCap: number;
  monthlyUsage: number;
  monthlyCap: number;
  failedThisMonth: number;
  recentHistory: Array<{ date: string; count: number }>;
  resetDate: string;
}

interface UserOverviewEntry {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
  tier: string;
  created_at: string | null;
  updated_at: string | null;
  monitor_count: number;
  active_monitor_count: number;
  last_activity: string | null;
  browserless_usage_this_month: number;
  emails_sent_this_month: number;
}

const levelConfig: Record<string, { icon: typeof XCircle; variant: "destructive" | "secondary" | "outline"; label: string }> = {
  error: { icon: XCircle, variant: "destructive", label: "Error" },
  warning: { icon: AlertTriangle, variant: "secondary", label: "Warning" },
  info: { icon: Info, variant: "outline", label: "Info" },
};

export default function AdminErrors() {
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: browserlessData } = useQuery<BrowserlessUsageData>({
    queryKey: ["/api/admin/browserless-usage"],
    queryFn: async () => {
      const res = await fetch("/api/admin/browserless-usage", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: resendData } = useQuery<ResendUsageData>({
    queryKey: ["/api/admin/resend-usage"],
    queryFn: async () => {
      const res = await fetch("/api/admin/resend-usage", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: usersOverview } = useQuery<UserOverviewEntry[]>({
    queryKey: ["/api/admin/users-overview"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users-overview", { credentials: "include" });
      if (res.status === 403) {
        const err = new Error("forbidden");
        (err as any).status = 403;
        throw err;
      }
      if (!res.ok) return null;
      return res.json();
    },
    retry: (_count, error) => (error as any)?.status !== 403,
    refetchInterval: (query) =>
      (query.state.error as any)?.status === 403 ? false : 60000,
  });

  const queryKey = ["/api/admin/error-logs", levelFilter, sourceFilter];
  const { data: logs = [], isLoading, isFetching, isError } = useQuery<ErrorLogEntry[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (levelFilter !== "all") params.set("level", levelFilter);
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      params.set("limit", "100");
      const res = await fetch(`/api/admin/error-logs?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch logs");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const formatTimestamp = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString();
  };

  const getTierBadgeClass = (tier: string) => {
    switch (tier) {
      case "power": return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
      case "pro": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300";
    }
  };

  const formatRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild data-testid="button-back-dashboard">
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-2xl font-bold" data-testid="text-admin-title">Event Log</h1>
            <Badge variant="secondary">{logs.length} entries</Badge>
          </div>
          <div className="flex items-center gap-3">
            <Select value={levelFilter} onValueChange={setLevelFilter} data-testid="select-level-filter">
              <SelectTrigger className="w-[140px]" data-testid="button-level-filter">
                <SelectValue placeholder="Filter level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="error">Errors</SelectItem>
                <SelectItem value="warning">Warnings</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter} data-testid="select-source-filter">
              <SelectTrigger className="w-[140px]" data-testid="button-source-filter">
                <SelectValue placeholder="Filter category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem value="scraper">Scraper</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="scheduler">Scheduler</SelectItem>
                <SelectItem value="api">API</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey });
                queryClient.invalidateQueries({ queryKey: ["/api/admin/browserless-usage"] });
                queryClient.invalidateQueries({ queryKey: ["/api/admin/resend-usage"] });
                queryClient.invalidateQueries({ queryKey: ["/api/admin/users-overview"] });
              }}
              disabled={isFetching}
              data-testid="button-refresh-logs"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {usersOverview && usersOverview.length > 0 && (
          <Card className="mb-6" data-testid="card-users-overview">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                User Overview
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {usersOverview.length} user{usersOverview.length !== 1 ? "s" : ""}
              </span>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">User</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead className="text-right">Monitors</TableHead>
                      <TableHead className="text-right">Browserless</TableHead>
                      <TableHead className="text-right">Emails</TableHead>
                      <TableHead className="text-right">Last Active</TableHead>
                      <TableHead className="text-right">Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usersOverview.map((u) => (
                      <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                        <TableCell className="font-medium">
                          <div className="flex flex-col">
                            <span className="truncate max-w-[180px]">
                              {u.first_name || u.last_name
                                ? `${u.first_name || ""} ${u.last_name || ""}`.trim()
                                : u.email || u.id.slice(0, 8) + "..."}
                            </span>
                            {(u.first_name || u.last_name) && u.email && (
                              <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                                {u.email}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={getTierBadgeClass(u.tier)}
                            data-testid={`badge-tier-${u.id}`}
                          >
                            {u.tier}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          <span data-testid={`text-monitors-${u.id}`}>
                            {u.active_monitor_count}/{u.monitor_count}
                          </span>
                          <span className="text-xs text-muted-foreground ml-1">active</span>
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid={`text-browserless-${u.id}`}>
                          {u.browserless_usage_this_month}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid={`text-emails-${u.id}`}>
                          {u.emails_sent_this_month}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {formatRelativeTime(u.last_activity)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {u.created_at
                            ? new Date(u.created_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {browserlessData && (
          <Card className="mb-6" data-testid="card-browserless-usage">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Browserless Usage
              </CardTitle>
              <span className="text-xs text-muted-foreground">Resets {browserlessData.resetDate}</span>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span data-testid="text-system-usage-label">System Usage</span>
                  <span className="font-mono" data-testid="text-system-usage-value">
                    {browserlessData.systemUsage} / {browserlessData.systemCap}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden" data-testid="progress-system-usage">
                  <div
                    className={`h-full rounded-full transition-all ${
                      browserlessData.systemUsage / browserlessData.systemCap > 0.95
                        ? "bg-destructive"
                        : browserlessData.systemUsage / browserlessData.systemCap > 0.8
                        ? "bg-orange-500 dark:bg-orange-400"
                        : "bg-primary"
                    }`}
                    style={{ width: `${Math.min(100, (browserlessData.systemUsage / browserlessData.systemCap) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {(["pro", "power"] as const).map((tier) => {
                  const data = browserlessData.tierBreakdown[tier];
                  return (
                    <div key={tier} className="text-center" data-testid={`text-tier-breakdown-${tier}`}>
                      <p className="text-xs text-muted-foreground capitalize">{tier}</p>
                      <p className="text-lg font-semibold">{data?.totalCalls ?? 0}</p>
                      <p className="text-xs text-muted-foreground">{data?.users ?? 0} users</p>
                    </div>
                  );
                })}
                <div className="text-center" data-testid="text-tier-caps">
                  <p className="text-xs text-muted-foreground">Per-User Caps</p>
                  <p className="text-xs mt-1">Pro: {browserlessData.tierCaps.pro}</p>
                  <p className="text-xs">Power: {browserlessData.tierCaps.power}</p>
                </div>
              </div>
              {browserlessData.topConsumers.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Top Consumers</p>
                  <div className="space-y-1">
                    {browserlessData.topConsumers.slice(0, 5).map((c, i) => (
                      <div key={c.userId} className="flex justify-between text-xs" data-testid={`text-consumer-${c.userId}`}>
                        <span className="text-muted-foreground truncate max-w-[200px]">
                          {i + 1}. {c.userId}
                        </span>
                        <span className="font-mono">{c.callCount} calls</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {resendData && (
          <Card className="mb-6" data-testid="card-resend-usage">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Resend Email Usage
              </CardTitle>
              <span className="text-xs text-muted-foreground">Resets {resendData.resetDate}</span>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span data-testid="text-resend-daily-label">Daily</span>
                    <span className="font-mono" data-testid="text-resend-daily-value">
                      {resendData.dailyUsage} / {resendData.dailyCap}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden" data-testid="progress-resend-daily">
                    <div
                      className={`h-full rounded-full transition-all ${
                        resendData.dailyUsage / resendData.dailyCap > 0.95
                          ? "bg-destructive"
                          : resendData.dailyUsage / resendData.dailyCap > 0.8
                          ? "bg-orange-500 dark:bg-orange-400"
                          : "bg-primary"
                      }`}
                      style={{ width: `${Math.min(100, (resendData.dailyUsage / resendData.dailyCap) * 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span data-testid="text-resend-monthly-label">Monthly</span>
                    <span className="font-mono" data-testid="text-resend-monthly-value">
                      {resendData.monthlyUsage} / {resendData.monthlyCap}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden" data-testid="progress-resend-monthly">
                    <div
                      className={`h-full rounded-full transition-all ${
                        resendData.monthlyUsage / resendData.monthlyCap > 0.95
                          ? "bg-destructive"
                          : resendData.monthlyUsage / resendData.monthlyCap > 0.8
                          ? "bg-orange-500 dark:bg-orange-400"
                          : "bg-primary"
                      }`}
                      style={{ width: `${Math.min(100, (resendData.monthlyUsage / resendData.monthlyCap) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
              {resendData.failedThisMonth > 0 && (
                <div className="text-xs text-muted-foreground" data-testid="text-resend-failed">
                  {resendData.failedThisMonth} failed this month
                </div>
              )}
              {resendData.recentHistory.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Last 7 Days</p>
                  <div className="flex items-end gap-1 h-12">
                    {resendData.recentHistory.slice().reverse().map((day) => {
                      const maxCount = Math.max(...resendData.recentHistory.map(d => d.count), 1);
                      const heightPct = Math.max(4, (day.count / maxCount) * 100);
                      return (
                        <div key={day.date} className="flex-1 flex flex-col items-center gap-1" data-testid={`bar-resend-${day.date}`}>
                          <div
                            className="w-full bg-primary/60 rounded-sm min-w-[4px]"
                            style={{ height: `${heightPct}%` }}
                            title={`${day.date}: ${day.count} emails`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-1 mt-1">
                    {resendData.recentHistory.slice().reverse().map((day) => (
                      <div key={day.date} className="flex-1 text-center">
                        <span className="text-[10px] text-muted-foreground">{day.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading logs...</div>
        ) : isError ? (
          <div className="text-center py-12 text-muted-foreground">Failed to load event log.</div>
        ) : logs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No log entries found.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => {
              const config = levelConfig[log.level] || levelConfig.info;
              const Icon = config.icon;
              const isExpanded = expandedId === log.id;

              return (
                <Card
                  key={log.id}
                  className="hover-elevate cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  data-testid={`card-log-${log.id}`}
                >
                  <CardContent className="py-3 px-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${log.level === "error" ? "text-destructive" : log.level === "warning" ? "text-yellow-500" : "text-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <Badge variant={config.variant} data-testid={`badge-level-${log.id}`}>
                            {config.label}
                          </Badge>
                          <Badge variant="outline" data-testid={`badge-source-${log.id}`}>
                            {log.source}
                          </Badge>
                          {log.error_type && (
                            <span className="text-xs text-muted-foreground">{log.error_type}</span>
                          )}
                          <span className="text-xs text-muted-foreground ml-auto shrink-0">
                            {formatTimestamp(log.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm truncate" data-testid={`text-message-${log.id}`}>
                          {log.message}
                        </p>
                        {isExpanded && (
                          <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                            {log.stack_trace && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">Stack Trace</p>
                                <pre className="text-xs bg-secondary/50 p-3 rounded-md overflow-x-auto max-h-48 overflow-y-auto select-text">
                                  {log.stack_trace}
                                </pre>
                              </div>
                            )}
                            {log.context && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">Context</p>
                                <pre className="text-xs bg-secondary/50 p-3 rounded-md overflow-x-auto max-h-32 overflow-y-auto select-text">
                                  {JSON.stringify(log.context, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
