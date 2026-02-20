# FetchTheChange

A web monitoring application that tracks changes to specific elements on any webpage and sends email notifications when content changes. Define CSS selectors, set check frequencies, and get alerted automatically.

## Features

- **Monitor any webpage element** — Track prices, stock status, text content, or any element identifiable by a CSS selector
- **JavaScript rendering support** — Handles SPAs and dynamic content via Browserless (headless Chrome)
- **Anti-bot & consent bypass** — Detects and handles Cloudflare challenges and cookie consent banners
- **Email notifications** — Get notified via Resend when monitored content changes
- **Change history** — Browse a full timeline of detected changes for each monitor
- **Selector assistance** — Built-in tool to help find and validate CSS selectors
- **Subscription tiers** — Free, Pro, and Power tiers with Stripe billing
- **Admin dashboard** — Error logs, email campaigns, and usage tracking

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Tailwind CSS, shadcn/ui, TanStack React Query |
| Backend | Node.js, Express 5, TypeScript |
| Database | PostgreSQL, Drizzle ORM |
| Auth | Replit Auth (OpenID Connect) |
| Scraping | Cheerio (static HTML), Playwright via Browserless (JS-rendered) |
| Email | Resend |
| Payments | Stripe |
| Scheduling | node-cron |
| Testing | Vitest |

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database

### Environment Variables

**Required:**

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Secret for session encryption |
| `ISSUER_URL` | OpenID Connect issuer URL (Replit) |
| `REPL_ID` | Replit application ID |

**Optional:**

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | API key for sending email notifications |
| `RESEND_FROM` | Sender email address for notifications |
| `BROWSERLESS_TOKEN` | Token for Browserless.io headless Chrome service |

### Installation

```bash
npm install
```

### Database Setup

```bash
npm run schema:push
```

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm run start
```

## Project Structure

```
├── client/src/          # React frontend
│   ├── pages/           # Route pages (Dashboard, Landing, Pricing, etc.)
│   ├── components/      # UI and business logic components
│   ├── hooks/           # Custom React hooks
│   └── lib/             # Utilities
├── server/              # Express backend
│   ├── routes.ts        # API route handlers
│   ├── storage.ts       # Data access layer
│   ├── services/        # Scraper, scheduler, email, logging
│   ├── middleware/       # Auth, CSRF, rate limiting
│   └── utils/           # SSRF protection, helpers
├── shared/              # Shared types and schemas
│   ├── schema.ts        # Drizzle ORM table definitions
│   └── routes.ts        # API route definitions and validation
└── scripts/             # Build and utility scripts
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Bundle frontend and backend for production |
| `npm run start` | Run the production server |
| `npm run check` | Run TypeScript type checking |
| `npm run test` | Run tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run schema:push` | Apply database schema changes |

## Subscription Tiers

| Feature | Free | Pro | Power |
|---------|------|-----|-------|
| Monitors | 3 | 100 | Unlimited |
| JS rendering | No | 200 checks/month | 500 checks/month |
| Email notifications | 1 per day per monitor | Unlimited | Unlimited |

## License

MIT
