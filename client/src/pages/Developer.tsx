import { useAuth } from "@/hooks/use-auth";
import PublicNav from "@/components/PublicNav";
import DashboardNav from "@/components/DashboardNav";
import SEOHead from "@/components/SEOHead";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-secondary rounded-lg p-4 overflow-x-auto text-sm">
      <code>{children}</code>
    </pre>
  );
}

export default function Developer() {
  const { user, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="REST API Documentation | FetchTheChange Developer Docs"
        description="FetchTheChange REST API documentation. Create monitors, pull change history, and integrate website monitoring into your CI/CD pipelines. Power plan required."
        path="/developer"
        ogType="article"
        ogDescription="FetchTheChange REST API documentation. Create monitors, pull change history, and integrate website monitoring into your tools."
        twitterTitle="REST API Documentation | FetchTheChange"
        twitterDescription="FetchTheChange REST API documentation for Power plan users."
      />
      {!isLoading && (user ? <DashboardNav /> : <PublicNav />)}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
        {/* Header */}
        <header className="mb-12">
          <Badge variant="secondary" className="mb-4">
            Developer Docs
          </Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold mb-4">
            FetchTheChange REST API
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Create monitors, pull change history, and integrate website change
            detection into your workflows — all through a simple REST API.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            API access is available on the{" "}
            <Link href="/pricing" className="text-primary hover:underline">
              Power plan
            </Link>
            .
          </p>
        </header>

        <div className="prose prose-invert max-w-none space-y-10">
          {/* Overview */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">Overview</h2>
            <p className="text-muted-foreground">
              The FetchTheChange API is a versioned REST surface that lets
              Power-tier users manage monitors programmatically, retrieve
              detected changes, and integrate FetchTheChange into CI/CD
              pipelines, dashboards, and automation tools. The API uses Bearer
              token authentication with API keys that you generate from your
              dashboard.
            </p>
          </section>

          <Separator />

          {/* Authentication */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Authentication
            </h2>
            <p className="text-muted-foreground mb-4">
              Every API request must include an{" "}
              <code className="text-foreground">Authorization</code> header with
              your API key:
            </p>
            <CodeBlock>{`Authorization: Bearer ftc_your_api_key_here`}</CodeBlock>
            <p className="text-muted-foreground mt-4">
              Generate API keys from your{" "}
              <Link href="/dashboard" className="text-primary hover:underline">
                dashboard
              </Link>
              . You can create up to 5 active keys and name each one for easy
              identification. Keys are shown only once at creation — store them
              securely and never commit them to source code.
            </p>
          </section>

          <Separator />

          {/* Base URL & Versioning */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Base URL &amp; versioning
            </h2>
            <CodeBlock>{`https://ftc.bd73.com/api/v1/`}</CodeBlock>
            <p className="text-muted-foreground mt-4">
              All endpoints are under <code className="text-foreground">/api/v1/</code>.
              Breaking changes will increment the version number. Non-breaking
              additions (new fields, new endpoints) may be added to v1 without a
              version bump.
            </p>
          </section>

          <Separator />

          {/* Rate limits */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Rate limits
            </h2>
            <p className="text-muted-foreground mb-4">
              Each API key is limited to <strong>300 requests per minute</strong>.
              Every response includes the following headers:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>
                <code className="text-foreground">X-RateLimit-Limit</code> —
                maximum requests per window (300)
              </li>
              <li>
                <code className="text-foreground">X-RateLimit-Remaining</code> —
                requests remaining in the current window
              </li>
              <li>
                <code className="text-foreground">X-RateLimit-Reset</code> —
                Unix timestamp when the window resets
              </li>
            </ul>
            <p className="text-muted-foreground mt-4">
              If you exceed the limit, the API returns{" "}
              <code className="text-foreground">429 Too Many Requests</code> with:
            </p>
            <CodeBlock>{`{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED"
}`}</CodeBlock>
          </section>

          <Separator />

          {/* Quickstart */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Quickstart
            </h2>
            <p className="text-muted-foreground mb-4">
              Test your key, create a monitor, then fetch its change history:
            </p>

            <h3 className="text-lg font-semibold mb-2 text-foreground">
              1. Test your key
            </h3>
            <CodeBlock>{`curl -H "Authorization: Bearer ftc_your_key" \\
  https://ftc.bd73.com/api/v1/ping`}</CodeBlock>
            <p className="text-muted-foreground mt-2 mb-4">Response:</p>
            <CodeBlock>{`{
  "ok": true,
  "userId": "user_abc123",
  "keyPrefix": "ftc_a1b2c3d4"
}`}</CodeBlock>

            <h3 className="text-lg font-semibold mb-2 mt-6 text-foreground">
              2. Create a monitor
            </h3>
            <CodeBlock>{`curl -X POST https://ftc.bd73.com/api/v1/monitors \\
  -H "Authorization: Bearer ftc_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Competitor pricing",
    "url": "https://example.com/pricing",
    "selector": ".price-value",
    "frequency": "hourly"
  }'`}</CodeBlock>
            <p className="text-muted-foreground mt-2 mb-4">Response (201):</p>
            <CodeBlock>{`{
  "id": 42,
  "name": "Competitor pricing",
  "url": "https://example.com/pricing",
  "selector": ".price-value",
  "active": true,
  "emailEnabled": true,
  "checkInterval": "hourly",
  "lastCheckedAt": null,
  "lastValue": null,
  "createdAt": "2026-03-05T10:00:00.000Z",
  "updatedAt": null
}`}</CodeBlock>

            <h3 className="text-lg font-semibold mb-2 mt-6 text-foreground">
              3. Fetch change history
            </h3>
            <CodeBlock>{`curl -H "Authorization: Bearer ftc_your_key" \\
  "https://ftc.bd73.com/api/v1/monitors/42/changes?limit=10"`}</CodeBlock>
            <p className="text-muted-foreground mt-2 mb-4">Response:</p>
            <CodeBlock>{`{
  "data": [
    {
      "id": 101,
      "monitorId": 42,
      "oldValue": "$49/mo",
      "newValue": "$59/mo",
      "detectedAt": "2026-03-05T14:22:00.000Z",
      "createdAt": "2026-03-05T14:22:00.000Z"
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 10 }
}`}</CodeBlock>
          </section>

          <Separator />

          {/* Endpoint reference */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-6">
              Endpoint reference
            </h2>

            {/* Ping */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-2 text-foreground">
                <Badge variant="secondary" className="mr-2">GET</Badge>
                /api/v1/ping
              </h3>
              <p className="text-muted-foreground mb-2">
                Test API key validity. Does not count against rate limits.
              </p>
              <CodeBlock>{`curl -H "Authorization: Bearer ftc_your_key" \\
  https://ftc.bd73.com/api/v1/ping`}</CodeBlock>
            </div>

            {/* List monitors */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-2 text-foreground">
                <Badge variant="secondary" className="mr-2">GET</Badge>
                /api/v1/monitors
              </h3>
              <p className="text-muted-foreground mb-2">
                List all monitors. Query params:{" "}
                <code className="text-foreground">page</code> (default 1),{" "}
                <code className="text-foreground">limit</code> (default 20, max 100).
              </p>
              <CodeBlock>{`curl -H "Authorization: Bearer ftc_your_key" \\
  "https://ftc.bd73.com/api/v1/monitors?page=1&limit=20"`}</CodeBlock>
            </div>

            {/* Create monitor */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-2 text-foreground">
                <Badge variant="secondary" className="mr-2">POST</Badge>
                /api/v1/monitors
              </h3>
              <p className="text-muted-foreground mb-2">
                Create a new monitor. Required fields:{" "}
                <code className="text-foreground">name</code>,{" "}
                <code className="text-foreground">url</code>,{" "}
                <code className="text-foreground">selector</code>. Optional:{" "}
                <code className="text-foreground">frequency</code> (daily/hourly; hourly requires Pro or Power plan),{" "}
                <code className="text-foreground">active</code> (boolean).
              </p>
              <CodeBlock>{`curl -X POST https://ftc.bd73.com/api/v1/monitors \\
  -H "Authorization: Bearer ftc_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "My Monitor", "url": "https://example.com", "selector": "h1"}'`}</CodeBlock>
            </div>

            {/* Get monitor */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-2 text-foreground">
                <Badge variant="secondary" className="mr-2">GET</Badge>
                /api/v1/monitors/:id
              </h3>
              <p className="text-muted-foreground mb-2">
                Get a single monitor by ID. Returns 404 if not found or not owned
                by the authenticated user.
              </p>
              <CodeBlock>{`curl -H "Authorization: Bearer ftc_your_key" \\
  https://ftc.bd73.com/api/v1/monitors/42`}</CodeBlock>
            </div>

            {/* Update monitor */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-2 text-foreground">
                <Badge variant="secondary" className="mr-2">PATCH</Badge>
                /api/v1/monitors/:id
              </h3>
              <p className="text-muted-foreground mb-2">
                Partial update. Any subset of:{" "}
                <code className="text-foreground">name</code>,{" "}
                <code className="text-foreground">url</code>,{" "}
                <code className="text-foreground">selector</code>,{" "}
                <code className="text-foreground">frequency</code>,{" "}
                <code className="text-foreground">active</code>,{" "}
                <code className="text-foreground">emailEnabled</code>.
              </p>
              <CodeBlock>{`curl -X PATCH https://ftc.bd73.com/api/v1/monitors/42 \\
  -H "Authorization: Bearer ftc_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"active": false}'`}</CodeBlock>
            </div>

            {/* Delete monitor */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-2 text-foreground">
                <Badge variant="secondary" className="mr-2">DELETE</Badge>
                /api/v1/monitors/:id
              </h3>
              <p className="text-muted-foreground mb-2">
                Delete a monitor and all associated data. Returns 204.
              </p>
              <CodeBlock>{`curl -X DELETE -H "Authorization: Bearer ftc_your_key" \\
  https://ftc.bd73.com/api/v1/monitors/42`}</CodeBlock>
            </div>

            {/* List changes */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-2 text-foreground">
                <Badge variant="secondary" className="mr-2">GET</Badge>
                /api/v1/monitors/:id/changes
              </h3>
              <p className="text-muted-foreground mb-2">
                Paginated change history. Query params:{" "}
                <code className="text-foreground">page</code>,{" "}
                <code className="text-foreground">limit</code> (max 200),{" "}
                <code className="text-foreground">from</code> (ISO datetime),{" "}
                <code className="text-foreground">to</code> (ISO datetime).
              </p>
              <CodeBlock>{`curl -H "Authorization: Bearer ftc_your_key" \\
  "https://ftc.bd73.com/api/v1/monitors/42/changes?from=2026-03-01T00:00:00Z&limit=50"`}</CodeBlock>
            </div>
          </section>

          <Separator />

          {/* Code examples */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Code examples
            </h2>

            <h3 className="text-lg font-semibold mb-2 text-foreground">
              Node.js (fetch)
            </h3>
            <CodeBlock>{`const API_KEY = process.env.FTC_API_KEY;
const BASE = "https://ftc.bd73.com/api/v1";

// Create a monitor
const res = await fetch(\`\${BASE}/monitors\`, {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Competitor pricing",
    url: "https://example.com/pricing",
    selector: ".price-value",
    frequency: "hourly",
  }),
});
const monitor = await res.json();
console.log("Created monitor:", monitor.id);

// Poll for changes
const changes = await fetch(
  \`\${BASE}/monitors/\${monitor.id}/changes?limit=5\`,
  { headers: { "Authorization": \`Bearer \${API_KEY}\` } }
).then(r => r.json());
console.log("Recent changes:", changes.data);`}</CodeBlock>

            <h3 className="text-lg font-semibold mb-2 mt-6 text-foreground">
              Python (requests)
            </h3>
            <CodeBlock>{`import os, requests

API_KEY = os.environ["FTC_API_KEY"]
BASE = "https://ftc.bd73.com/api/v1"
headers = {"Authorization": f"Bearer {API_KEY}"}

# Create a monitor
resp = requests.post(f"{BASE}/monitors", headers=headers, json={
    "name": "Competitor pricing",
    "url": "https://example.com/pricing",
    "selector": ".price-value",
    "frequency": "hourly",
})
monitor = resp.json()
print("Created monitor:", monitor["id"])

# Poll for changes
changes = requests.get(
    f"{BASE}/monitors/{monitor['id']}/changes",
    headers=headers, params={"limit": 5}
).json()
print("Recent changes:", changes["data"])`}</CodeBlock>
          </section>

          <Separator />

          {/* Error reference */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              Error reference
            </h2>
            <p className="text-muted-foreground mb-4">
              All errors follow the format{" "}
              <code className="text-foreground">
                {`{ "error": "...", "code": "..." }`}
              </code>
              .
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-semibold">Code</th>
                    <th className="text-left py-2 pr-4 font-semibold">HTTP</th>
                    <th className="text-left py-2 font-semibold">Description</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b">
                    <td className="py-2 pr-4"><code className="text-foreground">INVALID_API_KEY</code></td>
                    <td className="py-2 pr-4">401</td>
                    <td className="py-2">Missing, malformed, or revoked API key</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4"><code className="text-foreground">TIER_LIMIT_REACHED</code></td>
                    <td className="py-2 pr-4">403</td>
                    <td className="py-2">API access requires a Power plan</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4"><code className="text-foreground">RATE_LIMIT_EXCEEDED</code></td>
                    <td className="py-2 pr-4">429</td>
                    <td className="py-2">Exceeded 300 requests per minute</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4"><code className="text-foreground">SSRF_BLOCKED</code></td>
                    <td className="py-2 pr-4">422</td>
                    <td className="py-2">Monitor URL points to a private/internal address</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4"><code className="text-foreground">KEY_LIMIT_REACHED</code></td>
                    <td className="py-2 pr-4">400</td>
                    <td className="py-2">Maximum 5 active API keys per user</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4"><code className="text-foreground">FREQUENCY_TIER_RESTRICTED</code></td>
                    <td className="py-2 pr-4">403</td>
                    <td className="py-2">Hourly frequency requires a Pro or Power plan</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4"><code className="text-foreground">NOT_FOUND</code></td>
                    <td className="py-2 pr-4">404</td>
                    <td className="py-2">Resource not found or not owned by you</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4"><code className="text-foreground">VALIDATION_ERROR</code></td>
                    <td className="py-2 pr-4">422</td>
                    <td className="py-2">Request body or query params failed validation</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <Separator />

          {/* OpenAPI spec */}
          <section>
            <h2 className="text-2xl font-display font-bold mb-4">
              OpenAPI specification
            </h2>
            <p className="text-muted-foreground">
              A machine-readable OpenAPI 3.1 spec is available at{" "}
              <a
                href="/api/v1/openapi.json"
                className="text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                /api/v1/openapi.json
              </a>
              . Import it into tools like Postman, Insomnia, or any OpenAPI-compatible client to explore the API interactively.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
