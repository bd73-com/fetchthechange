import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useMonitor, useMonitorHistory, useCheckMonitor, useDeleteMonitor, useUpdateMonitor } from "@/hooks/use-monitors";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, RefreshCw, Trash2, ExternalLink, Calendar, Clock, Loader2, Edit2, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertMonitorSchema } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export default function MonitorDetails() {
  const [match, params] = useRoute("/monitors/:id");
  const id = parseInt(params?.id || "0");
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  
  const { data: monitor, isLoading: loadingMonitor, error } = useMonitor(id);
  const { data: history, isLoading: loadingHistory } = useMonitorHistory(id);
  const { mutate: checkNow, isPending: isChecking } = useCheckMonitor();
  const { mutate: deleteMonitor, isPending: isDeleting } = useDeleteMonitor();
  const { mutate: updateMonitor } = useUpdateMonitor();
  const { toast } = useToast();

  const form = useForm({
    resolver: zodResolver(insertMonitorSchema),
    values: monitor ? {
      name: monitor.name,
      url: monitor.url,
      selector: monitor.selector,
      frequency: monitor.frequency,
      emailEnabled: monitor.emailEnabled,
      active: monitor.active,
    } : undefined,
  });

  const onSubmit = (data: any) => {
    updateMonitor({ id, ...data }, {
      onSuccess: () => {
        setIsEditing(false);
        toast({ title: "Monitor updated" });
      }
    });
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this monitor? This action cannot be undone.")) {
      deleteMonitor(id, {
        onSuccess: () => {
          window.location.href = "/";
        }
      });
    }
  };

  if (loadingMonitor) {
    return (
      <div className="max-w-7xl mx-auto p-8 space-y-8">
        <Skeleton className="h-12 w-32" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !monitor) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4">
        <h2 className="text-2xl font-bold">Monitor Not Found</h2>
        <Link href="/">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <header className="border-b bg-card/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold truncate">{monitor.name}</h1>
              <Badge variant={monitor.active ? "default" : "secondary"}>
                {monitor.active ? "Active" : "Paused"}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && (
              <>
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => setIsEditing(true)}
                  title="Edit monitor"
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => checkNow(id)} 
                  disabled={isChecking}
                  className="hidden sm:flex"
                >
                  {isChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Check Now
                </Button>
                <Button variant="destructive" size="icon" onClick={handleDelete} disabled={isDeleting}>
                  {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {isEditing ? (
          <Card>
            <CardHeader>
              <CardTitle>Edit Monitor Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                  </div>
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
                      <Check className="h-4 w-4 mr-2" /> Save Changes
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">Target URL</span>
                    <a 
                      href={monitor.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-primary hover:underline font-medium break-all"
                    >
                      {monitor.url}
                      <ExternalLink className="h-3 w-3 flex-shrink-0" />
                    </a>
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">CSS Selector</span>
                    <code className="block bg-secondary px-2 py-1 rounded text-sm font-mono w-fit">
                      {monitor.selector}
                    </code>
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">Check Frequency</span>
                    <p className="font-medium capitalize">{monitor.frequency}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">Notifications</span>
                    <p className="font-medium">
                      {monitor.emailEnabled ? "Email alerts enabled" : "No alerts"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Clock className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Last Checked</p>
                    <p className="font-medium">
                      {monitor.lastChecked 
                        ? format(new Date(monitor.lastChecked), "PPp")
                        : "Never checked"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/10 rounded-lg">
                    <Calendar className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Last Change Detected</p>
                    <p className="font-medium">
                      {monitor.lastChanged 
                        ? format(new Date(monitor.lastChanged), "PPp")
                        : "No changes detected"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Current Value</CardTitle>
            <CardDescription>The latest content captured from the page.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-secondary/30 p-4 rounded-lg font-mono text-sm whitespace-pre-wrap break-words max-h-60 overflow-y-auto border border-border">
              {monitor.currentValue || <span className="text-muted-foreground italic">No data captured yet. Click "Check Now" to fetch content.</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change History</CardTitle>
            <CardDescription>A log of all detected changes for this monitor.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingHistory ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : !history || history.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                No changes recorded yet.
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Date Detected</TableHead>
                      <TableHead>Previous Value</TableHead>
                      <TableHead>New Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((change) => (
                      <TableRow key={change.id}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {format(new Date(change.detectedAt), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground max-w-[300px] truncate" title={change.oldValue || ""}>
                          {change.oldValue || <span className="italic">null</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[300px] truncate" title={change.newValue || ""}>
                          {change.newValue}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
