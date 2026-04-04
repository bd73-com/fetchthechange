import { lazy, Suspense, useEffect, useState } from "react";
import { Switch, Route, Redirect } from "wouter";
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
import BlogUseCases from "@/pages/BlogUseCases";
import BlogNoCode from "@/pages/BlogNoCode";
import Pricing from "@/pages/Pricing";
import Support from "@/pages/Support";
import DocsWebhooks from "@/pages/DocsWebhooks";
import DocsZapier from "@/pages/DocsZapier";
import DocsMake from "@/pages/DocsMake";
import Privacy from "@/pages/Privacy";
import Changelog from "@/pages/Changelog";
import AdminErrors from "@/pages/AdminErrors";
import AdminCampaigns from "@/pages/AdminCampaigns";
import AdminCampaignDetail from "@/pages/AdminCampaignDetail";
import ExtensionAuth from "@/pages/ExtensionAuth";

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

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background" role="status">
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function ProtectedRoute({ component: Component, requiredTier, ...rest }: any) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!user) {
    return <LandingPage />;
  }

  if (requiredTier && user.tier !== requiredTier) {
    return <Redirect to="/dashboard" />;
  }

  const content = <Component {...rest} />;
  return requiredTier ? <Suspense fallback={<LoadingSpinner />}>{content}</Suspense> : content;
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
      <Route path="/blog/website-change-monitoring-use-cases-beyond-price-tracking" component={BlogUseCases} />
      <Route path="/blog/monitor-website-changes-without-writing-code" component={BlogNoCode} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/support" component={Support} />
      <Route path="/changelog" component={Changelog} />
      <Route path="/docs/webhooks" component={DocsWebhooks} />
      <Route path="/docs/zapier" component={DocsZapier} />
      <Route path="/docs/make" component={DocsMake} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/extension-auth" component={ExtensionAuth} />
      <Route path="/developer" component={() => <ProtectedRoute component={Developer} requiredTier="power" />} />
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
