import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, Chrome } from "lucide-react";

export default function ExtensionAuth() {
  const { user, isLoading } = useAuth();
  const [tokenSent, setTokenSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if this is the fallback callback (service worker reads token from the URL)
  const isDone = new URLSearchParams(window.location.search).get("done") === "1";

  // Strip the token from the URL bar once the page renders with isDone.
  // The SW/polling already extracted the token from the hash; keeping it
  // in the address bar is a needless exposure risk.
  useEffect(() => {
    if (isDone && window.location.hash) {
      window.history.replaceState(null, "", "/extension-auth?done=1");
    }
  }, [isDone]);

  useEffect(() => {
    if (isDone || !user || tokenSent || error) return;

    (async () => {
      try {
        console.log("[FTC:auth-page] user logged in, requesting token...");
        const res = await fetch("/api/extension/token", {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          console.error("[FTC:auth-page] POST /api/extension/token returned", res.status);
          setError(`Failed to generate token (${res.status}). Please try again.`);
          return;
        }
        const data = await res.json().catch(() => {
          throw new Error("Unexpected response format from server");
        });
        if (typeof data?.token !== "string" || typeof data?.expiresAt !== "string") {
          throw new Error("Invalid token payload from server");
        }

        console.log("[FTC:auth-page] token received, posting to content script...");

        // Primary: postMessage for content script relay (works when host permission granted)
        window.postMessage(
          { type: "FTC_EXTENSION_TOKEN", token: data.token, expiresAt: data.expiresAt },
          window.location.origin,
        );
        setTokenSent(true);

        // Fallback: after a short delay, navigate to a callback URL so the
        // service worker can read the token from the tab URL via chrome.tabs.onUpdated
        // or its polling loop.
        // This handles Chrome 127+ where host_permissions are optional and the
        // content script may not be injected.  If the content script DID work,
        // the service worker will have already closed this tab before the timeout fires.
        setTimeout(() => {
          console.log("[FTC:auth-page] navigating to fallback callback URL...");
          const callbackUrl =
            `/extension-auth?done=1#token=${encodeURIComponent(data.token)}` +
            `&expiresAt=${encodeURIComponent(data.expiresAt)}`;
          window.location.replace(callbackUrl);
        }, 1000);
      } catch (err) {
        console.error("[FTC:auth-page] token fetch failed:", err instanceof Error ? err.message : String(err));
        setError("Something went wrong. Please try again.");
      }
    })();
  }, [user, tokenSent, error, isDone]);

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

        {tokenSent || isDone ? (
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
              <a href="/api/login?returnTo=/extension-auth">Sign in to FetchTheChange</a>
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
