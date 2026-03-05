import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "@/hooks/use-api-keys";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Key, Plus, Trash2, Copy, Check, Loader2, Lock } from "lucide-react";
import { Link } from "wouter";

export default function ApiKeysPanel() {
  const { user } = useAuth();
  const isPower = user?.tier === "power";

  if (!isPower) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            API Access
          </CardTitle>
          <CardDescription>
            Integrate FetchTheChange into your own tools and workflows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <Lock className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              API access is available on the Power plan. Upgrade to generate API
              keys and use the REST API.
            </p>
            <Button asChild>
              <Link href="/pricing">View Plans</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return <ApiKeysTable />;
}

function ApiKeysTable() {
  const { data: keys = [], isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const [newKeyName, setNewKeyName] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    const result = await createKey.mutateAsync({ name: newKeyName.trim() });
    setCreatedKey(result.key);
    setNewKeyName("");
    setShowCreateDialog(false);
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              API Keys
            </CardTitle>
            <CardDescription className="mt-1">
              {keys.length} / 5 keys &middot;{" "}
              <Link href="/developer" className="text-primary hover:underline">
                API Docs
              </Link>
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => setShowCreateDialog(true)}
            disabled={keys.length >= 5}
          >
            <Plus className="h-4 w-4 mr-1" />
            Generate Key
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : keys.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-6">
            No API keys yet. Generate one to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between gap-4 p-3 rounded-lg bg-secondary/50"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{key.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    <code>{key.keyPrefix}...</code>
                    {key.lastUsedAt && (
                      <> &middot; Last used{" "}
                        {new Date(key.lastUsedAt).toLocaleDateString()}
                      </>
                    )}
                    {!key.lastUsedAt && <> &middot; Never used</>}
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently revoke the key{" "}
                        <strong>{key.name}</strong> ({key.keyPrefix}...). Any
                        integrations using this key will stop working immediately.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => revokeKey.mutate(key.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Revoke Key
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}

        {/* Create key dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate API Key</DialogTitle>
              <DialogDescription>
                Give your key a name so you can identify it later (e.g., "CI
                pipeline", "Zapier").
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Key name"
                maxLength={64}
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <Button
                className="w-full"
                onClick={handleCreate}
                disabled={!newKeyName.trim() || createKey.isPending}
              >
                {createKey.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Generate
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Show created key dialog */}
        <Dialog
          open={!!createdKey}
          onOpenChange={(open) => {
            if (!open) setCreatedKey(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>API Key Created</DialogTitle>
              <DialogDescription>
                Copy this key now. It will not be shown again. If you lose it,
                revoke it and generate a new one.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-secondary rounded px-3 py-2 text-sm break-all font-mono">
                  {createdKey}
                </code>
                <Button size="icon" variant="outline" onClick={handleCopy}>
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <Badge variant="destructive" className="w-full justify-center">
                This is the only time this key will be displayed
              </Badge>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
