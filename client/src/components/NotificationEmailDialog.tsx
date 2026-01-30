import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Mail, Settings, X } from "lucide-react";

interface NotificationEmailDialogProps {
  currentNotificationEmail?: string | null;
  accountEmail?: string | null;
}

export function NotificationEmailDialog({ currentNotificationEmail, accountEmail }: NotificationEmailDialogProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(currentNotificationEmail || "");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setEmail(currentNotificationEmail || "");
    }
  }, [open, currentNotificationEmail]);

  const mutation = useMutation({
    mutationFn: async (notificationEmail: string | null) => {
      return apiRequest("PATCH", "/api/auth/user/notification-email", { notificationEmail });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Notification email updated",
        description: email ? `Notifications will now be sent to ${email}` : "Notifications will be sent to your account email",
      });
      setOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to update",
        description: error.message || "Could not update notification email",
      });
    },
  });

  const handleSave = () => {
    const trimmedEmail = email.trim();
    mutation.mutate(trimmedEmail || null);
  };

  const handleClear = () => {
    setEmail("");
    mutation.mutate(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground" data-testid="button-notification-settings">
          <Settings className="h-4 w-4 mr-2" />
          <span className="hidden md:inline">Settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]" data-testid="dialog-notification-email">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Notification Email
          </DialogTitle>
          <DialogDescription>
            Set a custom email address to receive change notifications. Leave empty to use your account email.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="notification-email">Custom notification email</Label>
            <Input
              id="notification-email"
              type="email"
              placeholder={accountEmail || "notifications@example.com"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="input-notification-email"
            />
            {currentNotificationEmail && (
              <p className="text-xs text-muted-foreground">
                Currently sending to: <span className="font-medium">{currentNotificationEmail}</span>
              </p>
            )}
            {!currentNotificationEmail && accountEmail && (
              <p className="text-xs text-muted-foreground">
                Currently sending to your account email: <span className="font-medium">{accountEmail}</span>
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          {currentNotificationEmail && (
            <Button
              variant="outline"
              onClick={handleClear}
              disabled={mutation.isPending}
              data-testid="button-clear-notification-email"
            >
              <X className="h-4 w-4 mr-2" />
              Use account email
            </Button>
          )}
          <Button onClick={handleSave} disabled={mutation.isPending} data-testid="button-save-notification-email">
            {mutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
