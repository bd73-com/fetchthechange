import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { XCircle, AlertTriangle, Info, ArrowLeft, RefreshCw, Globe } from "lucide-react";
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

  const queryKey = ["/api/admin/error-logs", levelFilter, sourceFilter];
  const { data: logs = [], isLoading, isError } = useQuery<ErrorLogEntry[]>({
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
              onClick={() => queryClient.invalidateQueries({ queryKey })}
              data-testid="button-refresh-logs"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

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
