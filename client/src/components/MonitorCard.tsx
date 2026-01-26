import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { type Monitor } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Clock, ExternalLink, Activity, ArrowRight, Bell } from "lucide-react";
import { useUpdateMonitor } from "@/hooks/use-monitors";

interface MonitorCardProps {
  monitor: Monitor;
}

export function MonitorCard({ monitor }: MonitorCardProps) {
  const { mutate: update } = useUpdateMonitor();

  const toggleActive = (active: boolean) => {
    update({ id: monitor.id, active });
  };

  return (
    <Card className="card-hover overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm">
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
             <Bell className="h-4 w-4 text-primary opacity-50" title="Email alerts enabled" />
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/50 p-2 rounded-md font-mono border border-border/50">
             <span className="font-bold">Selector:</span> {monitor.selector}
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
