import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  MousePointer2, 
  Bell, 
  Code2, 
  Eye,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  DollarSign,
  Package,
  FileText,
  BarChart3,
  AlertTriangle,
  Users,
  Wrench,
  Clock,
  History,
  Search,
  Target,
  Zap
} from "lucide-react";
import PublicNav from "@/components/PublicNav";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <PublicNav />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/10" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32 relative">
          <div className="text-center max-w-3xl mx-auto space-y-6">
            <Badge variant="secondary" className="px-4 py-1.5 text-sm">
              Website change monitoring that doesn't fail silently
            </Badge>
            <h1 className="text-4xl md:text-6xl font-display font-bold leading-tight">
              Monitor any web value.{" "}
              <span className="text-primary">Get alerted when it changes.</span>
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Works on modern, JavaScript-heavy websites — and tells you when tracking breaks, not just when values change.
            </p>
            <div className="mt-8 mb-4">
              <img 
                src="/images/fix-selector-showcase.png" 
                alt="Fix Selector feature showing selector suggestions" 
                className="rounded-lg shadow-2xl border border-border mx-auto max-w-full md:max-w-2xl"
              />
              <p className="text-muted-foreground mt-4 text-base">
                When a site changes, FetchTheChange shows you what broke and helps you fix it.
              </p>
            </div>
            <p className="text-lg text-muted-foreground">
              FetchTheChange is a website change monitoring tool that tracks specific values on modern, JavaScript-rendered pages and alerts you when they change.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Button size="lg" className="text-lg px-8 shadow-lg shadow-primary/20" asChild>
                <a href="/api/login">
                  Start Monitoring <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
              <Button size="lg" variant="outline" className="text-lg px-8" asChild>
                <a href="#how-it-works">See How It Works</a>
              </Button>
            </div>
            <div className="mt-6">
              <a 
                href="/blog/" 
                className="text-muted-foreground hover:text-primary transition-colors text-base underline underline-offset-4"
                data-testid="link-blog"
              >
                Read insights on web monitoring, change detection, and staying ahead of website updates in my blog.
              </a>
            </div>
            <div className="mt-6">
           </div>
          </div>
        </div>
      </section>


      {/* Problem Section */}
      <section className="py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Most website change monitors fail silently</h2>
            <p className="text-lg text-muted-foreground">
              The modern web is dynamic. Traditional monitors often miss changes — or worse, report the wrong thing — without telling you.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <AlertTriangle className="h-5 w-5 text-primary" />
                  Selectors break
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                Sites change structure and CSS selectors stop matching. Many tools just keep running and return garbage.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Code2 className="h-5 w-5 text-primary" />
                  JavaScript content
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                More and more values only exist after JavaScript renders. Static scrapers won’t see them.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  You need confidence
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                If monitoring is unreliable, you’re back to manual checking. FetchTheChange flags failures and helps you fix them.
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
{/* Who is this for */}
      <section className="py-24 bg-secondary/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Who is this for?</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Non-technical users */}
            <Card className="relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2" />
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Users className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-2xl">For non-technical users</CardTitle>
                </div>
                <p className="text-muted-foreground text-lg">
                  You don't need to know how websites work.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>Pick a page</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>Click the element you care about</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>Get notified when it changes</span>
                  </div>
                </div>
                <p className="text-muted-foreground pt-4 border-t">
                  FetchTheChange guides you if something breaks — no silent failures, no confusing alerts.
                </p>
              </CardContent>
            </Card>

            {/* Technical users */}
            <Card className="relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-accent/20 rounded-full -translate-y-1/2 translate-x-1/2" />
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-accent/20 rounded-lg">
                    <Code2 className="h-6 w-6 text-accent-foreground" />
                  </div>
                  <CardTitle className="text-2xl">For technical & power users</CardTitle>
                </div>
                <p className="text-muted-foreground text-lg">
                  FetchTheChange gives you full control when you need it.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>CSS-selector based monitoring</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>JavaScript-rendered pages supported</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>Deterministic extraction (no screenshot noise)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>Transparent failure states</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>Fix-it-yourself selector recovery</span>
                  </div>
                </div>
                <p className="text-muted-foreground pt-4 border-t">
                  If a site changes its structure, you'll know <em>why</em> — and how to fix it.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* What can you monitor */}
      <section id="use-cases" className="py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">What can you monitor?</h2>
            <p className="text-xl text-muted-foreground">
              FetchTheChange is <strong>not just a price tracker</strong>.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: DollarSign, label: "Prices" },
              { icon: Package, label: "Availability" },
              { icon: FileText, label: "Text changes" },
              { icon: BarChart3, label: "Numbers & metrics" },
              { icon: AlertTriangle, label: "Status messages" },
              { icon: ShieldCheck, label: "Regulatory wording" },
              { icon: Sparkles, label: "Product launches" },
              { icon: Search, label: "Competitor pages" },
            ].map((item, index) => (
              <Card key={index} className="text-center p-6 hover-elevate cursor-default">
                <item.icon className="h-8 w-8 text-primary mx-auto mb-3" />
                <p className="font-medium">{item.label}</p>
              </Card>
            ))}
          </div>

          <p className="text-center text-lg text-muted-foreground mt-8">
            If it appears on a webpage, FetchTheChange can watch it.
          </p>
        </div>
      </section>

      {/* Why FetchTheChange */}
      <section className="py-24 bg-secondary/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Why FetchTheChange?</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Most monitoring tools break silently, miss JavaScript-rendered content, 
              send false alerts, and hide what went wrong. <strong>FetchTheChange does the opposite.</strong>
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <Card>
              <CardHeader>
                <div className="p-3 bg-primary/10 rounded-lg w-fit mb-4">
                  <Wrench className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-xl">Built for reliability</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>Works on modern JS websites</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>Handles cookie banners & dynamic loading</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>Shows you exactly what was found (or not)</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="p-3 bg-primary/10 rounded-lg w-fit mb-4">
                  <Eye className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-xl">Built for clarity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>Clear "selector missing" errors</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>Visual selector suggestions</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>Full change history</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="p-3 bg-primary/10 rounded-lg w-fit mb-4">
                  <ShieldCheck className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-xl">Built for trust</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>No black-box diffs</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>No guessing</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>No surprise failures</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">How it works</h2>
            <p className="text-lg text-muted-foreground">Four simple steps. That's it.</p>
          </div>

          <div className="grid md:grid-cols-4 gap-6">
            {[
              { step: 1, icon: Target, title: "Add a page URL", desc: "Paste the URL of any webpage you want to monitor" },
              { step: 2, icon: MousePointer2, title: "Select what to monitor", desc: "Pick the element you care about using our selector tool" },
              { step: 3, icon: Clock, title: "Choose frequency", desc: "Decide how often to check — hourly or daily" },
              { step: 4, icon: Bell, title: "Get notified", desc: "Receive email alerts when the value changes" },
            ].map((item) => (
              <div key={item.step} className="relative">
                <div className="flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center mb-4 shadow-lg shadow-primary/20">
                    <item.icon className="h-7 w-7" />
                  </div>
                  <Badge variant="outline" className="mb-3">Step {item.step}</Badge>
                  <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm">{item.desc}</p>
                </div>
                {item.step < 4 && (
                  <div className="hidden md:block absolute top-8 left-[60%] w-[80%] border-t-2 border-dashed border-border" />
                )}
              </div>
            ))}
          </div>

          <p className="text-center text-muted-foreground mt-12 text-lg">
            If the page structure changes, FetchTheChange helps you fix it — instead of silently failing.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-24 bg-secondary/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Pricing</h2>
            <p className="text-lg text-muted-foreground">Simple, transparent pricing for everyone.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Free tier */}
            <Card className="relative" data-testid="card-landing-plan-free">
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-xl">Free</CardTitle>
                <p className="text-muted-foreground text-sm">Perfect for getting started</p>
                <div className="mt-4">
                  <span className="text-4xl font-bold">$0</span>
                  <span className="text-muted-foreground">forever</span>
                </div>
                <p className="text-primary font-medium mt-2">1 monitor</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">1 website monitor</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">1 check per 24 hours</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">1 email notification per 24 hours</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">JavaScript-rendered pages</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">Fix Selector tool</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">Full change history</span>
                  </li>
                </ul>
                <Button className="w-full" variant="outline" asChild data-testid="button-landing-plan-free">
                  <a href="/api/login">Get Started Free</a>
                </Button>
              </CardContent>
            </Card>

            {/* Pro tier */}
            <Card className="relative border-primary" data-testid="card-landing-plan-pro">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-primary text-primary-foreground">Most Popular</Badge>
              </div>
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-xl">Pro</CardTitle>
                <p className="text-muted-foreground text-sm">For users who need more monitors</p>
                <div className="mt-4">
                  <span className="text-4xl font-bold">$9</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                <p className="text-primary font-medium mt-2">100 monitors</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">100 website monitors</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">Hourly or daily checks</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">Email notifications</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">JavaScript-rendered pages</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">Fix Selector tool</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">Full change history</span>
                  </li>
                </ul>
                <Button className="w-full" asChild data-testid="button-landing-plan-pro">
                  <a href="/api/login">Upgrade to Pro</a>
                </Button>
              </CardContent>
            </Card>

            {/* Power tier */}
            <Card className="relative" data-testid="card-landing-plan-power">
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-xl">Power</CardTitle>
                <p className="text-muted-foreground text-sm">For agencies and heavy users</p>
                <div className="mt-4">
                  <span className="text-4xl font-bold">$29</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                <p className="text-primary font-medium mt-2">Unlimited monitors</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">Unlimited website monitors</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">Hourly or daily checks</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">Email notifications</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">JavaScript-rendered pages</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">Fix Selector tool</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm">Full change history</span>
                  </li>
                </ul>
                <Button className="w-full" variant="outline" asChild data-testid="button-landing-plan-power">
                  <a href="/api/login">Upgrade to Power</a>
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="text-center mt-8">
            <a href="/pricing" className="text-primary hover:underline text-sm font-medium" data-testid="link-full-pricing">
              View full pricing details and FAQ
            </a>
          </div>
        </div>
      </section>

      {/* Built for people who care */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">
            Built for people who care about accuracy
          </h2>
          <p className="text-xl text-muted-foreground mb-8">
            FetchTheChange is for people who:
          </p>
          <div className="flex flex-wrap justify-center gap-4 mb-12">
            <Badge variant="secondary" className="px-4 py-2 text-base">
              Rely on accurate data
            </Badge>
            <Badge variant="secondary" className="px-4 py-2 text-base">
              Get frustrated by broken trackers
            </Badge>
            <Badge variant="secondary" className="px-4 py-2 text-base">
              Want transparency instead of guesswork
            </Badge>
          </div>
          <p className="text-lg text-muted-foreground mb-8">
            If that's you — welcome.
          </p>
        </div>
      </section>


      {/* FAQ */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">FAQ</h2>
            <p className="text-lg text-muted-foreground">Quick answers to common questions.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">What is FetchTheChange?</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                FetchTheChange is a website change monitoring tool that tracks a specific value on a page and alerts you when it changes.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">What can I monitor?</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                Anything visible on a page: prices, availability, metrics, text blocks, KPIs, or any DOM-based value you care about.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Does it work on JavaScript-heavy sites?</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                Yes. When needed, FetchTheChange renders the page with JavaScript and monitors the rendered DOM instead of the static HTML.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">What happens when my selector stops matching?</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                FetchTheChange reports the failure instead of failing silently and can suggest alternative selectors to get you back to a working monitor.
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
{/* Final CTA */}
      <section className="py-24 bg-primary text-primary-foreground">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">
            Start tracking changes that actually matter.
          </h2>
          <div className="flex items-center justify-center gap-2 mb-8">
            <Zap className="h-8 w-8" />
            <span className="text-2xl font-display font-bold">FetchTheChange</span>
          </div>
          <Button size="lg" variant="secondary" className="text-lg px-8 shadow-lg" asChild>
            <a href="/api/login">
              Get Started Free <ArrowRight className="ml-2 h-5 w-5" />
            </a>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-display font-bold">FetchTheChange</span>
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} FetchTheChange. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
