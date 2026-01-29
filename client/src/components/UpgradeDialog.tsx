import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Sparkles, Zap } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TIER_LIMITS, type UserTier } from "@shared/models/auth";

interface Plan {
  id: string;
  name: string;
  description: string;
  metadata: { tier?: string; monitor_limit?: string };
  prices: Array<{
    id: string;
    unit_amount: number;
    currency: string;
    recurring: { interval: string };
  }>;
}

interface UpgradeDialogProps {
  currentTier: UserTier;
  children?: React.ReactNode;
}

export function UpgradeDialog({ currentTier, children }: UpgradeDialogProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const { data: plansData, isLoading } = useQuery<{ plans: Plan[] }>({
    queryKey: ["/api/stripe/plans"],
    enabled: open,
  });

  const checkoutMutation = useMutation({
    mutationFn: async (priceId: string) => {
      const res = await apiRequest("POST", "/api/stripe/checkout", { priceId });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Checkout failed",
        description: error.message || "Could not start checkout. Please try again.",
      });
    },
  });

  const plans = plansData?.plans || [];

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount / 100);
  };

  const getPlanIcon = (name: string) => {
    if (name.toLowerCase().includes("power")) return Zap;
    return Sparkles;
  };

  const getPlanFeatures = (tier: string) => {
    const features: Record<string, string[]> = {
      pro: [
        "Monitor up to 100 pages",
        "Email notifications",
        "5-minute check intervals",
        "Change history",
        "Priority support",
      ],
      power: [
        "Unlimited page monitoring",
        "Email notifications",
        "1-minute check intervals",
        "Full change history",
        "Priority support",
        "API access",
      ],
    };
    return features[tier] || [];
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="default" size="sm" data-testid="button-upgrade">
            <Sparkles className="w-4 h-4 mr-2" />
            Upgrade
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Upgrade Your Plan</DialogTitle>
          <DialogDescription>
            Get more monitors and advanced features to track all the web pages you need.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No plans available at the moment.</p>
            <p className="text-sm mt-2">Please try again later.</p>
          </div>
        ) : (
          <div className="grid gap-4 mt-4">
            {plans.map((plan) => {
              const tier = (plan.metadata?.tier || "pro") as UserTier;
              const Icon = getPlanIcon(plan.name);
              const price = plan.prices[0];
              const isCurrentPlan = tier === currentTier;
              const features = getPlanFeatures(tier);

              return (
                <Card
                  key={plan.id}
                  className={`relative ${isCurrentPlan ? "border-primary" : ""}`}
                  data-testid={`card-plan-${tier}`}
                >
                  {isCurrentPlan && (
                    <Badge className="absolute -top-2 right-4" variant="default">
                      Current Plan
                    </Badge>
                  )}
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">{plan.name}</CardTitle>
                      </div>
                      {price && (
                        <div className="text-right">
                          <span className="text-2xl font-bold">
                            {formatPrice(price.unit_amount)}
                          </span>
                          <span className="text-muted-foreground">/month</span>
                        </div>
                      )}
                    </div>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 mb-4">
                      {features.map((feature, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="w-full"
                      variant={isCurrentPlan ? "outline" : "default"}
                      disabled={isCurrentPlan || checkoutMutation.isPending}
                      onClick={() => price && checkoutMutation.mutate(price.id)}
                      data-testid={`button-checkout-${tier}`}
                    >
                      {checkoutMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      {isCurrentPlan ? "Current Plan" : `Upgrade to ${plan.name}`}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
