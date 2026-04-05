import { useAuth } from "@/hooks/use-auth";
import PublicNav from "@/components/PublicNav";
import DashboardNav from "@/components/DashboardNav";
import SEOHead from "@/components/SEOHead";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";

export default function DocsZapier() {
  const { user, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Zapier Integration | FetchTheChange"
        description="Connect FetchTheChange to 7,000+ apps via Zapier. Trigger Zaps when any monitored value changes — no server required. Power plan."
        path="/docs/zapier"
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
            Zapier integration
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Connect FetchTheChange to 7,000+ apps — when a monitored value
            changes, Zapier can log it to Google Sheets, send an SMS, create a
            Notion page, or anything else.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Zapier integration requires a{" "}
            <Link href="/pricing" className="text-primary hover:underline">
              Power plan
            </Link>
            .
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
                  Power plan
                </Link>{" "}
                account
              </li>
              <li>
                An API key — generate one from your{" "}
                <Link
                  href="/developer"
                  className="text-primary hover:underline"
                >
                  dashboard
                </Link>
              </li>
              <li>A Zapier account (free or paid)</li>
            </ul>
          </section>

          {/* Connecting */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Connecting your FetchTheChange account in Zapier
            </h2>
            <ol className="list-decimal list-inside space-y-3 text-muted-foreground">
              <li>
                Go to{" "}
                <strong className="text-foreground">zapier.com</strong> and
                create a new Zap.
              </li>
              <li>
                Search for{" "}
                <strong className="text-foreground">"FetchTheChange"</strong> as
                the trigger app.
              </li>
              <li>
                Select{" "}
                <strong className="text-foreground">
                  "Monitor Value Changed"
                </strong>{" "}
                as the trigger event.
              </li>
              <li>
                When prompted, paste your FetchTheChange API key (Power plan,
                generate at{" "}
                <Link
                  href="/developer"
                  className="text-primary hover:underline"
                >
                  /developer
                </Link>
                ).
              </li>
              <li>
                Click{" "}
                <strong className="text-foreground">"Test connection"</strong> —
                Zapier confirms the key is valid.
              </li>
              <li>
                <em>(Optional)</em> Choose a specific monitor to watch, or leave
                blank for all monitors.
              </li>
            </ol>
          </section>

          {/* Trigger payload reference */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Trigger payload reference
            </h2>
            <p className="text-muted-foreground mb-4">
              Each time a monitored value changes, Zapier receives a JSON object
              with the following structure:
            </p>
            <pre className="bg-secondary rounded-lg p-4 overflow-x-auto text-sm">
              <code>{`{
  "id": 1247,
  "monitorId": 42,
  "monitorName": "Competitor pricing page",
  "url": "https://example.com/pricing",
  "oldValue": "$49/mo",
  "newValue": "$59/mo",
  "detectedAt": "2025-11-14T09:03:22.000Z",
  "timestamp": "2025-11-14T09:03:25.112Z"
}`}</code>
            </pre>
            <div className="bg-secondary/50 rounded-lg p-4 border border-border mt-4">
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">Note:</strong> The{" "}
                <code className="text-foreground">id</code> field is the change
                record ID, used by Zapier for deduplication.{" "}
                <code className="text-foreground">oldValue</code> is{" "}
                <code className="text-foreground">null</code> on the first
                detection for a monitor.
              </p>
            </div>
          </section>

          {/* Example Zap recipes */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Example Zap recipes
            </h2>

            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  1. Price drop to Google Sheets
                </h3>
                <p className="text-muted-foreground">
                  FTC detects a change → Zapier appends a row to a Google Sheet
                  with the monitor name, old value, new value, and timestamp.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  2. Stock alert to SMS via Twilio
                </h3>
                <p className="text-muted-foreground">
                  FTC detects a change → Zapier sends an SMS:{" "}
                  <em>
                    "Monitor: {"{{monitorName}}"} changed to{" "}
                    {"{{newValue}}"}"
                  </em>
                  .
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  3. Change to Slack (via Zapier)
                </h3>
                <p className="text-muted-foreground">
                  FTC detects a change → Zapier posts a message to a Slack
                  channel. <em>Note:</em> FTC also has a native Slack
                  integration — this is useful when you want to route different
                  monitors to different workspaces.
                </p>
              </div>
            </div>
          </section>

          {/* Troubleshooting */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Troubleshooting
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">
                  My Zap isn't triggering
                </h3>
                <p className="text-muted-foreground">
                  Check that the API key is a Power-plan key. Check the monitor
                  is active. Use "Test trigger" in Zapier to confirm the
                  connection.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-1">
                  I see old data in my Zap test
                </h3>
                <p className="text-muted-foreground">
                  Zapier uses recent history for testing — this is normal. Live
                  Zaps receive real-time pushes.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-1">
                  My Zap fired but I expected a condition to filter it
                </h3>
                <p className="text-muted-foreground">
                  Alert conditions in FetchTheChange apply before Zapier
                  delivery — verify your conditions are configured correctly on
                  the monitor.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-1">
                  My Zap stopped triggering unexpectedly
                </h3>
                <p className="text-muted-foreground">
                  If a Zapier hook URL fails to accept deliveries 5 times in a
                  row, FetchTheChange automatically deactivates the
                  subscription to prevent wasted requests. Re-enable it by
                  turning the Zap off and back on in Zapier, which sends a
                  fresh subscribe request.
                </p>
              </div>
            </div>
          </section>

          {/* Cross-link */}
          <div className="bg-secondary/50 rounded-lg p-4 border border-border">
            <p className="text-muted-foreground">
              Using Make (Integromat) instead? See the{" "}
              <Link
                href="/docs/make"
                className="text-primary hover:underline"
              >
                Make integration guide
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
