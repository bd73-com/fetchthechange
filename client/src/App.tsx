import { useEffect, useState, Suspense } from "react";
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
import Pricing from "@/pages/Pricing";
import AdminErrors from "@/pages/AdminErrors";
import { blogPosts } from "@/lib/blog-posts";

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

function BlogPostFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/monitors/:id" component={() => <ProtectedRoute component={MonitorDetails} />} />
      <Route path="/blog" component={Blog} />
      {blogPosts.map((post) => (
        <Route
          key={post.slug}
          path={`/blog/${post.slug}`}
          component={() => (
            <Suspense fallback={<BlogPostFallback />}>
              <post.component />
            </Suspense>
          )}
        />
      ))}
      <Route path="/pricing" component={Pricing} />
      <Route path="/admin/errors" component={() => <ProtectedRoute component={AdminErrors} />} />
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
