import { useEffect, useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/LandingPage";
import Dashboard from "@/pages/Dashboard";
import MonitorDetails from "@/pages/MonitorDetails";
import Blog from "@/pages/Blog";
import BlogWhyMonitorsFail from "@/pages/BlogWhyMonitorsFail";
import BlogComparison from "@/pages/BlogComparison";
import Pricing from "@/pages/Pricing";

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

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/monitors/:id" component={() => <ProtectedRoute component={MonitorDetails} />} />
      <Route path="/blog" component={Blog} />
      <Route path="/blog/why-website-change-monitors-fail-silently" component={BlogWhyMonitorsFail} />
      <Route path="/blog/fetchthechange-vs-distill-visualping-hexowatch" component={BlogComparison} />
      <Route path="/pricing" component={Pricing} />
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
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
