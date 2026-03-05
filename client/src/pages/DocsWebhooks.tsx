import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import PublicNav from "@/components/PublicNav";
import DashboardNav from "@/components/DashboardNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";

const DOCS_PATH = "/docs/webhooks";

function getCanonicalUrl() {
  const baseUrl =
    import.meta.env.VITE_PUBLIC_BASE_URL ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "https://fetch-the-change.replit.app");
  return `${baseUrl}${DOCS_PATH}`;
}

function SEOHead() {
  useEffect(() => {
    const canonicalUrl = getCanonicalUrl();

    document.title =
      "Webhook Integration | FetchTheChange Developer Docs";

    const metaTags = [
      {
        name: "description",
        content:
          "Learn how to receive FetchTheChange change alerts via webhooks. Covers payload format, HMAC signature verification, retries, and testing.",
      },
      {
        property: "og:title",
        content: "Webhook Integration | FetchTheChange Developer Docs",
      },
      {
        property: "og:description",
        content:
          "Learn how to receive FetchTheChange change alerts via webhooks. Covers payload format, HMAC signature verification, retries, and testing.",
      },
      { property: "og:type", content: "article" },
      { property: "og:url", content: canonicalUrl },
      { name: "twitter:card", content: "summary" },
      {
        name: "twitter:title",
        content: "Webhook Integration | FetchTheChange Developer Docs",
      },
      {
        name: "twitter:description",
        content:
          "Learn how to receive FetchTheChange change alerts via webhooks. Covers payload format, HMAC signature verification, retries, and testing.",
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

    return () => {
      existingMetas.forEach((meta) => meta.remove());
      canonicalLink.remove();
    };
  }, []);

  return null;
}

export default function DocsWebhooks() {
  const { user, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead />
      {!isLoading && (user ? <DashboardNav /> : <PublicNav />)}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
        {/* Header */}
        <header className="mb-12">
          <Badge variant="secondary" className="mb-4">
            Developer Docs
          </Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold mb-4">
            Receiving change alerts via webhooks
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Webhooks let you receive an HTTP POST to your own endpoint whenever
            FetchTheChange detects a change on a monitored page.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Webhook delivery is available on Pro and Power plans.
          </p>
        </header>

        <div className="prose prose-invert max-w-none space-y-10">
          {/* How it works */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              How it works
            </h2>
            <p className="text-muted-foreground">
              When a monitor detects a change, FetchTheChange POSTs a signed
              JSON payload to the webhook endpoint you configured for that
              monitor. Your receiving server processes the payload and responds
              with a 2xx status code to acknowledge receipt. No polling is
              required on your side — changes are pushed to you in real time.
            </p>
          </section>

          {/* Setting up a webhook */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Setting up a webhook
            </h2>
            <ol className="list-decimal list-inside space-y-3 text-muted-foreground">
              <li>
                Open a monitor's detail page and navigate to{" "}
                <strong className="text-foreground">
                  Notification Channels
                </strong>
                .
              </li>
              <li>
                Enable the{" "}
                <strong className="text-foreground">Webhook</strong> channel and
                paste in the HTTPS endpoint URL.
              </li>
              <li>
                Copy the generated secret — it is shown only once. Store it as
                an environment variable in the receiving application, never in
                source code.
              </li>
            </ol>
          </section>

          {/* Payload reference */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Payload reference
            </h2>
            <p className="text-muted-foreground mb-4">
              Every webhook request carries a JSON body with the following
              structure. Here is a realistic example:
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
              The <code className="text-foreground">event</code> field is always{" "}
              <code className="text-foreground">"change.detected"</code>.{" "}
              <code className="text-foreground">monitorId</code> and{" "}
              <code className="text-foreground">monitorName</code> identify the
              monitor that triggered the alert.{" "}
              <code className="text-foreground">url</code> is the page being
              monitored.{" "}
              <code className="text-foreground">oldValue</code> contains the
              previous value and{" "}
              <code className="text-foreground">newValue</code> contains the
              updated value.{" "}
              <code className="text-foreground">oldValue</code> is{" "}
              <code className="text-foreground">null</code> on the first
              detection for a monitor.{" "}
              <code className="text-foreground">detectedAt</code> records when
              the scheduler captured the change, while{" "}
              <code className="text-foreground">timestamp</code> records when
              the HTTP request was dispatched. Both are ISO 8601 strings.
            </p>
          </section>

          {/* Verifying signatures */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Verifying signatures
            </h2>
            <p className="text-muted-foreground mb-4">
              Every webhook request includes an{" "}
              <code className="text-foreground">X-FTC-Signature-256</code>{" "}
              header. This header contains an HMAC-SHA256 signature of the raw
              request body, computed using the secret generated when you enabled
              the webhook. Verifying this signature ensures that the payload was
              genuinely sent by FetchTheChange and has not been tampered with in
              transit. Without verification, any party who knows your endpoint
              URL could send spoofed payloads.
            </p>

            <h3 className="text-xl font-semibold mt-6 mb-3">Node.js</h3>
            <pre className="bg-secondary rounded-lg p-4 overflow-x-auto text-sm">
              <code>{`import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(rawBody, signature, secret) {
  const expected = "sha256=" + createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}`}</code>
            </pre>

            <h3 className="text-xl font-semibold mt-6 mb-3">Python</h3>
            <pre className="bg-secondary rounded-lg p-4 overflow-x-auto text-sm">
              <code>{`import hashlib, hmac

def verify_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)`}</code>
            </pre>

            <h3 className="text-xl font-semibold mt-6 mb-3">Go</h3>
            <pre className="bg-secondary rounded-lg p-4 overflow-x-auto text-sm">
              <code>{`import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
)

func verifySignature(rawBody []byte, signature, secret string) bool {
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write(rawBody)
    expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
    return hmac.Equal([]byte(signature), []byte(expected))
}`}</code>
            </pre>

            <div className="bg-secondary/50 rounded-lg p-4 border border-border mt-6">
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">Important:</strong> Always
                verify against the raw request body bytes, not a re-serialised
                version of a parsed JSON object. Re-serialisation can change
                whitespace or key ordering and will cause legitimate requests to
                fail verification.
              </p>
            </div>
          </section>

          {/* Retry behavior and the Delivery Log */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Retry behavior and the Delivery Log
            </h2>
            <p className="text-muted-foreground">
              FetchTheChange retries failed deliveries automatically. An
              endpoint must return a 2xx status code within 5 seconds to be
              treated as a successful delivery. Responses outside that window or
              with non-2xx status codes are recorded as failures and retried.
              Every delivery attempt — including the HTTP status code, any error
              message, and a timestamp — is visible in the Delivery Log on the
              monitor's detail page.
            </p>
          </section>

          {/* Testing */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">Testing</h2>
            <p className="text-muted-foreground">
              During development, a tool such as webhook.site is useful for
              capturing live payloads without standing up your own server. Point
              your monitor's webhook URL at the generated endpoint and trigger a
              change to see exactly what FetchTheChange sends. The Delivery Log
              on the monitor's detail page shows the full request including
              headers, which makes it straightforward to reproduce issues in a
              staging environment.
            </p>
          </section>

          {/* Security considerations */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Security considerations
            </h2>
            <p className="text-muted-foreground">
              Always verify the signature before acting on a payload — this
              prevents spoofed requests from triggering actions in your system.
              Use HTTPS endpoints only; plaintext HTTP exposes the payload and
              signature in transit, which would allow an attacker on the network
              path to read secrets and forge future requests. Never log or commit
              your webhook secret to source control. Treat it with the same care
              as an API key or database password.
            </p>
          </section>

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
