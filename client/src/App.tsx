import { lazy, Suspense, useEffect, useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/LandingPage";
import Dashboard from "@/pages/Dashboard";
import MonitorDetails from "@/pages/MonitorDetails";
import Blog from "@/pages/Blog";
import BlogWhyMonitorsFail from "@/pages/BlogWhyMonitorsFail";
import BlogComparison from "@/pages/BlogComparison";
import BlogPriceMonitoring from "@/pages/BlogPriceMonitoring";
import BlogSelectorBreakage from "@/pages/BlogSelectorBreakage";
import Pricing from "@/pages/Pricing";
import Support from "@/pages/Support";
import DocsWebhooks from "@/pages/DocsWebhooks";
import AdminErrors from "@/pages/AdminErrors";
import AdminCampaigns from "@/pages/AdminCampaigns";
import AdminCampaignDetail from "@/pages/AdminCampaignDetail";

// Lazy-loaded: only downloaded for authenticated Power-plan users
const Developer = lazy(() => import("@/pages/Developer"));

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.add("dark");
  }, []);

  return <>{children}</>;
}

function ProtectedRoute({ component: Component, ...rest }: any) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  return <Component {...rest} />;
}

function PowerProtectedRoute({ component: Component, ...rest }: any) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  if (user.tier !== "power") {
    return <LandingPage />;
  }

  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <Component {...rest} />
    </Suspense>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/monitors/:id" component={() => <ProtectedRoute component={MonitorDetails} />} />
      <Route path="/blog" component={Blog} />
      <Route path="/blog/why-website-change-monitors-fail-silently" component={BlogWhyMonitorsFail} />
      <Route path="/blog/fetchthechange-vs-distill-visualping-hexowatch" component={BlogComparison} />
      <Route path="/blog/monitor-competitor-prices-without-getting-blocked" component={BlogPriceMonitoring} />
      <Route path="/blog/css-selectors-keep-breaking-why-and-how-to-fix" component={BlogSelectorBreakage} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/support" component={Support} />
      <Route path="/docs/webhooks" component={DocsWebhooks} />
      <Route path="/developer" component={() => <PowerProtectedRoute component={Developer} />} />
      <Route path="/admin/errors" component={() => <ProtectedRoute component={AdminErrors} />} />
      <Route path="/admin/campaigns" component={() => <ProtectedRoute component={AdminCampaigns} />} />
      <Route path="/admin/campaigns/:id" component={() => <ProtectedRoute component={AdminCampaignDetail} />} />
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <ErrorBoundary>
            <Toaster />
            <Router />
          </ErrorBoundary>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
