import { useAuth } from "@/hooks/use-auth";
import PublicNav from "@/components/PublicNav";
import DashboardNav from "@/components/DashboardNav";
import SEOHead from "@/components/SEOHead";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";

export default function DocsMake() {
  const { user, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Make Integration | FetchTheChange"
        description="Connect FetchTheChange to Make (Integromat) using webhooks. Receive change alerts in any Make scenario — no server required."
        path="/docs/make"
        ogType="article"
      />
      {!isLoading && (user ? <DashboardNav /> : <PublicNav />)}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
        {/* Header */}
        <header className="mb-12">
          <Badge variant="secondary" className="mb-4">
            Developer Docs
          </Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold mb-4">
            Make (Integromat) integration
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Make (formerly Integromat) can receive FetchTheChange change events
            using FTC's existing webhook system and Make's "Custom Webhook"
            module. No special FTC module required.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Webhook delivery is available on Pro and Power plans.
          </p>
        </header>

        <div className="prose prose-invert max-w-none space-y-10">
          {/* Prerequisites */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Prerequisites
            </h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>
                A FetchTheChange{" "}
                <Link href="/pricing" className="text-primary hover:underline">
                  Pro or Power plan
                </Link>{" "}
                account
              </li>
              <li>A Make account (free plan works)</li>
            </ul>
          </section>

          {/* Step-by-step setup */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Step-by-step setup
            </h2>
            <ol className="list-decimal list-inside space-y-3 text-muted-foreground">
              <li>
                In Make, create a new scenario.
              </li>
              <li>
                Add a{" "}
                <strong className="text-foreground">
                  "Webhooks → Custom Webhook"
                </strong>{" "}
                module as the trigger.
              </li>
              <li>
                Click{" "}
                <strong className="text-foreground">"Add"</strong> to create a
                new webhook, then copy the generated URL (e.g.{" "}
                <code className="text-foreground">
                  https://hook.eu1.make.com/...
                </code>
                ).
              </li>
              <li>
                In FetchTheChange, open a monitor's settings →{" "}
                <strong className="text-foreground">
                  Notification Channels
                </strong>
                .
              </li>
              <li>
                Enable{" "}
                <strong className="text-foreground">"Webhook"</strong> and paste
                the Make URL as the webhook endpoint.
              </li>
              <li>
                Click{" "}
                <strong className="text-foreground">"Save"</strong> — a webhook
                secret is generated automatically.
              </li>
              <li>
                Back in Make, click{" "}
                <strong className="text-foreground">"OK"</strong> on the webhook
                module — Make is now listening for the first payload.
              </li>
              <li>
                In FetchTheChange, use{" "}
                <strong className="text-foreground">"Check now"</strong> to
                trigger a check, or wait for the next scheduled check.
              </li>
              <li>
                Make receives the payload and shows the data structure — you can
                now map fields to any downstream module.
              </li>
            </ol>
          </section>

          {/* Payload reference */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Payload reference
            </h2>
            <p className="text-muted-foreground mb-4">
              Each webhook delivery sends a JSON body with this structure:
            </p>
            <pre className="bg-secondary rounded-lg p-4 overflow-x-auto text-sm">
              <code>{`{
  "event": "change.detected",
  "monitorId": 42,
  "monitorName": "Competitor pricing page",
  "url": "https://example.com/pricing",
  "oldValue": "$49/mo",
  "newValue": "$59/mo",
  "detectedAt": "2025-11-14T09:03:22.000Z",
  "timestamp": "2025-11-14T09:03:24.187Z"
}`}</code>
            </pre>
            <p className="text-muted-foreground mt-4">
              See{" "}
              <Link
                href="/docs/webhooks"
                className="text-primary hover:underline"
              >
                /docs/webhooks
              </Link>{" "}
              for the full webhook documentation including all payload fields.
            </p>
          </section>

          {/* Example scenario recipes */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Example scenario recipes
            </h2>

            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  1. Log changes to Google Sheets
                </h3>
                <p className="text-muted-foreground">
                  Custom Webhook → Google Sheets "Add a Row" (map monitorName,
                  oldValue, newValue, detectedAt).
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  2. Send email on price drop
                </h3>
                <p className="text-muted-foreground">
                  Custom Webhook → Email "Send an Email" (compose with{" "}
                  <em>
                    {"{{monitorName}}"} changed from {"{{oldValue}}"} to{" "}
                    {"{{newValue}}"}
                  </em>
                  ).
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  3. Create Airtable record
                </h3>
                <p className="text-muted-foreground">
                  Custom Webhook → Airtable "Create a Record".
                </p>
              </div>
            </div>
          </section>

          {/* HMAC verification */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Note on HMAC verification
            </h2>
            <p className="text-muted-foreground">
              FTC signs every webhook with{" "}
              <code className="text-foreground">X-FTC-Signature-256</code>.
              Make's Custom Webhook module doesn't verify this automatically, but
              the payload still arrives correctly. If you want to verify
              signatures in Make, add a "Tools → Set Variable" step with the
              HMAC formula. See{" "}
              <Link
                href="/docs/webhooks"
                className="text-primary hover:underline"
              >
                /docs/webhooks
              </Link>{" "}
              for signature verification details.
            </p>
          </section>

          {/* Cross-link */}
          <div className="bg-secondary/50 rounded-lg p-4 border border-border">
            <p className="text-muted-foreground">
              Prefer a managed trigger without webhook URLs? See the{" "}
              <Link
                href="/docs/zapier"
                className="text-primary hover:underline"
              >
                Zapier integration
              </Link>
              .
            </p>
          </div>

          {/* Footer CTA */}
          <Separator className="my-10" />
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-muted-foreground">
              Have questions?{" "}
              <Link href="/support" className="text-primary underline">
                Visit our support page
              </Link>
              .
            </p>
            <Button asChild>
              <Link href="/">Get started free</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
