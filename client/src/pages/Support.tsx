import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import PublicNav from "@/components/PublicNav";
import DashboardNav from "@/components/DashboardNav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageSquare, Send, Loader2, Zap } from "lucide-react";
import { contactFormSchema } from "@shared/routes";

// ---------------------------------------------------------------------------
// FAQ DATA
// ---------------------------------------------------------------------------

type FAQItem = { question: string; answer: string };
type FAQSection = { title: string; description: string; items: FAQItem[] };

const faqSections: FAQSection[] = [
  {
    title: "General",
    description: "Common questions about FetchTheChange",
    items: [
      {
        question: "What is FetchTheChange?",
        answer:
          "FetchTheChange is a website change monitoring tool that tracks specific values on web pages and alerts you when they change. It works on modern, JavaScript-heavy websites and tells you when tracking breaks, not just when values change.",
      },
      {
        question: "What can I monitor?",
        answer:
          "You can monitor any visible element on a web page: prices, stock availability, text content, metrics, KPIs, or any DOM-based value. You specify a CSS selector and FetchTheChange watches it for changes.",
      },
      {
        question: "How does FetchTheChange differ from other monitoring tools?",
        answer:
          "Unlike most tools that only fetch static HTML, FetchTheChange renders JavaScript-heavy pages and detects when selectors break. Instead of failing silently, it notifies you and helps you fix broken selectors.",
      },
      {
        question: "Is there a free plan?",
        answer:
          "Yes. The free plan includes 3 monitors with daily checks and email notifications. You can upgrade to Pro or Power plans for more monitors and higher check frequencies.",
      },
    ],
  },
  {
    title: "Notification Preferences",
    description: "Control when and how you receive change alerts.",
    items: [
      {
        question: "What are quiet hours?",
        answer:
          "Quiet hours let you suppress notifications during a time window you define — for example, 11pm to 7am. Any change detected during quiet hours is queued and delivered when the window ends, so you never miss an alert.",
      },
      {
        question: "What is daily digest mode?",
        answer:
          "Digest mode batches all change alerts for a monitor into a single daily email sent at 9am in your local timezone. Use it for monitors where you want a summary rather than an immediate ping for every change.",
      },
      {
        question: "What is the sensitivity threshold?",
        answer:
          "The sensitivity threshold lets you ignore minor changes. It is measured in character difference between the old and new value. For example, a threshold of 20 means a change must involve at least 20 characters added or removed before a notification is sent. The first detected change for a monitor always triggers a notification regardless of the threshold.",
      },
      {
        question: "Can I send a monitor's alerts to a different email address?",
        answer:
          "Yes. Each monitor has an optional notification email override. When set, alerts for that monitor are sent to that address instead of your account's default notification email. This is useful if you want some monitors to notify a colleague or a shared inbox.",
      },
      {
        question: "Where do I configure notification preferences?",
        answer:
          "Open a monitor's detail page and look for the Notification Preferences section. You can set quiet hours, toggle digest mode, configure the sensitivity threshold, and override the notification email — all per monitor.",
      },
    ],
  },
  {
    title: "Webhooks & Slack",
    description: "Send change alerts to your own systems or Slack workspace.",
    items: [
      {
        question: "Which plans include webhooks and Slack?",
        answer:
          "Webhooks and Slack notifications are available on the Pro and Power plans. Free plan users receive email notifications only.",
      },
      {
        question: "How do I set up a webhook for a monitor?",
        answer:
          "On the monitor's detail page, open the Notification Channels section and enable the Webhook channel. Paste in your endpoint URL. FetchTheChange generates a secret automatically — save it somewhere safe as it is shown only once. Each change detection will POST a signed JSON payload to your endpoint.",
      },
      {
        question: "How do I verify webhook signatures?",
        answer:
          "Every webhook request includes an X-FTC-Signature-256 header containing a sha256= prefix followed by an HMAC-SHA256 hex digest of the raw request body, computed using your webhook secret. To verify: compute HMAC-SHA256 of the raw body with your secret and compare it to the header value. Always use a constant-time comparison to prevent timing attacks. Reject requests that fail verification. See /docs/webhooks for code examples in Node.js, Python, and Go.",
      },
      {
        question: "What does a webhook payload look like?",
        answer:
          "Payloads are JSON objects with the following fields: event (always \"change.detected\"), monitorId, monitorName, url, oldValue, newValue, detectedAt (ISO 8601, when the change was recorded), and timestamp (ISO 8601, when the request was sent). The content type is application/json. oldValue is null on the first detection for a monitor.",
      },
      {
        question: "What happens if my webhook endpoint is down?",
        answer:
          "FetchTheChange retries failed deliveries automatically. You can view every delivery attempt — including the HTTP status code and error message — in the Delivery Log on the monitor's detail page.",
      },
      {
        question: "How do I connect Slack?",
        answer:
          "Go to your dashboard settings and click \"Connect Slack\". This starts a standard OAuth flow — you'll authorise FetchTheChange to post to your workspace. Once connected, open a monitor's detail page, enable the Slack channel, and pick the channel you want alerts sent to.",
      },
      {
        question: "Can I disconnect Slack?",
        answer:
          "Yes. Visit your integrations settings and click \"Disconnect Slack\". This removes FetchTheChange's access to your workspace and disables all Slack notification channels across your monitors.",
      },
      {
        question: "My webhook stopped delivering. What should I check?",
        answer:
          "Check the Delivery Log on the monitor's detail page — it shows every delivery attempt, the HTTP status code returned, and any error message. Common causes are: the endpoint returning a non-2xx status, a TLS certificate error, or a firewall blocking incoming requests. Ensure your endpoint responds within 5 seconds — requests that time out are treated as failures.",
      },
    ],
  },
  {
    title: "Troubleshooting",
    description: "Help with common issues",
    items: [
      {
        question: "My monitor shows 'selector not found'. What should I do?",
        answer:
          "This means the CSS selector you specified no longer matches any element on the page. The website may have changed its structure. Use the 'Fix Selector' tool on your monitor's detail page to get suggestions for updated selectors.",
      },
      {
        question: "Why is my monitor not detecting changes?",
        answer:
          "Several things can cause this: the check frequency might not be often enough, the selector might be matching a static element instead of the dynamic content, or the website might be blocking automated requests. Check the monitor's status and last check time on your dashboard.",
      },
      {
        question: "I'm not receiving email notifications. What's wrong?",
        answer:
          "First, check your spam/junk folder. Make sure email notifications are enabled for the monitor (toggle in monitor settings). Free tier users are limited to 1 email notification per 24 hours per monitor. You can also set a custom notification email in your account settings.",
      },
      {
        question: "The monitored value looks wrong or truncated.",
        answer:
          "This usually happens when the CSS selector matches a parent element containing more content than expected. Try using a more specific selector that targets exactly the element you want. The Fix Selector tool can help you find better selectors.",
      },
    ],
  },
  {
    title: "Account & Billing",
    description: "Managing your account and subscription",
    items: [
      {
        question: "How do I upgrade my plan?",
        answer:
          "You can upgrade from your dashboard. Click on any upgrade prompt or visit the Pricing page. Payment is handled securely through Stripe.",
      },
      {
        question: "Can I change or cancel my subscription?",
        answer:
          "Yes. You can manage your subscription through the Stripe billing portal, accessible from your dashboard. Changes and cancellations take effect at the end of the current billing period.",
      },
      {
        question: "What happens to my monitors if I downgrade?",
        answer:
          "Your existing monitors will continue to work, but you won't be able to create new ones if you exceed the lower plan's limit. You'll need to delete monitors to get below the new limit before creating new ones.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// SEO HEAD
// ---------------------------------------------------------------------------

const SUPPORT_PATH = "/support";

function getCanonicalUrl() {
  const baseUrl =
    import.meta.env.VITE_PUBLIC_BASE_URL ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "https://fetch-the-change.replit.app");
  return `${baseUrl}${SUPPORT_PATH}`;
}

function SEOHead() {
  useEffect(() => {
    const canonicalUrl = getCanonicalUrl();

    document.title = "Support & Help | FetchTheChange";

    const metaTags = [
      {
        name: "description",
        content:
          "Get help with FetchTheChange. Browse frequently asked questions about website monitoring, troubleshooting, and billing, or contact our support team.",
      },
      { property: "og:title", content: "Support & Help | FetchTheChange" },
      {
        property: "og:description",
        content:
          "Get help with FetchTheChange. Browse FAQs or contact our support team.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonicalUrl },
      { name: "twitter:card", content: "summary" },
      {
        name: "twitter:title",
        content: "Support & Help | FetchTheChange",
      },
      {
        name: "twitter:description",
        content:
          "Get help with FetchTheChange. Browse FAQs or contact our support team.",
      },
    ];

    const existingMetas: HTMLMetaElement[] = [];
    metaTags.forEach((tag) => {
      const meta = document.createElement("meta");
      if (tag.name) meta.setAttribute("name", tag.name);
      if ((tag as any).property)
        meta.setAttribute("property", (tag as any).property);
      meta.setAttribute("content", tag.content);
      document.head.appendChild(meta);
      existingMetas.push(meta);
    });

    const canonicalLink = document.createElement("link");
    canonicalLink.setAttribute("rel", "canonical");
    canonicalLink.setAttribute("href", canonicalUrl);
    document.head.appendChild(canonicalLink);

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqSections.flatMap((section) =>
        section.items.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      ),
    };

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.text = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    return () => {
      existingMetas.forEach((meta) => meta.remove());
      canonicalLink.remove();
      script.remove();
    };
  }, []);

  return null;
}

// ---------------------------------------------------------------------------
// CONTACT FORM (authenticated only)
// ---------------------------------------------------------------------------

type ContactFormValues = z.infer<typeof contactFormSchema>;

function ContactForm() {
  const { user } = useAuth();
  const { toast } = useToast();

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      email: user?.notificationEmail || user?.email || "",
      category: undefined,
      subject: "",
      message: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: ContactFormValues) => {
      const res = await apiRequest("POST", "/api/support/contact", data);
      return res.json();
    },
    onSuccess: (data: { message: string }) => {
      toast({ title: "Message Sent", description: data.message });
      form.reset({
        email: user?.notificationEmail || user?.email || "",
        category: undefined,
        subject: "",
        message: "",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ContactFormValues) => {
    mutation.mutate(data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          Contact Support
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input placeholder="your@email.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="bug">Bug Report</SelectItem>
                      <SelectItem value="feature">Feature Request</SelectItem>
                      <SelectItem value="billing">Billing</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Brief description of your issue"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Please describe your issue or question in detail..."
                      className="min-h-[120px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              disabled={mutation.isPending}
              className="w-full"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send Message
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// MAIN PAGE
// ---------------------------------------------------------------------------

export default function Support() {
  const { user, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead />
      {!isLoading && (user ? <DashboardNav /> : <PublicNav />)}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
        {/* Header */}
        <header className="text-center mb-12">
          <Badge variant="secondary" className="mb-4">
            Support
          </Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold mb-4">
            How can we help?
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Browse our frequently asked questions or contact our support team.
          </p>
        </header>

        {/* FAQ Sections */}
        <div className="space-y-10 mb-16">
          {faqSections.map((section) => (
            <div key={section.title}>
              <h2 className="text-2xl font-display font-bold mb-2">
                {section.title}
              </h2>
              <p className="text-muted-foreground mb-4">
                {section.description}
              </p>
              <Accordion type="single" collapsible className="w-full">
                {section.items.map((item, index) => (
                  <AccordionItem
                    key={index}
                    value={`${section.title}-${index}`}
                  >
                    <AccordionTrigger className="text-left">
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ))}
        </div>

        {/* Contact Form Section (authenticated only) */}
        {!isLoading && user && (
          <>
            <Separator className="my-12" />
            <div className="max-w-xl mx-auto">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-display font-bold mb-2">
                  Still need help?
                </h2>
                <p className="text-muted-foreground">
                  Send us a message and we'll get back to you as soon as
                  possible.
                </p>
              </div>
              <ContactForm />
            </div>
          </>
        )}

        {/* Sign-in prompt for unauthenticated users */}
        {!isLoading && !user && (
          <>
            <Separator className="my-12" />
            <div className="text-center">
              <h2 className="text-2xl font-display font-bold mb-2">
                Need more help?
              </h2>
              <p className="text-muted-foreground mb-4">
                Sign in to contact our support team directly.
              </p>
              <Button asChild>
                <a href="/api/login">Sign in to contact support</a>
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="py-8 border-t">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-display font-bold">FetchTheChange</span>
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} FetchTheChange. All rights
            reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
