# Changelog

## Unreleased

<!-- next heading -->

### Added
- Zapier integration (Power): Power users can connect FetchTheChange to 7,000+ apps via Zapier. When a monitored value changes, a Zap fires automatically — no webhook server required. Alert conditions apply before Zapier delivery. See /docs/zapier.
- Make integration: Power and Pro users can connect FetchTheChange to Make (Integromat) using the existing webhook system and Make's Custom Webhook module. See /docs/make.
- New documentation pages at /docs/zapier and /docs/make.
- Alert conditions: attach up to 1 condition per monitor on Free, unlimited on Pro/Power. Notifications fire only when the new value meets the criteria — numeric thresholds, text matching, or regex. AND/OR group logic available on Pro/Power.
- Changes are always recorded in history regardless of whether conditions pass, so no history is ever suppressed.
- Monitor health alerts: Power-tier users now receive an early-warning email when a monitor hits the halfway point before auto-pause, and a recovery email when it returns to healthy. All users see a colour-coded health indicator (green / amber / red) on every monitor card.
- Dashboard "Needs attention" filter: quickly surface monitors that are degraded or paused without scrolling through the full list.
