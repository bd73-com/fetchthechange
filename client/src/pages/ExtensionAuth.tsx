import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, Chrome } from "lucide-react";

export default function ExtensionAuth() {
  const { user, isLoading } = useAuth();
  const [tokenSent, setTokenSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || tokenSent || error) return;

    (async () => {
      try {
        const res = await fetch("/api/extension/token", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          setError("Failed to generate token. Please try again.");
          return;
        }
        const data = await res.json();
        window.postMessage(
          { type: "FTC_EXTENSION_TOKEN", token: data.token, expiresAt: data.expiresAt },
          window.location.origin,
        );
        setTokenSent(true);
        setTimeout(() => {
          window.close();
        }, 1500);
      } catch {
        setError("Something went wrong. Please try again.");
      }
    })();
  }, [user, tokenSent]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm text-center space-y-6 px-4">
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Chrome className="h-8 w-8 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">FetchTheChange</h1>
          </div>
          <p className="text-muted-foreground">Connect your browser extension</p>
        </div>

        {tokenSent ? (
          <div className="space-y-3">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 dark:text-emerald-400 mx-auto" />
            <p className="text-foreground font-medium">Connected!</p>
            <p className="text-sm text-muted-foreground">You can close this tab.</p>
          </div>
        ) : error ? (
          <div className="space-y-3">
            <p className="text-destructive text-sm">{error}</p>
            <Button onClick={() => window.location.reload()}>Try again</Button>
          </div>
        ) : user ? (
          <div className="space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground">Connecting your extension...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <Button asChild size="lg" className="w-full">
              <a href="/api/login">Sign in to FetchTheChange</a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Sign in to connect the browser extension to your account.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
