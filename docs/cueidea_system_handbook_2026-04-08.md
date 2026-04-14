# CueIdea System Handbook

Date: 2026-04-08

Audience:
- developers
- designers
- researchers
- operators

Purpose:
- explain what CueIdea actually is
- explain how the app works end to end
- align product, data, AI, and UI language across the team

This document is intentionally practical. It reflects the current codebase and the current operating model, not an idealized future version.

## 1. Product in one page

CueIdea is a startup opportunity intelligence app.

It does 3 distinct jobs:

1. Discover
- ingest public conversations and complaints from targeted sources
- shape repeated pain into candidate opportunities

2. Filter
- score, cluster, and classify those candidates
- decide which rows are worth showing in the public board

3. Validate
- let a user test one concrete startup idea with a deeper AI-assisted validation pipeline

The app is not a trading platform.
The board uses market-like metaphors, but the real product value is:
- finding repeated pain
- identifying a product angle
- validating before building

## 2. The 4 product layers

CueIdea currently behaves like 4 connected systems:

1. Marketing site
- landing page
- pricing
- how it works
- goal: explain the promise and send users into the beta flow

2. Auth shell
- login
- signup
- Google OAuth
- callback and session completion
- goal: turn a visitor into an authenticated beta user

3. Guest product shell
- public-access dashboard routes when beta-open mode is enabled
- goal: let users browse the board before committing

4. Authenticated product shell
- validations
- saved items
- settings
- personalized actions
- goal: unlock the real workflow after signup

Most confusing bugs in the app happen when these 4 layers disagree about:
- who the user is
- what the board is allowed to show
- what action should require auth

## 3. What each surface is for

### Landing
- purpose: sell the product promise
- user question: "What is this app and why should I care?"
- success condition: user understands that CueIdea turns repeated complaints into startup opportunities

### Opportunity Board
- main route: `/dashboard`
- purpose: browse shaped opportunities from live source data
- user question: "What is worth looking at right now?"
- success condition: user can quickly see what looks promising, what is early, and what to inspect next

### Explore
- route: `/dashboard/explore`
- purpose: a broader browsing surface for opportunity rows
- user question: "What else is in the pipeline besides the top board?"

### Validate
- route: `/dashboard/validate`
- purpose: decision engine for one startup idea
- user question: "Should I build this specific thing?"
- this is the strongest trust surface in the app

### Reports
- route: `/dashboard/reports`
- purpose: archive of decision-grade validation outputs

### Settings
- route: `/dashboard/settings`
- purpose: account, AI config, and advanced configuration surfaces

## 4. Core technical architecture

The system has 4 main layers:

1. Next.js app
- UI
- route handlers
- server auth checks
- market hydration

2. Python engine
- scraping
- clustering
- scoring
- enrichment
- validation orchestration

3. Supabase
- auth
- PostgreSQL
- storage of ideas, validations, scans, profiles, alerts, and market state

4. VPS runtime
- web service
- scraper timer/service
- environment variables
- proxy pool

## 5. Main code map

### Frontend app
- `app/src/app/page.tsx`
- `app/src/app/components/landing-page-client.tsx`
- `app/src/app/login/page.tsx`
- `app/src/app/auth/callback/route.ts`
- `app/src/app/auth/complete/page.tsx`
- `app/src/app/components/auth-session-bridge.tsx`
- `app/src/app/dashboard/layout.tsx`
- `app/src/app/dashboard/DashboardLayout.tsx`
- `app/src/app/dashboard/StockMarket.tsx`
- `app/src/app/dashboard/explore/page.tsx`
- `app/src/app/dashboard/validate/page.tsx`

### Market logic
- `app/src/lib/market-feed.ts`
- `app/src/lib/public-idea-eligibility.ts`
- `app/src/lib/market-editorial.ts`
- `app/src/lib/user-facing-copy.ts`
- `app/src/lib/market-topic-quality.ts`

### API routes
- `app/src/app/api/market/route.ts`
- `app/src/app/api/market/intelligence/route.ts`
- `app/src/app/api/ideas/route.ts`
- `app/src/app/api/public/ideas/route.ts`
- `app/src/app/api/validate/route.ts`

### Python engine
- `scraper_job.py`
- `run_scan.py`
- `validate_idea.py`
- `enrich_idea.py`
- `engine/config.py`
- `engine/reddit_async.py`
- `engine/reddit_auth.py`
- `engine/proxy_rotator.py`
- `engine/market_editorial/orchestrator.py`

## 6. Auth and beta flow

### Current intended flow

1. User clicks `Join beta`
2. User lands on `/login?mode=signup&next=/dashboard`
3. User signs up with Google or email
4. Supabase creates the session
5. OAuth callback lands on `/auth/callback`
6. Callback redirects to `/auth/complete?next=/dashboard`
7. Session finishes syncing
8. User is redirected into the dashboard
9. Dashboard renders authenticated state on the server and top bar shows the email

### Important design rule

Guest browsing and joining the beta are separate flows.

Guest browsing means:
- the user can look around selected dashboard surfaces

Joining the beta means:
- the user signs in
- the app can personalize behavior
- save/validate/monitor actions become real

### Shared beta helpers

The app now centralizes beta-entry URLs in:
- `app/src/lib/beta-access.ts`

Important helpers:
- `getJoinBetaHref()`
- `getBetaLoginHref()`
- `getAuthCompleteHref()`
- `getBetaTargetPath()`

This exists to stop CTA drift between:
- landing
- board
- pricing
- how it works
- top bar
- dock

## 7. How the market actually works

This is the most important product truth:

The Opportunity Board does not show raw posts.
It shows derived rows from the `ideas` table.

The real funnel is:

1. Scrape raw posts from selected sources
2. Match and cluster posts into topics
3. Shape topics into candidate opportunities
4. Score and classify them
5. Optionally run AI editorial
6. Apply visibility rules
7. Hydrate board-ready rows for the frontend

So the board is always downstream of several transformations.

## 8. Sources and source philosophy

CueIdea does not monitor "the whole internet."
It monitors a targeted set of sources and a targeted worldview.

Examples of active source families in the current system:
- Reddit
- Hacker News
- Product Hunt
- Indie Hackers
- GitHub Issues
- review complaints
- hiring signals

Important product truth:
- this is a targeted opportunity radar
- not universal market coverage

This matters for researchers and PMs because source bias shapes what the board can discover.

## 9. Scraper pipeline

Primary orchestrator:
- `scraper_job.py`

High-level job:
- collect posts from configured sources
- normalize and analyze them
- cluster them into opportunity rows
- compute scores and confidence
- write `ideas`, `idea_history`, and `scraper_runs`

Important reality:
- the scraper is not neutral
- it is guided by:
  - topic dictionaries
  - pain phrases
  - spam/humor filters
  - source-specific heuristics

That means the scraper is not just collecting.
It is already making product decisions.

## 10. What gets blocked before the user sees it

Rows can be blocked at multiple stages:

1. Source-level failure
- source unavailable
- proxy issues
- rate limits

2. Shaping failure
- malformed topic
- broad theme without usable wedge
- subreddit bucket instead of real opportunity

3. Heuristic public filter
- low score
- low post count
- insufficient sources
- invalid title
- bad summary

4. Editorial AI filter
- `internal`
- `duplicate`
- `needs_more_proof`
- `public`

### Current danger

The system still has more than one gate.
That is why two surfaces can disagree on whether the same idea is visible.

This is a major logic area to keep simplifying.

## 11. Market shaping and classification

The app distinguishes several kinds of rows:
- tracked theme
- dynamic theme
- subreddit bucket
- entity
- malformed

Current shaping happens mainly in:
- `app/src/lib/market-feed.ts`
- `scraper_job.py`

Important product distinction:
- not every row in `ideas` is a real opportunity
- many are:
  - early themes
  - buckets
  - context
  - noise

That is why the board should be treated as:
- a curated opportunity surface
not
- a raw database dump

## 12. AI editorial layer

The market AI layer is editorial only.
It does not create market truth from nowhere.

It sits on top of scraper output and does 2 roles:

1. Editor
- rewrites a candidate into cleaner public-facing copy

2. Critic
- decides if the candidate is:
  - `public`
  - `internal`
  - `duplicate`
  - `needs_more_proof`

Main file:
- `engine/market_editorial/orchestrator.py`

Storage fields:
- `ideas.market_editorial`
- `ideas.market_editorial_updated_at`

Important product rule:
- AI should improve presentation and filtering
- AI should not invent demand

## 13. Public market visibility

Current public visibility logic depends on both:
- heuristic gating
- editorial gating

Main files:
- `app/src/lib/public-idea-eligibility.ts`
- `app/src/lib/market-editorial.ts`
- `app/src/lib/market-feed.ts`

Current behavior in plain English:
- if editorial exists and publish mode is on, editorial can decide visibility
- if editorial is missing, the heuristic gate still protects the board

This is useful operationally, but still complex.
Long term, the product should have one final visibility decision object.

## 14. Validation pipeline

The validation pipeline is different from the market board.

The board says:
- "this looks worth investigating"

Validation says:
- "for this exact idea, should we build it?"

Main file:
- `validate_idea.py`

Current validation depth modes:
- quick
- deep
- investigation

Validation uses:
- decomposition
- source gathering
- enrichment
- model synthesis
- structured output
- decision framing

This is the app's most decision-grade surface.

## 15. Database mental model

You do not need every column memorized, but the team should know the core tables.

### Core auth/product tables
- `profiles`
- `auth.users`

### Market tables
- `ideas`
- `idea_history`
- `scraper_runs`
- `posts`

### Validation tables
- `idea_validations`
- `validation_queue`

### User action tables
- `watchlists`
- `alerts`
- `monitor_*` tables

### AI/settings tables
- `user_ai_config`
- `user_settings`

## 16. What the user should understand from the UI

For design and product:

The board should answer these questions quickly:
- what is the opportunity?
- how strong is the evidence?
- how new or active is it?
- what should I do next?

The board should not force the user to read:
- pipeline details
- internal diagnostics
- noisy explanation blocks

The eye should land first on:
- title
- score or conviction
- evidence summary
- next step

## 17. Design rules for the market

Current rule set for UX direction:

1. Show conclusions first
- the user should see the opportunity before the machinery

2. Reduce duplication
- do not repeat the same metrics in 3 places

3. Keep system state secondary
- freshness, update state, source health are useful
- but they should not dominate the top of the board

4. Use compact visual signals
- confidence
- traction
- proof density
- category

5. Keep detail behind expansion
- not on the first scan

## 18. Research rules

For researchers and strategy:

Treat CueIdea as a source-shaped inference system.

That means:
- source mix matters
- phrase dictionaries matter
- cluster shaping matters
- proxy health matters
- AI presentation matters

The board is never just "the market."
It is:
- scraped signals
- filtered by the current worldview
- shaped into product opportunities

So any research conclusion should consider:
- what sources were active
- what sources were degraded
- whether Reddit was underpowered
- whether visibility gates were tight

## 19. Operational/runtime model

### Web
- served from the VPS
- systemd service:
  - `redditpulse-web.service`

### Scraper
- background worker/timer on the VPS
- systemd units:
  - `redditpulse-scraper.service`
  - `redditpulse-scraper.timer`

### Config
- app env
- scraper env
- local `.env.local` for local development

### Runtime ownership contract

- keep the repo itself deploy-owned
- keep `/opt/redditpulse/.venv` runtime-owned by `redditpulse`
- keep `/opt/redditpulse/app/.next` runtime-owned by `redditpulse`
- keep `/var/log/redditpulse` runtime-owned by `redditpulse`

### Deploy order

Web deploy order:
- `git pull`
- install app deps if needed
- `npm run build` in `app/`
- `bash scripts/vps/prepare_web_runtime.sh /opt/redditpulse`
- `systemctl restart redditpulse-web.service`
- `bash scripts/vps/verify_runtime.sh /opt/redditpulse`

Scraper update order:
- `git pull`
- refresh `/opt/redditpulse/.venv` packages
- `systemctl restart redditpulse-scraper.timer`
- optionally `systemctl start redditpulse-scraper.service` for one manual run
- `bash scripts/vps/verify_runtime.sh /opt/redditpulse`

### Proxy dependency

Reddit access is still dependent on proxy quality.

Important operational truth:
- proxy count is not the same as proxy quality
- async-usable proxies and total proxies are not identical
- bad proxies can make the market look weaker than it really is

## 20. Current known logic risks

These are the big ones the team should remember:

1. Auth has historically drifted between server truth and client repair
2. Public market visibility still has multiple overlapping gates
3. Scraper worldview is narrower than the marketing promise may suggest
4. Reddit ingestion quality is still a runtime risk
5. Some metrics shown in the board represent different funnel stages and can confuse users

## 21. Recommended team language

Use these phrases consistently:

- "Opportunity Board"
  - not stock market, unless speaking internally about legacy architecture

- "Opportunity"
  - not signal, unless specifically discussing evidence or telemetry

- "Theme to refine"
  - for broad or early rows

- "Needs more proof"
  - for visible-but-early rows

- "Validation"
  - only for the deeper idea decision flow

## 22. Onboarding path by team

### If you are a frontend developer
Start here:
- `app/src/app/dashboard/StockMarket.tsx`
- `app/src/lib/market-feed.ts`
- `app/src/lib/public-idea-eligibility.ts`
- `app/src/app/components/landing-page-client.tsx`
- `app/src/app/login/page.tsx`

### If you are a backend/product engineer
Start here:
- `scraper_job.py`
- `validate_idea.py`
- `engine/market_editorial/orchestrator.py`
- `app/src/app/api/market/route.ts`
- `app/src/app/api/validate/route.ts`

### If you are a designer
Start here:
- landing page
- opportunity board
- validate flow
- reports

Focus on:
- information hierarchy
- signal density
- reducing duplicated metrics
- helping the user understand the opportunity faster

### If you are a researcher or strategist
Start here:
- source model
- market shaping
- public visibility rules
- validation output quality

Focus on:
- whether rows are truly actionable opportunities
- whether source coverage and source health support the claims shown

## 23. Practical glossary

- raw posts
  - scraped source items before shaping

- idea row
  - a database row in `ideas`

- opportunity
  - an idea row that is shaped enough to be useful in the board

- wedge / product angle
  - the more product-like interpretation of a pain cluster

- editorial AI
  - the editor + critic layer used to improve titles, summaries, and visibility

- board visible
  - a row that survives final market visibility rules

- validation
  - a deeper decision artifact for one startup idea

## 24. Final team rule

Do not assume:
- every scraped post should become a card
- every idea row should be public
- every visible row is decision-grade

CueIdea is strongest when each layer stays honest:
- scraper gathers
- shaper structures
- board curates
- validation decides
