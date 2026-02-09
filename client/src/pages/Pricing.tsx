import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";
import PublicNav from "@/components/PublicNav";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Perfect for getting started",
    monitors: "1 monitor",
    features: [
      "1 website monitor",
      "1 check per 24 hours",
      "1 email notification per 24 hours",
      "JavaScript-rendered pages",
      "Fix Selector tool",
      "Full change history",
    ],
    cta: "Get Started Free",
    popular: false,
  },
  {
    name: "Pro",
    price: "$9",
    period: "/month",
    description: "For users who need more monitors",
    monitors: "100 monitors",
    features: [
      "100 website monitors",
      "Hourly or daily checks",
      "Email notifications",
      "JavaScript-rendered pages",
      "Fix Selector tool",
      "Full change history",
    ],
    cta: "Upgrade to Pro",
    popular: true,
  },
  {
    name: "Power",
    price: "$29",
    period: "/month",
    description: "For agencies and heavy users",
    monitors: "Unlimited monitors",
    features: [
      "Unlimited website monitors",
      "Hourly or daily checks",
      "Email notifications",
      "JavaScript-rendered pages",
      "Fix Selector tool",
      "Full change history",
      "Admin event log",
    ],
    cta: "Upgrade to Power",
    popular: false,
  },
];

export default function Pricing() {
  return (
    <div className="min-h-screen bg-background">
      <PublicNav />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
        <header className="text-center mb-12">
          <Badge variant="secondary" className="mb-4">Pricing</Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold mb-4" data-testid="text-pricing-title">
            Simple, transparent pricing
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Start free and upgrade as you grow. No hidden fees, no surprises.
          </p>
        </header>

        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {plans.map((plan) => (
            <Card 
              key={plan.name} 
              className={`relative ${plan.popular ? "border-primary" : ""}`}
              data-testid={`card-plan-${plan.name.toLowerCase()}`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground">Most Popular</Badge>
                </div>
              )}
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <p className="text-muted-foreground text-sm">{plan.description}</p>
                <div className="mt-4">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
                <p className="text-primary font-medium mt-2">{plan.monitors}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button 
                  className="w-full" 
                  variant={plan.popular ? "default" : "outline"}
                  asChild
                  data-testid={`button-plan-${plan.name.toLowerCase()}`}
                >
                  <a href="/api/login">{plan.cta}</a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-16 text-center">
          <h2 className="text-2xl font-display font-bold mb-4">Frequently Asked Questions</h2>
          <div className="max-w-2xl mx-auto text-left space-y-6">
            <div>
              <h3 className="font-semibold mb-2">Can I change plans later?</h3>
              <p className="text-muted-foreground text-sm">
                Yes! You can upgrade or downgrade your plan at any time. Changes take effect immediately.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">What happens if I exceed my monitor limit?</h3>
              <p className="text-muted-foreground text-sm">
                You won't be able to create new monitors until you upgrade or delete existing ones. Your current monitors will continue working.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Do you offer refunds?</h3>
              <p className="text-muted-foreground text-sm">
                Yes, we offer a 14-day money-back guarantee. Contact support if you're not satisfied.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
