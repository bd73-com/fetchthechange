import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  ArrowLeft,
  Plus,
  Send,
  Mail,
  Eye,
  MousePointerClick,
  Users,
  BarChart3,
  Trash2,
  TestTube,
  Loader2,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import DashboardNav from "@/components/DashboardNav";
import {
  useCampaigns,
  useCampaignDashboard,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
  usePreviewRecipients,
  useSendTestCampaign,
  useSendCampaign,
} from "@/hooks/use-campaigns";
import type { Campaign } from "@shared/schema";

const statusConfig: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
  draft: { variant: "outline", label: "Draft" },
  sending: { variant: "secondary", label: "Sending" },
  sent: { variant: "default", label: "Sent" },
  partially_sent: { variant: "secondary", label: "Partial" },
  cancelled: { variant: "destructive", label: "Cancelled" },
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRate(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

interface CampaignFilters {
  tier?: string[];
  signupBefore?: string;
  signupAfter?: string;
  minMonitors?: number;
  maxMonitors?: number;
  hasActiveMonitors?: boolean;
}

function CreateCampaignDialog() {
  const [open, setOpen] = useState(false);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [textBody, setTextBody] = useState("");
  const [filters, setFilters] = useState<CampaignFilters>({});
  const [previewResult, setPreviewResult] = useState<{
    count: number;
    users: Array<{ id: string; email: string; firstName: string | null; tier: string; monitorCount: number }>;
  } | null>(null);
  const [createdCampaignId, setCreatedCampaignId] = useState<number | null>(null);

  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const previewRecipients = usePreviewRecipients();
  const sendTestCampaign = useSendTestCampaign();
  const sendCampaign = useSendCampaign();

  const resetForm = () => {
    setName("");
    setSubject("");
    setHtmlBody("");
    setTextBody("");
    setFilters({});
    setPreviewResult(null);
    setCreatedCampaignId(null);
  };

  const handleSaveDraft = async () => {
    if (createdCampaignId) {
      // Update existing draft instead of creating a duplicate
      await updateCampaign.mutateAsync({
        id: createdCampaignId,
        name,
        subject,
        htmlBody,
        textBody: textBody || undefined,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      });
    } else {
      const result = await createCampaign.mutateAsync({
        name,
        subject,
        htmlBody,
        textBody: textBody || undefined,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      });
      setCreatedCampaignId(result.id);
    }
  };

  const handlePreview = async () => {
    if (!createdCampaignId) {
      // Save first
      const result = await createCampaign.mutateAsync({
        name,
        subject,
        htmlBody,
        textBody: textBody || undefined,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      });
      setCreatedCampaignId(result.id);
      const preview = await previewRecipients.mutateAsync({ id: result.id, filters });
      setPreviewResult(preview);
    } else {
      const preview = await previewRecipients.mutateAsync({ id: createdCampaignId, filters });
      setPreviewResult(preview);
    }
  };

  const handleSendTest = async () => {
    if (!createdCampaignId) return;
    await sendTestCampaign.mutateAsync({ id: createdCampaignId });
  };

  const handleSendCampaign = async () => {
    if (!createdCampaignId) return;
    await sendCampaign.mutateAsync(createdCampaignId);
    setConfirmSendOpen(false);
    setOpen(false);
    resetForm();
  };

  const handleTierToggle = (tier: string, checked: boolean) => {
    const current = filters.tier || [];
    setFilters({
      ...filters,
      tier: checked ? [...current, tier] : current.filter((t) => t !== tier),
    });
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) resetForm();
        }}
      >
        <DialogTrigger asChild>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Campaign
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Email Campaign</DialogTitle>
            <DialogDescription>Compose an email to send to your users.</DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Basic fields */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="campaign-name">Campaign Name</Label>
                <Input
                  id="campaign-name"
                  placeholder="e.g., Free Tier Survey Q1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="campaign-subject">Email Subject</Label>
                <Input
                  id="campaign-subject"
                  placeholder="e.g., We'd love your feedback"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            </div>

            {/* HTML Body */}
            <div>
              <Label htmlFor="campaign-html">HTML Body</Label>
              <Textarea
                id="campaign-html"
                placeholder="<h2>Hello!</h2><p>We'd love to hear from you...</p>"
                value={htmlBody}
                onChange={(e) => setHtmlBody(e.target.value)}
                className="font-mono text-sm min-h-[200px]"
                rows={12}
              />
            </div>

            {/* Plain text fallback */}
            <div>
              <Label htmlFor="campaign-text">Plain Text Body (optional)</Label>
              <Textarea
                id="campaign-text"
                placeholder="Hello! We'd love to hear from you..."
                value={textBody}
                onChange={(e) => setTextBody(e.target.value)}
                className="text-sm min-h-[80px]"
                rows={4}
              />
            </div>

            {/* Filters */}
            <div>
              <Label className="text-base font-semibold">Recipient Filters</Label>
              <div className="mt-3 space-y-4 rounded-lg border p-4">
                <div>
                  <Label className="text-sm text-muted-foreground">Target Tiers</Label>
                  <div className="flex gap-4 mt-2">
                    {["free", "pro", "power"].map((tier) => (
                      <label key={tier} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={(filters.tier || []).includes(tier)}
                          onCheckedChange={(checked) => handleTierToggle(tier, !!checked)}
                        />
                        <span className="capitalize">{tier}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="signup-after" className="text-sm text-muted-foreground">
                      Signed Up After
                    </Label>
                    <Input
                      id="signup-after"
                      type="date"
                      value={filters.signupAfter || ""}
                      onChange={(e) =>
                        setFilters({ ...filters, signupAfter: e.target.value || undefined })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="signup-before" className="text-sm text-muted-foreground">
                      Signed Up Before
                    </Label>
                    <Input
                      id="signup-before"
                      type="date"
                      value={filters.signupBefore || ""}
                      onChange={(e) =>
                        setFilters({ ...filters, signupBefore: e.target.value || undefined })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="min-monitors" className="text-sm text-muted-foreground">
                      Min Monitors
                    </Label>
                    <Input
                      id="min-monitors"
                      type="number"
                      min={0}
                      placeholder="0"
                      value={filters.minMonitors ?? ""}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          minMonitors: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="max-monitors" className="text-sm text-muted-foreground">
                      Max Monitors
                    </Label>
                    <Input
                      id="max-monitors"
                      type="number"
                      min={0}
                      placeholder="Any"
                      value={filters.maxMonitors ?? ""}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          maxMonitors: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={filters.hasActiveMonitors || false}
                    onCheckedChange={(checked) =>
                      setFilters({ ...filters, hasActiveMonitors: checked || undefined })
                    }
                  />
                  <Label className="text-sm text-muted-foreground">Has active monitors only</Label>
                </div>
              </div>
            </div>

            {/* Preview results */}
            {previewResult && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Preview: {previewResult.count} recipient{previewResult.count !== 1 ? "s" : ""} match
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {previewResult.users.length > 0 ? (
                    <div className="max-h-[200px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Email</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Tier</TableHead>
                            <TableHead>Monitors</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewResult.users.map((u) => (
                            <TableRow key={u.id}>
                              <TableCell className="text-xs">{u.email}</TableCell>
                              <TableCell className="text-xs">{u.firstName || "-"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs capitalize">
                                  {u.tier}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">{u.monitorCount}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {previewResult.count > 50 && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Showing first 50 of {previewResult.count} recipients.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No users match the current filters.</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={handlePreview}
              disabled={!name || !subject || !htmlBody || previewRecipients.isPending}
            >
              {previewRecipients.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Users className="h-4 w-4 mr-2" />
              )}
              Preview Recipients
            </Button>
            {createdCampaignId && (
              <Button
                variant="outline"
                onClick={handleSendTest}
                disabled={sendTestCampaign.isPending}
              >
                {sendTestCampaign.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <TestTube className="h-4 w-4 mr-2" />
                )}
                Send Test
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={handleSaveDraft}
              disabled={!name || !subject || !htmlBody || createCampaign.isPending}
            >
              {createCampaign.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Save Draft
            </Button>
            <Button
              onClick={() => setConfirmSendOpen(true)}
              disabled={!createdCampaignId || !previewResult || previewResult.count === 0}
            >
              <Send className="h-4 w-4 mr-2" />
              Send Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmSendOpen} onOpenChange={setConfirmSendOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send emails to {previewResult?.count ?? 0} recipient
              {(previewResult?.count ?? 0) !== 1 ? "s" : ""}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSendCampaign} disabled={sendCampaign.isPending}>
              {sendCampaign.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AdminCampaigns() {
  const [, navigate] = useLocation();
  const { data: campaigns, isLoading } = useCampaigns();
  const { data: dashboard } = useCampaignDashboard();
  const deleteCampaign = useDeleteCampaign();

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-2xl font-bold">Email Campaigns</h1>
          </div>
          <CreateCampaignDialog />
        </div>

        {/* Stats Cards */}
        {dashboard && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                  <Mail className="h-4 w-4" />
                  Campaigns
                </div>
                <div className="text-2xl font-bold">{dashboard.totalCampaigns}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                  <Users className="h-4 w-4" />
                  Total Sent
                </div>
                <div className="text-2xl font-bold">{dashboard.totalSent}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                  <Eye className="h-4 w-4" />
                  Avg Open Rate
                </div>
                <div className="text-2xl font-bold">{dashboard.avgOpenRate}%</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                  <MousePointerClick className="h-4 w-4" />
                  Avg Click Rate
                </div>
                <div className="text-2xl font-bold">{dashboard.avgClickRate}%</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Campaigns Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              All Campaigns
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !campaigns || campaigns.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No campaigns yet</p>
                <p className="text-sm mt-1">Create your first email campaign to start communicating with users.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Recipients</TableHead>
                    <TableHead className="text-right">Open Rate</TableHead>
                    <TableHead className="text-right">Click Rate</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((c: Campaign) => {
                    const config = statusConfig[c.status] || statusConfig.draft;
                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/admin/campaigns/${c.id}`)}
                      >
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>
                          <Badge variant={config.variant}>{config.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{c.totalRecipients}</TableCell>
                        <TableCell className="text-right">
                          {formatRate(c.openedCount, c.sentCount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatRate(c.clickedCount, c.sentCount)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(c.createdAt as any)}
                        </TableCell>
                        <TableCell className="text-right">
                          {c.status === "draft" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteCampaign.mutate(c.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
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
