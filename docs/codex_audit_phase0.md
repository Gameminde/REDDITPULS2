# Codex Audit Phase 0

Generated: 2026-03-17

## Scope

This audit is grounded in the current repository code, not the README alone.

Primary files inspected:

- `validate_idea.py`
- `scraper_job.py`
- `enrich_idea.py`
- `engine/multi_brain.py`
- `engine/keyword_scraper.py`
- `engine/hn_scraper.py`
- `engine/ph_scraper.py`
- `engine/ih_scraper.py`
- `engine/pain_stream.py`
- `engine/competitor_deathwatch.py`
- `engine/morning_brief.py`
- `engine/trends_aggregator.py`
- `sql/schema_stock_market.sql`
- `migrations/005_strategic_features.sql`
- `migrations/006_morning_brief_cache.sql`
- `migrations/007_idea_validations_extra_columns.sql`
- `migrations/008_ideas_theme_fields.sql`
- `app/src/app/api/*` routes for ideas, trends, validate, watchlist, digest, intelligence, scan, discover
- `app/src/app/dashboard/*` pages for validate, explore, trends, reports, alerts, competitors, saved, digest, scans, pricing, settings
- `app/src/lib/check-premium.ts`
- `app/src/lib/use-user-plan.ts`

## Executive Summary

RedditPulse already contains the seeds of the four target product objects:

- `Opportunity` -> `ideas`, `idea_history`
- `Validation` -> `idea_validations`
- `Monitor` -> `watchlists`, `pain_alerts`, `competitor_complaints`, `market_pulse`
- `Brief` -> `morning_brief_cache`, `/api/digest`

The strongest thing in the product today is the validation/report engine. When source quality is good, the user gets a legitimately useful founder decision artifact.

The biggest structural problem is that RedditPulse currently behaves like three overlapping products:

1. a one-shot AI idea validator
2. a recurring opportunity scanner
3. a premium intelligence dashboard that often rehydrates sections from old reports instead of using a unified live intelligence model

That overlap creates confusion in the UI, duplicated backend logic, and a weak subscription story.

The repo is much closer to a subscription-worthy intelligence product than it may look at first glance, but the next work should be mostly about unification, trust signals, and monitorability, not feature sprawl.

## 1. Current App Structure

### Backend/orchestrator layer

- `validate_idea.py` is the flagship on-demand orchestration pipeline.
- `scraper_job.py` is the recurring market intelligence engine that feeds `ideas` and related recurring systems.
- `run_scan.py` is a separate scan pipeline for user-initiated keyword scans.
- `enrich_idea.py` is a secondary enrichment pipeline for Stack Overflow, GitHub Issues, G2, and App Store data.
- `engine/multi_brain.py` powers multi-model debate and fallback routing.

### Frontend/app layer

Primary dashboard routes:

- `/dashboard/validate`
- `/dashboard/reports`
- `/dashboard/explore`
- `/dashboard/trends`
- `/dashboard/alerts`
- `/dashboard/competitors`
- `/dashboard/saved`
- `/dashboard/digest`
- `/dashboard/scans`
- `/dashboard/settings`
- `/dashboard/pricing`

The active navigation shell is the floating dock in `app/src/app/dashboard/components/Dock.tsx`.

### Scheduled/recurring layer

- GitHub Actions triggers `scraper_job.py` on a schedule.
- That recurring job updates:
  - `posts`
  - `ideas`
  - `idea_history`
  - `scraper_runs`
  - `pain_alerts` matches
  - `competitor_complaints`
  - `trend_signals`
  - validation Market Pulse confidence deltas

## 2. Current Data Model

### Durable core tables

- `ideas`
  - current opportunity object
  - includes score, changes over time, trend direction, confidence level, source mix, ICP/competition JSON, post counts, pain metadata, timestamps
- `idea_history`
  - score history and movement tracking for ideas
- `idea_validations`
  - current validation object
  - stores verdict, confidence, status, and large JSON report payload
- `watchlists`
  - bridges user to `idea_id` and/or `validation_id`
- `scraper_runs`
  - recurring job status and volume tracking

### Recurring-value tables

- `pain_alerts`
- `alert_matches`
- `competitor_complaints`
- `morning_brief_cache`

### Supporting or legacy-ish tables/concepts

- `scans`
  - user-triggered keyword scan workflow
- `trend_signals`
  - still generated in the backend, but no longer the best user-facing trend model
- `enrichment_cache`
  - used by `enrich_idea.py`

### Current object mapping quality

- `ideas` is already the best candidate for the canonical `Opportunity`.
- `idea_validations` is already the canonical `Validation`.
- `Monitor` is fragmented across watchlists, alerts, competitor complaints, and report-linked pulse deltas.
- `Brief` exists but is still powered by mixed data sources and not yet clearly tied to monitors.

## 3. Sources and Collectors

### Core sources in the repo

- Reddit
- Hacker News
- Product Hunt
- Indie Hackers
- Stack Overflow
- GitHub Issues
- Google Trends
- G2 and App Store enrichment paths

### How collection works

- Reddit
  - anonymous/public scraping
  - async scraping
  - optional PRAW path
  - PullPush historical path for validation support
- Hacker News
  - Algolia search and recent search APIs
- Product Hunt
  - GraphQL first, RSS fallback
- Indie Hackers
  - Algolia first, web scrape fallback
- Stack Overflow / GitHub / G2 / App Store
  - enrichment flow, not the main scheduled opportunity engine

### Source status quality

- Reddit: good enough to prove value, but still scraping-dependent
- Hacker News: currently one of the strongest sources
- Product Hunt: degraded and fallback-heavy
- Indie Hackers: weak and noisy
- Stack Overflow/GitHub enrichment: valuable for trust, but not yet integrated as a first-class recurring signal layer

### Structural observation

The repo already has enough sources to prove the product.
The real need is not more source count, but better source role clarity:

- pain sources
- buyer/commercial proof sources
- timing/trend sources
- authority/verification sources

That framework is not yet encoded in the data model or UI.

## 4. Current Scoring Pipeline

### Opportunity scoring

Opportunity scoring lives primarily in `scraper_job.py`.

Current idea scoring is deterministic and blends things like:

- 24h and 7d movement
- post volume
- source diversity
- engagement
- pain ratio
- topic-specific heuristics

`ideas` then stores:

- `current_score`
- `change_24h`
- `change_7d`
- `change_30d`
- `trend_direction`
- `confidence_level`
- post counts and sources

### Trend logic

Current user-facing Trends is no longer raw keyword momentum.
The route in `app/src/app/api/trend-signals/route.ts` now derives trends from fresh `ideas` rows, using:

- recent evidence
- `post_count_24h`
- `post_count_7d`
- source count
- velocity
- freshness gates

However, `engine/trends_aggregator.py` still writes `trend_signals`, and `engine/morning_brief.py` still reads `trend_signals`.

That means trend logic is split across:

- `ideas` for the UI
- `trend_signals` for parts of the brief/cache layer

### Scoring/trust gap

There is not yet one normalized explainability contract for idea scores.
The score exists, but the product does not consistently expose:

- evidence count
- direct quote count
- freshness score
- confidence cause
- direct evidence vs inferred conclusion

## 5. Current Validation Pipeline

The validation flow is the strongest product asset.

### Flow

1. user starts validation from `/dashboard/validate`
2. `/api/validate` inserts queued row in `idea_validations`
3. `validate_idea.py` runs:
   - AI decomposition
   - multi-source scrape
   - trends and competition analysis
   - batch summarization / evidence extraction
   - multi-pass synthesis
   - multi-model debate
   - report writing
4. polling route `/api/validate/[jobId]/status` returns queue + validation updates
5. report opens in `/dashboard/reports/[id]`

### What the report already does well

It already contains most of the raw material for a founder decision system:

- verdict
- confidence
- executive summary
- signal summary
- ICP
- pricing
- market timing
- competition
- financial reality
- risk matrix
- evidence
- monetization
- launch roadmap
- first 10 customers

### What the validation layer already encodes for trust

`validate_idea.py` already writes or computes:

- `data_quality`
- confidence caps
- contradiction warnings
- platform warnings
- partial coverage metadata
- `verdict_source`
- `debate_mode`
- `platform_breakdown`

This is a strong base for trust infrastructure.

### Validation gap

The report contains more trust signal than the rest of the product surface currently exposes.
The recurring opportunity side is behind the validation side in explainability.

## 6. Monitoring / Alerts / Watchlist Capabilities

### What already exists

- `watchlists`
  - save `idea_id` or `validation_id`
- `pain_alerts`
  - auto-created from validation keywords
- `alert_matches`
  - recurring relevant-post matches
- `competitor_complaints`
  - recurring negative signal capture
- `market_pulse`
  - confidence deltas on saved validations
- `morning_brief_cache`
  - cached recurring summary

### What this means strategically

The codebase already has a proto-monitoring system.
It is just not expressed as a unified product object.

Today the recurring layer feels split into separate features:

- Alerts
- Saved
- Competitors
- Digest

These should likely become one coherent monitor workflow instead of four adjacent modules.

### Current monitor gap

There is no explicit canonical `Monitor` object yet.
The system can already monitor things, but it stores that capability through several parallel tables and UI surfaces.

## 7. Report Generation Flow

### Current report UI

`app/src/app/dashboard/reports/[id]/page.tsx` is the flagship output page.

The best recent improvement is that the 13 report sections now remain visible even when data is missing, instead of disappearing entirely.

### What it currently does

- renders a premium deep analysis page
- supports watchlist save action
- surfaces debate content
- uses fallback parsing across schema drift
- exposes platform coverage warnings

### Current weakness

The report is still mostly a large analysis artifact.
It is not yet a reusable first-class `Decision Pack` object with explicit structure for:

- demand proof
- buyer clarity
- attack angle
- pricing test
- launch plan
- kill criteria

The data exists in parts, but not in a stable decision schema.

## 8. Premium Gating / Pricing Structure

### Current monetization implementation

Server and client gating are based on:

- `profiles.plan`
- email whitelist override

Premium gates exist on key routes such as:

- validate
- scans
- discover
- reports
- AI settings

### Pricing message in code

The current pricing stack is explicitly lifetime-oriented:

- pricing page says `One price. Lifetime access.`
- premium gate says `Upgrade — $49 lifetime`
- copy repeatedly emphasizes `No subscription`

### Why this matters

This is directly at odds with the stated product direction.

RedditPulse is becoming:

- monitorable
- alert-driven
- brief-driven
- recurring-decision-oriented

That makes the current pricing/gating model structurally misaligned with the product thesis.

## 9. UX Flow Across Core Pages

### Current user mental model in the code

Primary pages today:

- Validate
- Reports
- Alerts
- Explore
- Trends
- Competitors
- Saved
- Digest
- Scans
- Settings

### What the product currently feels like

The user is asked to understand several overlapping concepts:

- scan
- discover
- explore
- trend
- validate
- report
- saved
- alert
- digest
- sources
- WTP
- competitors

That is too many primary nouns for the current maturity of the product.

### What already feels closest to the future state

- Validate
- Explore
- Saved
- Digest

### Likely secondary or mergeable views

- Trends
  - likely should become a view or tab inside Opportunities/Explore
- Scans
  - likely should be an advanced/manual workflow, not a primary product pillar
- Sources
  - better as trust detail, not a primary nav page
- WTP
  - better as a report/decision-pack module, not a top-level destination
- Competitors
  - can remain important, but probably as a monitor/detail mode rather than a separate isolated concept

## 10. Obvious Technical Debt / Blockers

### 1. Parallel product systems

There are multiple overlapping engines for adjacent concepts:

- `ideas` vs `trend_signals`
- recurring opportunity engine vs scan engine
- live intelligence pages vs report-derived intelligence pages

### 2. Heavy schema coupling through raw REST patches

Python orchestrators depend heavily on exact table/column names and direct REST payloads.
This makes schema drift expensive and risky.

### 3. Provider/model complexity

`engine/multi_brain.py` supports many providers and model variants.
That is powerful, but it increases operational surface area faster than it increases user value.

### 4. Legacy surfaces still present

Older dashboard components and alternate UI patterns still exist in the repo.
Even when not actively used, they increase confusion and make the product feel less opinionated at the code level.

### 5. Test coverage is minimal

There is no real automated test suite protecting the product core.
The clearest validation harness in-repo is `run_validation_test.py`, which is an execution script, not a durable regression suite.

## 11. What Already Exists and Should Be Upgraded

These are the strongest assets to build on rather than rewrite:

### Upgrade, do not replace

- `ideas` as the canonical `Opportunity`
- `idea_validations` as the canonical `Validation`
- `watchlists` as the start of a monitor registry
- `pain_alerts` and `competitor_complaints` as monitor signal channels
- `morning_brief_cache` and `/api/digest` as the start of `Brief`
- report `data_quality` as the trust infrastructure seed
- `idea_history` as the movement-over-time backbone

## 12. What Should Be Removed, Merged, Renamed, or Deprioritized

### Merge or demote

- `Trends`
  - merge conceptually into Opportunities
- `Scans`
  - treat as advanced/manual discovery, not one of the main product nouns
- `Sources`
  - demote to evidence/trust detail
- `WTP`
  - fold into validation decision pack and monitor detail
- report-derived `/api/intelligence`
  - keep temporarily, but do not treat as the long-term live intelligence backbone

### Rename candidates

- `Explore` -> `Opportunities`
- `Saved` -> `Monitors`
- `Digest` -> `Brief`

Those names map much better to the target product model.

## 13. What Is Missing for Trust

### Missing product-level trust contract

The product needs a shared trust/explainability layer across both opportunities and validations.

Missing or inconsistent today:

- explicit evidence count
- explicit source count surfaced consistently
- direct quote count
- freshness score
- confidence level normalization
- direct evidence vs inference flags
- source attribution model by evidence type

### Why this matters

The backend already knows more than the UI consistently shows.
Trust should be upgraded mostly by normalizing and exposing existing information, not by adding theatrical new features.

## 14. What Is Missing for Recurring Value

### Missing unified monitor object

Recurring value already exists in fragments, but not as a single user-facing concept.

Needed next:

- one canonical monitored entity
- clear `Monitor this` action from validation and opportunity flows
- movement since last check
- brief generation tied to monitors, not just generic recent activity
- stronger saved-to-monitor transition

### Current recurrence gap

The product can currently bring users back, but the return path is not yet the main story.
Validation is still the hook, while monitoring is still a sidecar.

## 15. Phase 0 Conclusion

RedditPulse does not need a broad rewrite.

It needs:

1. a shared trust layer
2. a unified monitoring object model
3. a clearer product information architecture
4. monetization logic that matches a recurring intelligence product

The codebase is already strong enough to support that shift incrementally.
The highest-leverage move is to consolidate around:

- `Opportunity`
- `Validation`
- `Monitor`
- `Brief`

and make everything else either support one of those objects or become secondary.
