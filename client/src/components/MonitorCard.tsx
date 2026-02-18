import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { type Monitor, insertMonitorSchema } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Clock, ExternalLink, Activity, ArrowRight, Bell, Edit2, Check, X } from "lucide-react";
import { useUpdateMonitor, useMonitorHistory } from "@/hooks/use-monitors";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";

interface MonitorCardProps {
  monitor: Monitor;
}

export function MonitorCard({ monitor }: MonitorCardProps) {
  const { mutate: update } = useUpdateMonitor();
  const { data: history } = useMonitorHistory(monitor.id);
  const [isEditing, setIsEditing] = useState(false);

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
    update({ id: monitor.id, ...data }, {
      onSuccess: () => setIsEditing(false)
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
                      <Input {...field} data-testid="input-url" />
                    </FormControl>
                  </FormItem>
                )}
              />
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
                        <option value="hourly">Hourly</option>
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
                <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(false)} data-testid="button-cancel">
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
          <CardTitle className="text-xl font-semibold line-clamp-1" title={monitor.name}>
            {monitor.name}
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
        </div>
        <div className="flex items-center gap-2">
           {monitor.emailEnabled && (
             <span title="Email alerts enabled">
               <Bell className="h-4 w-4 text-primary opacity-50" />
             </span>
           )}
          <Switch checked={monitor.active} onCheckedChange={toggleActive} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
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
