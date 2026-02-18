import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Send,
  Mail,
  Eye,
  MousePointerClick,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Ban,
  Loader2,
} from "lucide-react";
import { Link, useParams } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import DashboardNav from "@/components/DashboardNav";
import { useCampaignAnalytics, useCancelCampaign } from "@/hooks/use-campaigns";

const statusConfig: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
  draft: { variant: "outline", label: "Draft" },
  sending: { variant: "secondary", label: "Sending" },
  sent: { variant: "default", label: "Sent" },
  partially_sent: { variant: "secondary", label: "Partially Sent" },
  cancelled: { variant: "destructive", label: "Cancelled" },
};

const recipientStatusConfig: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
  pending: { variant: "outline", label: "Pending" },
  sent: { variant: "secondary", label: "Sent" },
  delivered: { variant: "default", label: "Delivered" },
  opened: { variant: "default", label: "Opened" },
  clicked: { variant: "default", label: "Clicked" },
  bounced: { variant: "destructive", label: "Bounced" },
  complained: { variant: "destructive", label: "Complained" },
  failed: { variant: "destructive", label: "Failed" },
};

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRate(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

export default function AdminCampaignDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data, isLoading } = useCampaignAnalytics(id);
  const cancelCampaign = useCancelCampaign();

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardNav />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Skeleton className="h-8 w-64 mb-6" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </main>
      </div>
    );
  }

  const { campaign, recipientBreakdown, recipients } = data;
  const config = statusConfig[campaign.status] || statusConfig.draft;

  const funnelData = [
    { name: "Sent", value: campaign.sentCount, color: "#6366f1" },
    { name: "Delivered", value: campaign.deliveredCount, color: "#8b5cf6" },
    { name: "Opened", value: campaign.openedCount, color: "#a78bfa" },
    { name: "Clicked", value: campaign.clickedCount, color: "#c4b5fd" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/campaigns">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{campaign.name}</h1>
              <p className="text-sm text-muted-foreground mt-1">{campaign.subject}</p>
            </div>
            <Badge variant={config.variant} className="ml-2">
              {config.label}
            </Badge>
          </div>
          {campaign.status === "sending" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Ban className="h-4 w-4 mr-2" />
                  Cancel Send
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel Campaign?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will stop sending remaining emails. Emails already sent cannot be recalled.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep Sending</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => cancelCampaign.mutate(id)}
                    disabled={cancelCampaign.isPending}
                  >
                    {cancelCampaign.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Cancel Campaign
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Users className="h-4 w-4" />
                Total
              </div>
              <div className="text-2xl font-bold">{campaign.totalRecipients}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <CheckCircle className="h-4 w-4" />
                Delivered
              </div>
              <div className="text-2xl font-bold">{campaign.deliveredCount}</div>
              <div className="text-xs text-muted-foreground">
                {formatRate(campaign.deliveredCount, campaign.sentCount)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Eye className="h-4 w-4" />
                Opened
              </div>
              <div className="text-2xl font-bold">{campaign.openedCount}</div>
              <div className="text-xs text-muted-foreground">
                {formatRate(campaign.openedCount, campaign.sentCount)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <MousePointerClick className="h-4 w-4" />
                Clicked
              </div>
              <div className="text-2xl font-bold">{campaign.clickedCount}</div>
              <div className="text-xs text-muted-foreground">
                {formatRate(campaign.clickedCount, campaign.sentCount)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <XCircle className="h-4 w-4" />
                Failed
              </div>
              <div className="text-2xl font-bold">{campaign.failedCount}</div>
              <div className="text-xs text-muted-foreground">
                {formatRate(campaign.failedCount, campaign.totalRecipients)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Funnel Chart */}
        {campaign.sentCount > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-sm">Delivery Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelData} layout="horizontal">
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis dataKey="name" stroke="#888" fontSize={12} />
                    <YAxis stroke="#888" fontSize={12} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #333", borderRadius: "6px" }}
                      labelStyle={{ color: "#ccc" }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {funnelData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recipients Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Recipients ({data.pagination.total})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recipients.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-3 opacity-50" />
                <p>No recipients yet.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead>Delivered</TableHead>
                    <TableHead>Opened</TableHead>
                    <TableHead>Clicked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.map((r) => {
                    const rConfig = recipientStatusConfig[r.status] || recipientStatusConfig.pending;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{r.recipientEmail}</TableCell>
                        <TableCell>
                          <Badge variant={rConfig.variant} className="text-xs">
                            {rConfig.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(r.sentAt as any)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(r.deliveredAt as any)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(r.openedAt as any)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(r.clickedAt as any)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
