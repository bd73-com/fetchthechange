import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { type Monitor, insertMonitorSchema } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Clock, ExternalLink, Activity, ArrowRight, Bell, Edit2, Check, X, AlertTriangle, Inbox, Moon, Globe, MessageSquare, ShieldAlert } from "lucide-react";
import { useUpdateMonitor, useMonitorHistory } from "@/hooks/use-monitors";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";
import { useNotificationChannels } from "@/hooks/use-notification-channels";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { TagBadge } from "@/components/TagBadge";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { detectBotProtectedUrl } from "@/lib/bot-protection";
import { type HealthState, getHealthState } from "@/lib/monitor-health";
import { useAuth } from "@/hooks/use-auth";
import { FREQUENCY_TIERS, type UserTier } from "@shared/models/auth";

const healthDotStyles: Record<HealthState, string> = {
  healthy: "bg-green-500",
  degraded: "bg-amber-500",
  paused: "bg-red-500",
};

function getHealthTooltip(monitor: Monitor, state: HealthState): string {
  if (state === "healthy") return "Checks passing";
  if (state === "degraded") return `${monitor.consecutiveFailures} consecutive failure${monitor.consecutiveFailures === 1 ? "" : "s"} — monitoring continues`;
  if (monitor.pauseReason) {
    return monitor.pauseReason.length > 80 ? monitor.pauseReason.slice(0, 80) + "\u2026" : monitor.pauseReason;
  }
  return "Paused";
}

interface MonitorCardProps {
  monitor: Monitor & { tags?: { id: number; name: string; colour: string }[] };
}

export function MonitorCard({ monitor }: MonitorCardProps) {
  const { mutate: update } = useUpdateMonitor();
  const { user } = useAuth();
  const userTier = ((user as any)?.tier || "free") as UserTier;
  const { data: history } = useMonitorHistory(monitor.id);
  const { data: prefs } = useNotificationPreferences(monitor.id);
  const { data: channels = [] } = useNotificationChannels(monitor.id);
  const hasWebhook = channels.some((c) => c.channel === "webhook" && c.enabled);
  const hasSlack = channels.some((c) => c.channel === "slack" && c.enabled);
  const [isEditing, setIsEditing] = useState(false);
  const [editBotWarning, setEditBotWarning] = useState<string | null>(null);

  const lastChange = history?.[0];
  const previousValue = lastChange?.oldValue;

  const form = useForm({
    resolver: zodResolver(insertMonitorSchema),
    defaultValues: {
      name: monitor.name,
      url: monitor.url,
      selector: monitor.selector,
      frequency: monitor.frequency,
      emailEnabled: monitor.emailEnabled,
      active: monitor.active,
    },
  });

  const toggleActive = (active: boolean) => {
    update({ id: monitor.id, active });
  };

  const onSubmit = (data: any) => {
    // Ensure bot-protection warning is visible even if onBlur never fired (e.g. paste-and-save)
    setEditBotWarning(detectBotProtectedUrl(data.url));
    update({ id: monitor.id, ...data }, {
      onSuccess: () => {
        setEditBotWarning(null);
        setIsEditing(false);
      }
    });
  };

  if (isEditing) {
    return (
      <Card className="overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Edit Monitor</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-name" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        data-testid="input-url"
                        onBlur={(e) => { field.onBlur(); setEditBotWarning(detectBotProtectedUrl(e.target.value)); }}
                        onChange={(e) => { field.onChange(e); setEditBotWarning(null); }}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              {editBotWarning && (
                <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400">
                  <ShieldAlert className="h-4 w-4 text-amber-500" aria-hidden="true" />
                  <AlertDescription className="text-xs leading-relaxed">
                    {editBotWarning}
                  </AlertDescription>
                </Alert>
              )}
              <FormField
                control={form.control}
                name="selector"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Selector</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-selector" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frequency</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="select-frequency"
                      >
                        <option value="daily">Daily</option>
                        {(FREQUENCY_TIERS.hourly as readonly string[]).includes(userTier) ? (
                          <option value="hourly">Hourly</option>
                        ) : (
                          <option value="hourly" disabled>Hourly (Pro)</option>
                        )}
                      </select>
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="flex items-center justify-between py-2">
                <FormField
                  control={form.control}
                  name="emailEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm w-full">
                      <div className="space-y-0.5">
                        <FormLabel>Email Notifications</FormLabel>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-email"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex gap-2 justify-end pt-4">
                <Button type="button" variant="outline" size="sm" onClick={() => { setEditBotWarning(null); setIsEditing(false); }} data-testid="button-cancel">
                  <X className="h-4 w-4 mr-2" /> Cancel
                </Button>
                <Button type="submit" size="sm" data-testid="button-save">
                  <Check className="h-4 w-4 mr-2" /> Save
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-hover overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm relative group">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-xl font-semibold line-clamp-1 flex items-center gap-2" title={monitor.name}>
            {(() => {
              const health = getHealthState(monitor);
              return (
                <>
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${healthDotStyles[health]}`}
                    title={getHealthTooltip(monitor, health)}
                    aria-label={getHealthTooltip(monitor, health)}
                    role="status"
                  />
                  {monitor.name}
                  {health === "degraded" && (
                    <span className="text-xs font-medium text-amber-500">({monitor.consecutiveFailures})</span>
                  )}
                </>
              );
            })()}
          </CardTitle>
          <a
            href={monitor.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
          >
            {new URL(monitor.url).hostname}
            <ExternalLink className="h-3 w-3" />
          </a>
          {monitor.tags && monitor.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {monitor.tags.slice(0, 2).map((tag) => (
                <TagBadge key={tag.id} tag={tag} />
              ))}
              {monitor.tags.length > 2 && (
                <span className="inline-flex items-center rounded-full bg-secondary/50 px-2 py-0.5 text-xs text-muted-foreground">
                  +{monitor.tags.length - 2} more
                </span>
              )}
            </div>
          )}
          {monitor.lastStatus === "blocked" && (monitor.consecutiveFailures ?? 0) >= 2 && (
            <div className="flex items-center gap-1.5 pt-0.5" role="status" aria-live="polite">
              <ShieldAlert className="h-3 w-3 text-orange-500 shrink-0" aria-hidden="true" />
              <span className="text-xs font-medium text-orange-500">
                Bot blocked — site is resisting automated access
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
           {monitor.emailEnabled && (
             <span title="Email alerts enabled">
               <Bell className="h-4 w-4 text-primary opacity-50" />
             </span>
           )}
           {prefs?.quietHoursStart && prefs?.quietHoursEnd && (
             <span title={`Quiet hours: ${prefs.quietHoursStart} - ${prefs.quietHoursEnd}`}>
               <Moon className="h-4 w-4 text-muted-foreground opacity-50" />
             </span>
           )}
           {prefs?.digestMode && (
             <span title="Daily digest enabled">
               <Inbox className="h-4 w-4 text-muted-foreground opacity-50" />
             </span>
           )}
           {hasWebhook && (
             <span title="Webhook enabled">
               <Globe className="h-4 w-4 text-muted-foreground opacity-50" />
             </span>
           )}
           {hasSlack && (
             <span title="Slack enabled">
               <MessageSquare className="h-4 w-4 text-muted-foreground opacity-50" />
             </span>
           )}
          <Switch checked={monitor.active} onCheckedChange={toggleActive} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {monitor.pauseReason && (
          <div role="alert" className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{monitor.pauseReason}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-1">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Last Checked
            </span>
            <p className="font-medium">
              {monitor.lastChecked
                ? formatDistanceToNow(new Date(monitor.lastChecked), { addSuffix: true })
                : "Never"}
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Last Change
            </span>
            <p className="font-medium text-amber-600 dark:text-amber-400">
              {monitor.lastChanged
                ? formatDistanceToNow(new Date(monitor.lastChanged), { addSuffix: true })
                : "No changes yet"}
            </p>
          </div>
        </div>
        
        <div className="pt-2">
          <div className="flex flex-col gap-1.5 bg-secondary/30 p-3 rounded-lg border border-border/50 font-mono">
             <div className="flex items-center justify-between">
               <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Current</span>
               <span className="text-xs font-bold text-primary truncate max-w-[150px]" title={monitor.currentValue || "No value detected"}>
                 {monitor.currentValue || "---"}
               </span>
             </div>
             {monitor.lastChanged && (
               <div className="flex items-center justify-between border-t border-border/20 pt-1.5 mt-0.5">
                 <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Previous</span>
                 <span className="text-xs text-muted-foreground truncate max-w-[150px]" title={previousValue || "No previous value"}>
                   {previousValue || "---"}
                 </span>
               </div>
             )}
          </div>
        </div>
      </CardContent>
      <CardFooter className="bg-muted/30 p-4 border-t border-border/50">
        <Link href={`/monitors/${monitor.id}`} className="w-full">
          <Button variant="ghost" className="w-full justify-between group hover:bg-primary/5 hover:text-primary">
            View Details
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
