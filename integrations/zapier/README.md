# FetchTheChange Zapier App

A Zapier CLI app that triggers Zaps when FetchTheChange detects a change on a monitored web page.

## Prerequisites

- Node.js 18+
- Zapier Platform CLI: `npm install -g zapier-platform-cli`
- A Zapier developer account at https://developer.zapier.com/
- A FetchTheChange Power plan account with an API key (`ftc_` prefix)

## Setup

```bash
cd integrations/zapier
npm install
```

## Testing

```bash
zapier test
```

Requires a valid `ftc_` Power API key configured in `~/.zapierrc` or passed via environment variables.

## Deployment

1. Register a new app at https://developer.zapier.com/
2. Replace `REPLACE_WITH_ZAPIER_APP_ID` in `package.json` with your assigned app ID
3. Run `zapier push` to deploy the app

## Trigger: Monitor Value Changed

Fires when FetchTheChange detects a change on a monitored web page. Users can optionally select a specific monitor to watch, or leave the selection blank to trigger on any monitor change.

### Payload fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Change record ID (used by Zapier for deduplication) |
| `monitorId` | number | The monitor that detected the change |
| `monitorName` | string | Human-readable monitor name |
| `url` | string | The monitored page URL |
| `oldValue` | string \| null | Previous value (`null` on first detection) |
| `newValue` | string \| null | New value |
| `detectedAt` | string | ISO 8601 timestamp of when the change was captured |
| `timestamp` | string | ISO 8601 timestamp of when the event was sent |
