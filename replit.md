# FetchTheChange - Web Monitor Application

## Overview

FetchTheChange is a web monitoring application that tracks changes on any webpage element. Users can set up monitors to watch specific CSS selectors on websites, receive email notifications when content changes, and view detailed change history. The application handles anti-bot detection, cookie consent dialogs, and JavaScript-rendered pages through a headless browser integration.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (dark mode default)
- **Build Tool**: Vite with path aliases (`@/` for client, `@shared/` for shared code)

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Pattern**: RESTful endpoints under `/api/` prefix
- **Authentication**: Replit Auth integration with OpenID Connect, session-based with PostgreSQL session store
- **Scheduled Tasks**: node-cron for periodic monitor checks (every minute scheduler evaluates which monitors need checking)

### Web Scraping Service
The scraper (`server/services/scraper.ts`) is the core feature with these capabilities:
- **Primary Method**: Cheerio for HTML parsing of simple pages
- **Fallback Method**: Browserless (headless Chrome) for JavaScript-rendered content
- **Anti-Bot Detection**: Detects interstitial pages (Cloudflare challenges, captcha, etc.) with robust visible-text analysis that ignores noscript/script/style content to avoid false positives
- **Cookie Consent Handling**: Generic dismissal of OneTrust and common consent banners (supports iframe detection)
- **Status Tracking**: Monitors track status separately from value (ok, blocked, selector_missing, error)
- **Value Normalization**: Handles invisible characters and whitespace normalization

### Scraping Pipeline
1. Fetch static HTML via fetch/curl
2. Extract value using CSS selector
3. If selector found → return value (status: ok)
4. If selector not found OR blocked detected:
   - With BROWSERLESS_TOKEN → render via headless Chrome with consent dismissal
   - Re-check block detection on rendered DOM
   - Retry selector extraction
5. Final status determines outcome (blocked vs selector_missing vs ok)

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM
- **Schema Location**: `shared/schema.ts`
- **Key Tables**:
  - `users` - Replit Auth user data
  - `sessions` - Session storage for auth
  - `monitors` - User's webpage monitors (url, selector, frequency, currentValue, lastStatus, lastError)
  - `monitor_changes` - Historical record of detected changes (only created for successful extractions)

### Fix Selector Tool
The application includes a UI tool to help users fix broken selectors:
- **Location**: Monitor detail page, under CSS Selector section
- **Flow**:
  1. User clicks "Fix selector" button
  2. Modal opens with optional "expected text" input
  3. User clicks "Suggest" to scan page for matching selectors
  4. Suggestions display selector, sample text, and match count
  5. User clicks "Use this selector" to apply
  6. System automatically runs check and shows result
- **Backend**: `POST /api/monitors/:id/suggest-selectors` uses Browserless to scan pages

### Tier System
The application enforces monitor limits based on user subscription tier:
- **Free**: 5 monitors (default for new users)
- **Pro**: 100 monitors ($9/month)
- **Power**: Unlimited monitors ($29/month)

Enforcement:
- **Backend**: Create monitor endpoint checks user tier and current count before allowing creation
- **Frontend**: Dashboard shows tier badge and usage (e.g., "3 / 5 monitors used")
- **Config**: Tier limits defined in `shared/models/auth.ts` via TIER_LIMITS constant
- **Database**: `users.tier` column with default "free"

### Stripe Payment Integration
Subscription payments are handled via Stripe integration:
- **Client**: `server/stripeClient.ts` - Fetches credentials from Replit connection API
- **Webhook Handler**: `server/webhookHandlers.ts` - Processes subscription events to update user tier
- **Routes**: 
  - `GET /api/stripe/config` - Returns publishable key for frontend
  - `GET /api/stripe/plans` - Lists available subscription plans from database
  - `POST /api/stripe/checkout` - Creates Stripe checkout session (validates priceId)
  - `GET /api/stripe/subscription` - Returns user's current subscription
  - `POST /api/stripe/portal` - Creates customer portal session for subscription management
- **Schema**: `stripe.*` tables managed by stripe-replit-sync package
- **Seed Script**: `scripts/seed-stripe-products.ts` - Creates Pro and Power products in Stripe
- **UI**: `UpgradeDialog` component shows plans and handles checkout flow

### Email Notifications
- **Provider**: Resend API
- **Trigger**: When a monitor detects a value change
- **Fallback**: Console logging when RESEND_API_KEY is not configured
- **Custom Notification Email**: Users can set a custom email address to receive notifications instead of their account email
  - **Database**: `users.notificationEmail` column (nullable varchar)
  - **API**: `PATCH /api/auth/user/notification-email` to update custom email
  - **UI**: Settings button in Dashboard header opens NotificationEmailDialog
  - **Priority**: Uses `user.notificationEmail` if set, falls back to `user.email`

## External Dependencies

### Required Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Session encryption key
- `ISSUER_URL` - Replit OIDC issuer (defaults to https://replit.com/oidc)
- `REPL_ID` - Replit app identifier

### Optional Environment Variables
- `RESEND_API_KEY` - For email notifications
- `RESEND_FROM` - Sender email address
- `BROWSERLESS_TOKEN` - For JavaScript-rendered page scraping

### Third-Party Services
- **Replit Auth**: User authentication via OpenID Connect
- **Resend**: Transactional email delivery
- **Browserless.io**: Headless Chrome as a service for complex page scraping

### Key NPM Dependencies
- `drizzle-orm` + `drizzle-kit` - Database ORM and migrations
- `cheerio` - HTML parsing for static content
- `playwright-core` - Browser automation (with Browserless integration)
- `resend` - Email API client
- `node-cron` - Scheduled task execution
- `passport` + `openid-client` - Authentication

### Public Navigation
Shared navigation component for all public pages:
- **Component**: `client/src/components/PublicNav.tsx`
- **Links**: FetchTheChange logo, How it works, Use cases, Blog, Pricing, Sign in
- **Features**: 
  - Sticky positioning with backdrop blur
  - Desktop: horizontal menu
  - Mobile: hamburger menu with slide-out sheet
  - Anchor links scroll smoothly when on homepage

### Public Pages
- **Homepage**: `/` - Landing page with hero, features, pricing, use cases
- **Blog Index**: `/blog` - List of blog articles
- **Pricing**: `/pricing` - Dedicated pricing page with FAQ

### Blog Pages
Public, SEO-optimized blog articles for content marketing:
- **Location**: `client/src/pages/Blog*.tsx`
- **Route Pattern**: `/blog/{slug}`
- **Current Articles**:
  - `/blog/why-website-change-monitors-fail-silently` - Article about silent monitor failures
- **SEO Features**: Meta tags, Open Graph, Twitter cards, canonical URLs, JSON-LD structured data
- **Canonical URL**: Uses `VITE_PUBLIC_BASE_URL` env var with fallback to `window.location.origin`