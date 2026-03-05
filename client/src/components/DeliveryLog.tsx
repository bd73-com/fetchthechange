import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Mail, Globe, MessageSquare } from "lucide-react";
import { useDeliveryLog } from "@/hooks/use-notification-channels";

interface DeliveryLogProps {
  monitorId: number;
}

const channelIcons: Record<string, typeof Mail> = {
  email: Mail,
  webhook: Globe,
  slack: MessageSquare,
};

const statusColors: Record<string, string> = {
  success: "bg-green-500/10 text-green-500 border-green-500/20",
  failed: "bg-red-500/10 text-red-500 border-red-500/20",
  pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
};

export function DeliveryLog({ monitorId }: DeliveryLogProps) {
  const [channelFilter, setChannelFilter] = useState<string | undefined>();
  const { data: entries = [], isLoading } = useDeliveryLog(monitorId, channelFilter);

  if (isLoading) return null;
  if (entries.length === 0 && !channelFilter) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Delivery Log</CardTitle>
          <div className="flex gap-1">
            <Button
              variant={channelFilter === undefined ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setChannelFilter(undefined)}
            >
              All
            </Button>
            {["email", "webhook", "slack"].map((ch) => {
              const Icon = channelIcons[ch];
              return (
                <Button
                  key={ch}
                  variant={channelFilter === ch ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setChannelFilter(ch)}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const Icon = channelIcons[entry.channel] || Mail;
              const response = entry.response as Record<string, unknown> | null;
              return (
                <TableRow key={entry.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm capitalize">{entry.channel}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusColors[entry.status] || ""}>
                      {entry.status}
                      {entry.attempt > 1 && ` (attempt ${entry.attempt})`}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-48 truncate">
                    {response?.error ? String(response.error) : response?.statusCode ? `HTTP ${response.statusCode}` : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No deliveries found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
