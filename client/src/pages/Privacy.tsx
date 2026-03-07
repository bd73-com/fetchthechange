import { useAuth } from "@/hooks/use-auth";
import PublicNav from "@/components/PublicNav";
import DashboardNav from "@/components/DashboardNav";
import SEOHead from "@/components/SEOHead";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Zap } from "lucide-react";

const SUPPORT_EMAIL =
  import.meta.env.VITE_SUPPORT_EMAIL || "ftc@bd73.com";

export default function Privacy() {
  const { user, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Privacy Policy | FetchTheChange"
        description="FetchTheChange Privacy Policy. Learn how we collect, use, and protect your personal data in compliance with GDPR."
        path="/privacy"
      />
      {!isLoading && (user ? <DashboardNav /> : <PublicNav />)}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
        {/* Header */}
        <header className="mb-12">
          <Badge variant="secondary" className="mb-4">
            Legal
          </Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold mb-4">
            Privacy Policy
          </h1>
          <p className="text-muted-foreground text-lg">
            Last updated: 7 March 2026
          </p>
        </header>

        <div className="prose prose-invert max-w-none space-y-10">
          {/* Section 1 — Who we are */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              1. Who we are
            </h2>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Data controller</strong>
              <br />
              FetchTheChange is operated by Christian Ustvedt Kavli, based in
              Norway.
            </p>
            <p className="text-muted-foreground mt-3">
              Contact for privacy matters:{" "}
              <strong className="text-foreground">{SUPPORT_EMAIL}</strong>
            </p>
          </section>

          <Separator className="my-8" />

          {/* Section 2 — What data we collect and why */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              2. What data we collect and why
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left font-semibold py-2 pr-4 border-b border-border">
                      Data
                    </th>
                    <th className="text-left font-semibold py-2 pr-4 border-b border-border">
                      Purpose
                    </th>
                    <th className="text-left font-semibold py-2 border-b border-border">
                      Lawful basis
                    </th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr>
                    <td className="py-2 pr-4 border-b border-border">Email address</td>
                    <td className="py-2 pr-4 border-b border-border">Account creation, login, sending change notifications</td>
                    <td className="py-2 border-b border-border">Contract (Art. 6(1)(b))</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 border-b border-border">Authentication token (session cookie)</td>
                    <td className="py-2 pr-4 border-b border-border">Keeping you signed in</td>
                    <td className="py-2 border-b border-border">Contract (Art. 6(1)(b))</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 border-b border-border">Monitor configuration (URLs, CSS selectors, notification preferences)</td>
                    <td className="py-2 pr-4 border-b border-border">Delivering the monitoring service</td>
                    <td className="py-2 border-b border-border">Contract (Art. 6(1)(b))</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 border-b border-border">Change history (captured values, timestamps)</td>
                    <td className="py-2 pr-4 border-b border-border">Displaying your change log</td>
                    <td className="py-2 border-b border-border">Contract (Art. 6(1)(b))</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 border-b border-border">Billing information (via Stripe)</td>
                    <td className="py-2 pr-4 border-b border-border">Processing payments</td>
                    <td className="py-2 border-b border-border">Contract (Art. 6(1)(b))</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 border-b border-border">Webhook endpoint URLs and Slack workspace data</td>
                    <td className="py-2 pr-4 border-b border-border">Delivering notifications to your chosen channels</td>
                    <td className="py-2 border-b border-border">Contract (Art. 6(1)(b))</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 border-b border-border">Error and diagnostic logs</td>
                    <td className="py-2 pr-4 border-b border-border">Debugging and service reliability</td>
                    <td className="py-2 border-b border-border">Legitimate interests (Art. 6(1)(f))</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 border-b border-border">Aggregate usage metrics (no individual profiling)</td>
                    <td className="py-2 pr-4 border-b border-border">Improving the service</td>
                    <td className="py-2 border-b border-border">Legitimate interests (Art. 6(1)(f))</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground mt-4">
              We do not sell your data. We do not use your data for advertising.
            </p>
          </section>

          <Separator className="my-8" />

          {/* Section 3 — Cookies */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              3. Cookies
            </h2>
            <p className="text-muted-foreground">
              We use one strictly necessary session cookie to keep you
              authenticated. This cookie is set only when you sign in and is
              deleted when your session expires or you sign out. We do not use
              analytics cookies, tracking cookies, or third-party advertising
              cookies.
            </p>
          </section>

          <Separator className="my-8" />

          {/* Section 4 — How long we keep your data */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              4. How long we keep your data
            </h2>
            <ul className="space-y-2 list-none text-muted-foreground">
              <li>
                <strong className="text-foreground">Account data</strong> —
                retained while your account is active and for 30 days after
                deletion.
              </li>
              <li>
                <strong className="text-foreground">
                  Monitor and change history
                </strong>{" "}
                — retained for 90 days of change history on active monitors.
                Deleted within 30 days of account deletion.
              </li>
              <li>
                <strong className="text-foreground">Email delivery logs</strong>{" "}
                — retained for 90 days.
              </li>
              <li>
                <strong className="text-foreground">Billing records</strong> —
                governed by Stripe's data retention policies and applicable
                accounting regulations.
              </li>
              <li>
                <strong className="text-foreground">Server/error logs</strong> —
                retained for up to 30 days.
              </li>
            </ul>
          </section>

          <Separator className="my-8" />

          {/* Section 5 — Who we share data with */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              5. Who we share data with
            </h2>
            <p className="text-muted-foreground mb-4">
              We share data only with the following sub-processors, each subject
              to a Data Processing Agreement:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left font-semibold py-2 pr-4 border-b border-border">
                      Sub-processor
                    </th>
                    <th className="text-left font-semibold py-2 pr-4 border-b border-border">
                      Purpose
                    </th>
                    <th className="text-left font-semibold py-2 border-b border-border">
                      Location
                    </th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr>
                    <td className="py-2 pr-4 border-b border-border">Stripe</td>
                    <td className="py-2 pr-4 border-b border-border">Payment processing</td>
                    <td className="py-2 border-b border-border">USA (Standard Contractual Clauses)</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 border-b border-border">Resend</td>
                    <td className="py-2 pr-4 border-b border-border">Sending notification emails</td>
                    <td className="py-2 border-b border-border">USA (Standard Contractual Clauses)</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground mt-4">
              No other third parties receive your personal data. We will update
              this list if new sub-processors are added.
            </p>
          </section>

          <Separator className="my-8" />

          {/* Section 6 — International transfers */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              6. International transfers
            </h2>
            <p className="text-muted-foreground">
              Your data is processed within the EEA where possible. Where
              sub-processors are located outside the EEA (e.g. Stripe), transfers
              are governed by Standard Contractual Clauses approved by the
              European Commission, ensuring an equivalent level of protection.
            </p>
          </section>

          <Separator className="my-8" />

          {/* Section 7 — Your rights under GDPR */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              7. Your rights under GDPR
            </h2>
            <p className="text-muted-foreground mb-4">
              You have the following rights regarding your personal data:
            </p>
            <ul className="space-y-2 list-none text-muted-foreground">
              <li>
                <strong className="text-foreground">Right of access</strong> —
                Request a copy of the data we hold about you.
              </li>
              <li>
                <strong className="text-foreground">Right to rectification</strong>{" "}
                — Ask us to correct inaccurate data.
              </li>
              <li>
                <strong className="text-foreground">Right to erasure</strong> —
                Ask us to delete your data ("right to be forgotten"), subject to
                legal obligations.
              </li>
              <li>
                <strong className="text-foreground">Right to restriction</strong>{" "}
                — Ask us to restrict processing of your data.
              </li>
              <li>
                <strong className="text-foreground">
                  Right to data portability
                </strong>{" "}
                — Receive your data in a machine-readable format.
              </li>
              <li>
                <strong className="text-foreground">Right to object</strong> —
                Object to processing based on legitimate interests.
              </li>
              <li>
                <strong className="text-foreground">
                  Right to withdraw consent
                </strong>{" "}
                — Where processing is based on consent, withdraw it at any time.
              </li>
            </ul>
            <p className="text-muted-foreground mt-4">
              To exercise any of these rights, email{" "}
              <strong className="text-foreground">{SUPPORT_EMAIL}</strong>.
              We will respond within 30 days. You also have the right to lodge a
              complaint with the Norwegian supervisory authority:
            </p>
            <p className="text-muted-foreground mt-3">
              <strong className="text-foreground">Datatilsynet</strong>
              <br />
              Postboks 458 Sentrum, 0105 Oslo
              <br />
              <a
                href="https://www.datatilsynet.no"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                datatilsynet.no
              </a>
            </p>
          </section>

          <Separator className="my-8" />

          {/* Section 8 — Security */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              8. Security
            </h2>
            <p className="text-muted-foreground">
              We protect your data using industry-standard measures including TLS
              encryption in transit, hashed credentials, HMAC-signed webhook
              payloads, and access controls. No system is perfectly secure; if you
              discover a vulnerability, please contact us at{" "}
              <strong className="text-foreground">{SUPPORT_EMAIL}</strong>.
            </p>
          </section>

          <Separator className="my-8" />

          {/* Section 9 — Changes to this policy */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              9. Changes to this policy
            </h2>
            <p className="text-muted-foreground">
              We may update this policy from time to time. We will notify
              registered users by email for material changes. The "Last updated"
              date at the top of this page always reflects the current version.
            </p>
          </section>

          <Separator className="my-8" />

          {/* Section 10 — Contact */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              10. Contact
            </h2>
            <p className="text-muted-foreground">
              For any privacy-related questions or requests:
            </p>
            <p className="text-muted-foreground mt-2">
              Email:{" "}
              <strong className="text-foreground">{SUPPORT_EMAIL}</strong>
            </p>
          </section>
        </div>
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
          </div>
        </div>
      </footer>
    </div>
  );
}
