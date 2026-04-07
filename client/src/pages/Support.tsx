import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import PublicNav from "@/components/PublicNav";
import DashboardNav from "@/components/DashboardNav";
import SEOHead from "@/components/SEOHead";
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
    title: "Tags",
    description: "Organise your monitors with coloured labels.",
    items: [
      {
        question: "What are monitor tags?",
        answer:
          "Tags are coloured labels you can assign to monitors to organise them — for example \"Work\", \"Competitors\", or \"Prices\". You can filter your dashboard by tag to quickly find the monitors you care about.",
      },
      {
        question: "Which plans include tags?",
        answer:
          "Tags are available on Pro and Power plans. Pro users can create up to 10 tags and assign up to 2 tags per monitor. Power users get unlimited tags and unlimited assignments per monitor. Free plan users cannot create or assign tags.",
      },
      {
        question: "How do I create and manage tags?",
        answer:
          "Click the \"Manage tags\" button on your dashboard to open the tag manager. From there you can create new tags, rename them, change their colour, or delete them. You can also manage tags from the tag picker on any monitor.",
      },
      {
        question: "How do I assign tags to a monitor?",
        answer:
          "On your dashboard or on the monitor detail page, click the tag picker button on a monitor card. Check or uncheck tags to assign or remove them. Changes are saved immediately.",
      },
      {
        question: "What happens to tags if I downgrade my plan?",
        answer:
          "Your existing tags and assignments remain in place, but you won't be able to create new tags or assign additional tags until you upgrade again or remove existing ones to stay within the new plan's limits.",
      },
    ],
  },
  {
    title: "Monitor Health",
    description: "Understanding monitor health indicators and alert emails.",
    items: [
      {
        question: "What does the coloured dot next to my monitor mean?",
        answer:
          "Green means the monitor is checking successfully. Amber means it has encountered one or more consecutive failures but is still active and retrying. Red means the monitor has been paused — either automatically after repeated failures, or manually.",
      },
      {
        question: "What is a health warning email?",
        answer:
          "A health warning email is sent when a monitor hits the halfway point before auto-pause — for example, after 5 consecutive failures on the Power plan (which auto-pauses at 10). It tells you what error the monitor is seeing and how many more failures will trigger auto-pause, so you can investigate before monitoring stops.",
      },
      {
        question: "Which plans receive health warning emails?",
        answer:
          "Health warning and recovery emails are available on the Power plan only. All plans show the coloured health indicator and failure count on the dashboard.",
      },
      {
        question: "What is a recovery email?",
        answer:
          "A recovery email is sent when a monitor that previously triggered a health warning starts succeeding again. It tells you the monitor is healthy, shows the current value it retrieved, and summarises how long it was struggling.",
      },
      {
        question: "Will I get a health warning email every time a check fails?",
        answer:
          "No. You receive one health warning per failure streak — at the halfway point before auto-pause. If the monitor keeps failing after the warning, you will not receive additional warnings until it recovers and then starts failing again.",
      },
      {
        question: "My monitor is amber but I haven't received a warning email. Why?",
        answer:
          "Health warning emails are Power-plan exclusive. If you are on the Free or Pro plan, the amber indicator is still shown on the dashboard so you can see the monitor is struggling, but no email is sent. You can upgrade to Power to enable health alert emails.",
      },
    ],
  },
  {
    title: "Alert Conditions",
    description: "Filter when notifications fire based on value criteria.",
    items: [
      {
        question: "What are alert conditions?",
        answer:
          "Alert conditions let you filter when notifications fire. Instead of being alerted every time a monitored value changes, you only receive a notification when the new value meets your criteria — for example, when a price drops below $150, or when a page starts saying 'In Stock'.",
      },
      {
        question: "How many conditions can I add?",
        answer:
          "Free plan users can add 1 condition per monitor. Pro and Power users can add unlimited conditions per monitor.",
      },
      {
        question: "What condition types are available?",
        answer:
          "Numeric conditions (less than, greater than, changed by more than N%), text conditions (contains, does not contain, equals exactly), and regex pattern matching for advanced use cases.",
      },
      {
        question: "Does the change still get recorded if the condition is not met?",
        answer:
          "Yes. The change is always recorded in your monitor's change history. Conditions only control whether a notification is sent — they never suppress the history record.",
      },
      {
        question: "How does AND/OR logic work?",
        answer:
          "Conditions in the same group are combined with AND — all must pass. Multiple groups are combined with OR — if any group passes entirely, the notification fires. Most users will use a single group (all AND). Pro and Power users can add multiple groups for more complex logic.",
      },
      {
        question: "Why is my numeric condition not triggering?",
        answer:
          "Numeric conditions extract the first number from the monitored value. If the value contains no number (for example, 'Out of stock'), the condition is treated as not met. Check that your CSS selector is capturing a value that contains a number.",
      },
      {
        question: "Can I test a condition without waiting for the next check?",
        answer:
          "Not yet — but you can use the 'Check now' button on a monitor to trigger an immediate check, which will evaluate your conditions against the current live value.",
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
    title: "API Access",
    description: "Using the FetchTheChange REST API",
    items: [
      {
        question: "Which plan includes API access?",
        answer:
          "API access is exclusive to the Power plan. Free and Pro users can see the API documentation at /developer but cannot generate API keys or call API endpoints.",
      },
      {
        question: "How do I generate an API key?",
        answer:
          "Log in and go to your dashboard. Scroll down to the API Keys section and click \"Generate Key\". Give the key a name (e.g. \"CI pipeline\") and copy the full key — it is shown only once. You can have up to 5 active keys.",
      },
      {
        question: "What can I do with the API?",
        answer:
          "You can create, update, and delete monitors programmatically, list all your monitors, and pull paginated change history with optional date range filtering. This makes it easy to integrate FetchTheChange into CI/CD pipelines, dashboards, and automation tools.",
      },
      {
        question: "What are the API rate limits?",
        answer:
          "Each API key is limited to 300 requests per minute. Every response includes X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers so you can track your usage. See /developer for full details.",
      },
      {
        question: "How do I keep my API key secure?",
        answer:
          "Treat your API key like a password. Store it in environment variables, never in source code or version control. If a key is exposed, revoke it immediately from your dashboard and generate a new one.",
      },
    ],
  },
  {
    title: "Zapier & Make",
    description: "Connecting FetchTheChange to Zapier and Make (Integromat).",
    items: [
      {
        question: "Which plans include Zapier integration?",
        answer:
          "Zapier integration is available on the Power plan. It uses your FetchTheChange API key to authenticate. Make integration via webhooks is available on Pro and Power plans.",
      },
      {
        question: "How do I connect FetchTheChange to Zapier?",
        answer:
          "In Zapier, create a new Zap and search for FetchTheChange as the trigger app. Select 'Monitor Value Changed', then paste your FetchTheChange API key when prompted. Full setup instructions are at /docs/zapier.",
      },
      {
        question: "Can I trigger a Zap only when a specific monitor changes?",
        answer:
          "Yes. When setting up the FetchTheChange trigger in Zapier, you can select a specific monitor from the dropdown, or leave it blank to trigger on any monitor change.",
      },
      {
        question: "Do alert conditions apply to Zapier triggers?",
        answer:
          "Yes. If you have alert conditions configured on a monitor, those conditions gate Zapier delivery too — a Zap only fires if the conditions pass. This prevents Zapier from being triggered by every minor change.",
      },
      {
        question: "How do I connect FetchTheChange to Make (Integromat)?",
        answer:
          "Make works with FetchTheChange via webhooks. In Make, add a 'Custom Webhook' module and copy its URL, then add that URL as a webhook on your FetchTheChange monitor. Full instructions are at /docs/make.",
      },
      {
        question: "What data does Zapier receive when a monitor changes?",
        answer:
          "Each trigger includes the standard webhook fields (event, monitorId, monitorName, url, oldValue, newValue, detectedAt, timestamp) plus an id field for the change record.",
      },
      {
        question: "My Zap stopped triggering — what happened?",
        answer:
          "If a Zapier hook URL fails to accept deliveries 15 times in a row, FetchTheChange automatically deactivates the subscription to prevent wasted requests. To re-enable, turn the Zap off and back on in Zapier — this sends a fresh subscribe request. Inactive subscriptions are cleaned up after 90 days.",
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
      {
        question: "What does 'Bot blocked' mean on my monitor card?",
        answer:
          "Some websites use bot-detection systems (such as Cloudflare, Akamai, or custom solutions) that block automated access. When this happens, your monitor's checks are rejected before the page content can be read. The orange 'Bot blocked' indicator appears on your dashboard card after two consecutive blocked checks. FetchTheChange uses a real browser for every check, which works for most sites, but some sites reliably block all automated access regardless of technique. If the issue persists, there is unfortunately no workaround — the target site is actively preventing automated monitoring.",
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
          "Your existing monitors will continue to work, but you won't be able to create new ones if you exceed the lower plan's limit. You'll need to delete monitors to get below the new limit before creating new ones. Additionally, any monitors set to hourly check frequency will be automatically switched to daily, since hourly checks require a Pro or Power plan.",
      },
    ],
  },
  {
    title: "Browser Extension",
    description: "Using the FetchTheChange Chrome extension",
    items: [
      {
        question: "How do I install the FetchTheChange extension?",
        answer:
          "The FetchTheChange extension is available on the Chrome Web Store. Search for \"FetchTheChange\" or visit the Chrome Web Store page directly. Once installed, click the extension icon in your toolbar to get started.",
      },
      {
        question: "Which browsers are supported?",
        answer:
          "The extension works with Chrome and all Chromium-based browsers, including Microsoft Edge, Brave, and Opera.",
      },
      {
        question: "Do I need a paid plan to use the extension?",
        answer:
          "No. The extension works with all plans, including the free plan. Your existing monitor limits apply \u2014 free users can create up to 3 monitors, Pro users up to 100, and Power users have unlimited monitors.",
      },
      {
        question: "How does the element picker work?",
        answer:
          "Click the extension icon on any web page, then click \"Pick an element\". Your cursor becomes a crosshair \u2014 hover over any element on the page to highlight it, then click to select it. The extension generates a CSS selector automatically and shows you the current value so you can confirm you picked the right element.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// FAQ JSON-LD
// ---------------------------------------------------------------------------

const faqJsonLd = {
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
      return res.json().catch(() => {
        throw new Error("Unexpected response format from server");
      });
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
      <SEOHead
        title="Support & Help | FetchTheChange"
        description="Get help with FetchTheChange. Browse frequently asked questions about website monitoring, troubleshooting, and billing, or contact our support team."
        path="/support"
        ogDescription="Get help with FetchTheChange. Browse FAQs or contact our support team."
        twitterDescription="Get help with FetchTheChange. Browse FAQs or contact our support team."
        jsonLd={faqJsonLd}
      />
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
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} FetchTheChange. All rights
              reserved.
            </p>
            <a href="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Privacy
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
