# FetchTheChange - Web Monitor Application

## Overview

FetchTheChange is a web monitoring application designed to track and notify users about changes on specific elements of any webpage. It enables users to define monitors for CSS selectors, receive email notifications upon content alteration, and access a detailed history of changes. The application incorporates advanced features to bypass anti-bot measures, manage cookie consent banners, and process JavaScript-rendered content using headless browser technology.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **UI**: shadcn/ui, Tailwind CSS (dark mode default)
- **State Management**: TanStack React Query

### Backend
- **Runtime**: Node.js with Express, TypeScript
- **Authentication**: Replit Auth with OpenID Connect
- **Scheduling**: `node-cron` for monitor checks

### Web Scraping Service
- **Core Functionality**: Monitors webpage elements for changes.
- **Methods**: Cheerio for static HTML, Browserless (headless Chrome) for JavaScript-rendered pages.
- **Anti-Bot & Consent**: Detects and bypasses anti-bot challenges (e.g., Cloudflare) and cookie consent dialogs (e.g., OneTrust).
- **Change Detection**: Tracks status (ok, blocked, selector_missing, error) and preserves `currentValue` on failed checks to prevent false notifications.

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM
- **Key Tables**: `users`, `sessions`, `monitors`, `monitor_changes`

### Features
- **Fix Selector Tool**: UI tool assists users in finding and validating CSS selectors.
- **Tier System**: Limits monitors based on subscription tiers (Free, Pro, Power).
- **Stripe Integration**: Handles subscription payments and tier management.
- **Email Notifications**: Utilizes Resend API for sending change notifications, supporting custom notification emails.
- **Rate Limiting**: Tiered rate limiting on API endpoints to manage resource usage.
- **Event Log System**: Internal logging for errors and critical events with admin dashboard.
- **Usage Tracking**: Monitors Browserless and Resend API usage against caps to control costs.
- **Security Hardening**: Includes SSRF protection, CORS configuration, session fixation prevention, and log sanitization.

## External Dependencies

- **Required Environment Variables**: `DATABASE_URL`, `SESSION_SECRET`, `ISSUER_URL`, `REPL_ID`
- **Optional Environment Variables**: `RESEND_API_KEY`, `RESEND_FROM`, `BROWSERLESS_TOKEN`

### Third-Party Services
- **Replit Auth**: User authentication
- **Resend**: Transactional email delivery
- **Browserless.io**: Headless Chrome as a service

### Key NPM Dependencies
- `drizzle-orm`: Database ORM
- `cheerio`: HTML parsing
- `playwright-core`: Browser automation
- `resend`: Email API client
- `node-cron`: Scheduler
- `passport`, `openid-client`: Authentication