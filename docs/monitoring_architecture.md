# RedditPulse Monitoring Architecture v1

Generated: 2026-03-17

## Goal

Turn RedditPulse from a product with scattered retention features into a product with a real recurring monitoring system.

The current repo already has several monitor-like parts:

- `watchlists`
- `pain_alerts`
- `alert_matches`
- `competitor_complaints`
- Market Pulse deltas inside validation reports
- `morning_brief_cache`

The problem is that they are separate systems.

## Product Intent

A user should be able to:

1. save an opportunity
2. save a validation
3. watch a pain theme
4. later watch a competitor
5. come back and immediately see:
   - what changed
   - why it matters
   - what they should do next

That is the recurring engine behind subscriptions.

## Core Objects

### Monitor

A user-owned tracked object.

Examples:

- opportunity monitor
- validation monitor
- pain theme monitor

### Monitor Event

A structured change worth showing to the user.

Examples:

- confidence rose 8 points
- opportunity score dropped 6 points
- 3 new pain matches in the last 24h
- fresh complaint against a tracked competitor

## What Exists Today

### Validation monitors

Current source:

- `watchlists.validation_id`
- `idea_validations.report.market_pulse`
- `idea_validations.report.competition_landscape`

Current recurring signals available:

- confidence deltas
- report freshness
- competitor complaint overlap

### Opportunity monitors

Current source:

- `watchlists.idea_id`
- `ideas.current_score`
- `ideas.change_24h`
- `ideas.last_updated`

Current recurring signals available:

- score movement
- trend direction
- evidence freshness

### Pain theme monitors

Current source:

- `pain_alerts`
- `alert_matches`

Current recurring signals available:

- new keyword-matched posts
- freshness of the last pain match
- source diversity of evidence

## Monitor Core v1

The repo now introduces two new schema objects:

- `monitors`
- `monitor_events`

They are intentionally lightweight.

### `monitors`

Purpose:

- represent the user's recurring tracked objects
- unify legacy watchlist and alert concepts

Important fields:

- `legacy_type`
- `legacy_id`
- `monitor_type`
- `title`
- `subtitle`
- `status`
- `trust_level`
- `trust_score`
- `last_checked_at`
- `last_changed_at`
- `metadata`

### `monitor_events`

Purpose:

- store the user-visible change stream

Important fields:

- `event_key`
- `event_type`
- `direction`
- `impact_level`
- `summary`
- `source_label`
- `href`
- `observed_at`
- `seen`

## Implementation Strategy

Do not rewrite the old systems first.

Use a safe bridge strategy:

1. continue using legacy tables as source of truth
2. synthesize unified monitors from those tables
3. best-effort sync them into `monitors` and `monitor_events`
4. only later migrate creation flows to native monitor tables

This keeps the current product working while the monitor model stabilizes.

## Current Event Sources

### For validation monitors

- Market Pulse confidence delta
- matched competitor complaints from recent `competitor_complaints`

### For opportunity monitors

- `ideas.change_24h`

### For pain theme monitors

- recent `alert_matches`

## Why This Matters

This architecture unlocks:

- weekly return value
- real digest/brief workflows
- stronger subscription logic
- clearer post-validation next actions

Without a monitor layer, RedditPulse stays too close to a one-shot report product.

## What Is Not In v1 Yet

Not included yet:

- competitor monitors as first-class createable objects
- keyword monitors beyond pain alerts
- read/unread event sync in the UI
- weekly brief driven directly from native monitor events
- proactive email/Slack delivery

These come after the monitor contract is stable.

## Recommended Next Step

After Monitor Core v1:

1. switch `/dashboard/saved` into a true `Monitors` experience
2. make Digest read from monitor events
3. add monitor creation CTAs from:
   - Opportunities
   - Validation reports
4. add competitor-specific monitors
