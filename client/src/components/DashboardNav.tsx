import { useAuth } from "@/hooks/use-auth";
import { NotificationEmailDialog } from "@/components/NotificationEmailDialog";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutDashboard, FileWarning, HelpCircle, Send } from "lucide-react";
import { Link } from "wouter";

export default function DashboardNav() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <header className="border-b bg-card/50 backdrop-blur-md sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-display font-bold">FetchTheChange</h1>
          </Link>
          <span className="hidden md:inline text-sm text-muted-foreground">- Reliable change monitoring for the modern web</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:block text-sm text-muted-foreground">
            Welcome, <span className="font-medium text-foreground">{user?.firstName || user?.email}</span>
          </div>
          {((user as any)?.tier === "power") && (
            <>
              <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
                <Link href="/admin/campaigns">
                  <Send className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">Campaigns</span>
                </Link>
              </Button>
              <Button variant="ghost" size="sm" asChild className="text-muted-foreground" data-testid="link-error-logs">
                <Link href="/admin/errors">
                  <FileWarning className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">Event Log</span>
                </Link>
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground" data-testid="link-support">
            <Link href="/support">
              <HelpCircle className="h-4 w-4 mr-2" />
              <span className="sr-only sm:not-sr-only">Support</span>
            </Link>
          </Button>
          <NotificationEmailDialog
            currentNotificationEmail={(user as any)?.notificationEmail}
            accountEmail={user?.email}
          />
          <Button variant="ghost" size="sm" onClick={() => logout()} className="text-muted-foreground hover:text-destructive">
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </div>
    </header>
  );
}
