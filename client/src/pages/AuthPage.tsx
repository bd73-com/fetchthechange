import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Zap, Bell, History } from "lucide-react";

export default function AuthPage() {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Branding & Value Prop */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 bg-primary text-primary-foreground overflow-hidden">
        {/* Abstract Background Decoration */}
        <div className="absolute top-0 left-0 w-full h-full bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.1)_25%,rgba(255,255,255,0.1)_50%,transparent_50%,transparent_75%,rgba(255,255,255,0.1)_75%,rgba(255,255,255,0.1)_100%)] bg-[length:60px_60px] opacity-20" />
        
        <div className="relative z-10">
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Zap className="h-6 w-6" /> FetchTheChange
          </h1>
          <p className="text-sm opacity-80 mt-1">Reliable change monitoring for the modern web</p>
        </div>

        <div className="relative z-10 max-w-lg space-y-8">
          <h2 className="text-5xl font-display font-bold leading-tight">
            Never miss an update on the web.
          </h2>
          <p className="text-xl opacity-90 leading-relaxed">
            Monitor any webpage element for changes. Get notified instantly when prices drop, content updates, or status changes.
          </p>
          
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-accent" />
              <span className="text-lg">Visual element selectors</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-accent" />
              <span className="text-lg">Daily email digests</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-accent" />
              <span className="text-lg">Detailed change history</span>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-sm opacity-60">
          &copy; {new Date().getFullYear()} FetchTheChange. All rights reserved.
        </div>
      </div>

      {/* Right: Login Form */}
      <div className="flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md space-y-8">
          <div className="lg:hidden text-center mb-8">
            <h1 className="text-2xl font-bold text-primary flex items-center justify-center gap-2">
               <Zap className="h-6 w-6" /> FetchTheChange
            </h1>
          </div>

          <Card className="border-none shadow-none sm:border sm:shadow-lg">
            <CardHeader className="space-y-1 text-center">
              <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
              <CardDescription>
                Sign in to manage your monitors and alerts
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-secondary/50 p-6 rounded-lg grid grid-cols-2 gap-4 mb-6">
                <div className="text-center space-y-2">
                  <div className="bg-background w-10 h-10 rounded-full flex items-center justify-center mx-auto shadow-sm text-primary">
                    <Bell className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-medium">Smart Alerts</p>
                </div>
                <div className="text-center space-y-2">
                  <div className="bg-background w-10 h-10 rounded-full flex items-center justify-center mx-auto shadow-sm text-primary">
                    <History className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-medium">History Log</p>
                </div>
              </div>

              <Button className="w-full py-6 text-lg shadow-lg shadow-primary/20" asChild>
                <a href="/api/login">
                  Log in with Replit
                </a>
              </Button>
            </CardContent>
            <CardFooter className="flex justify-center">
              <p className="text-xs text-muted-foreground text-center max-w-[280px]">
                By clicking continue, you agree to our Terms of Service and Privacy Policy.
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
