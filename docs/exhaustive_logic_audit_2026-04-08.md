# CueIdea Exhaustive Logic Audit

Date: 2026-04-08

Scope of this pass:
- landing -> auth -> dashboard entry
- guest beta vs authenticated user flows
- public market visibility logic
- AI editorial publish logic
- scraper/source/runtime assumptions

This is a logic audit, not just a UI review. The goal is to identify where the app's behavior can drift, contradict itself, or break trust even when the screens still render.

## System Mental Model

CueIdea currently behaves like 4 systems stitched together:

1. Marketing site
- landing pushes users toward the beta

2. Auth shell
- login/signup, Google OAuth, callback, profile creation

3. Public/guest product shell
- beta-open dashboard routes that guests can browse

4. Authenticated product shell
- saved actions, validation, personalization, settings, alerts

The app works, but the logic between these 4 layers is still not fully unified. That is the root pattern behind most of the confusing bugs.

## Findings

### P0. Auth state is still not fully server-authoritative

Files:
- `app/src/middleware.ts`
- `app/src/app/dashboard/layout.tsx`
- `app/src/app/dashboard/DashboardLayout.tsx`
- `app/src/app/components/auth-session-bridge.tsx`
- `app/src/app/login/page.tsx`
- `app/src/app/auth/callback/route.ts`

Why this matters:
- A user can be truly created in Supabase, but the app UI can still render in guest mode until a client-side repair step runs.

Evidence:
- During inspection, `auth.users` and `profiles` contained newly created Google users.
- At the same time, `analytics_events` showed repeated `google_oauth_start` without matching `google_oauth_success`.
- The dashboard currently uses both:
  - a server-side auth check in `dashboard/layout.tsx`
  - a client-side guest repair in `DashboardLayout.tsx`
  - a second global client-side repair in `auth-session-bridge.tsx`

Problem:
- The app is using repair layers instead of one source of truth.
- That makes the final result sensitive to timing, host/origin consistency, browser cookie state, and client hydration order.

Risk:
- user signs in but still sees guest UI
- user gets redirected correctly but top bar/state stays stale
- bugs appear "random" because they depend on browser timing

Recommendation:
- Move toward one authoritative auth completion path.
- Best direction:
  - callback completes session
  - callback redirects to a dedicated auth-complete state
  - server-rendered dashboard sees the user correctly on first render
- Keep only one client-side fallback, not two.

### P0. Beta entry routing is duplicated across multiple surfaces

Files:
- `app/src/app/components/landing-page-client.tsx`
- `app/src/app/dashboard/StockMarket.tsx`
- `app/src/app/dashboard/components/TopBar.tsx`
- `app/src/lib/beta-access.ts`

Why this matters:
- The product promise is "Join beta", but different buttons historically routed to different places:
  - direct dashboard
  - login page
  - guest-only browse

Problem:
- Beta entry is not modeled as one product action.
- It is scattered across landing, guest CTAs, top bar, and board actions.

Risk:
- one CTA sends user to auth
- another sends user directly into guest mode
- another tries to save/scan and only then asks for auth

Recommendation:
- Add one shared helper, for example:
  - `getBetaAuthHref(nextPath = "/dashboard")`
- Use it everywhere for guest upgrade actions.
- Treat guest browsing and beta joining as two distinct flows on purpose.

### P1. Public market visibility is controlled by multiple gates with different semantics

Files:
- `app/src/lib/public-idea-eligibility.ts`
- `app/src/lib/market-feed.ts`
- `app/src/lib/market-editorial.ts`
- `app/src/app/api/market/route.ts`
- `app/src/app/api/market/intelligence/route.ts`

Why this matters:
- The board is the product promise. If its visibility logic is fragmented, the board becomes hard to reason about and hard to trust.

Current gates:
- scraper confidence and row shaping
- `market_status` from `market-feed.ts`
- heuristic public eligibility in `public-idea-eligibility.ts`
- editorial visibility in `market-editorial.ts`
- route-level filtering in `/api/market` and `/api/market/intelligence`

Problem:
- These gates are not one single decision engine.
- Example:
  - heuristic path blocks `< 30 score`
  - editorial `needs_more_proof` can pass at `>= 25`
  - `market_status` may still suppress or soften rows earlier

Risk:
- same idea can be:
  - visible in one surface
  - hidden in another
  - counted in summary but not shown in board

Recommendation:
- Introduce one explicit final decision object:
  - `visibility`
  - `reason`
  - `source_of_truth`
  - `surface_eligibility`
- Every surface should consume that, not rebuild its own logic.

### P1. `/api/market` and `/api/market/intelligence` are doing expensive, app-layer filtering on broad data

Files:
- `app/src/app/api/market/route.ts`
- `app/src/app/api/market/intelligence/route.ts`

Why this matters:
- Both routes fetch broadly and then compute meaning in the app layer.

Problem:
- `/api/market` selects `*` from `ideas`, only excluding `INSUFFICIENT`, then relies on `buildMarketIdeas`.
- `/api/market/intelligence` fetches all ideas again and recomputes several filtered subsets.

Risk:
- semantics drift between API routes
- growing latency/cost as `ideas` grows
- hard to cache because meaning is recomputed per request

Recommendation:
- centralize hydration + visibility + summary derivation
- add narrower selects where possible
- separate:
  - raw inventory
  - board-visible
  - shaping lanes

### P1. The scraper does not search "the market"; it searches a narrow, hard-coded worldview

Files:
- `engine/config.py`
- `scraper_job.py`

Why this matters:
- Product language suggests broad discovery across demand sources.
- The real logic is much narrower.

Current reality:
- fixed subreddit list
- fixed pain phrase list
- topic matching and classification rules
- hard-coded spam/humor filtering

Problem:
- This is not wrong technically, but it is a strong product constraint.
- The system is not discovering "all market activity".
- It is discovering:
  - what matches current taxonomy
  - what survives current phrase filters

Risk:
- users assume the board is comprehensive
- in reality it is shaped by the config bias

Recommendation:
- explicitly model this as "targeted opportunity radar", not universal market coverage
- add instrumentation for:
  - scraped
  - matched
  - blocked
  - bucketed
  - promoted

### P1. Proxy rotator does not truly retire bad proxies

Files:
- `engine/proxy_rotator.py`

Why this matters:
- Reddit ingestion quality still depends on proxy quality.

Problem:
- when `_live_proxies` becomes empty, `_restore_pool_if_needed()` repopulates from the original full proxy list
- that means bad proxies are not permanently removed
- they come back into circulation automatically

Risk:
- noisy degradation loops
- the same dead proxies keep returning
- health metrics can look active while quality remains poor

Recommendation:
- persist a dead-proxy quarantine list for the run
- optionally persist health across runs
- separate:
  - temporarily cooled down
  - permanently dead for current run

### P1. Async Reddit path ignores SOCKS proxies

Files:
- `engine/reddit_async.py`
- `engine/proxy_rotator.py`

Why this matters:
- part of the proxy pool may be available, but not actually used by the fast path.

Current logic:
- `format_for_aiohttp()` returns only HTTP-like proxies
- SOCKS proxies are excluded from async scraping

Problem:
- the available pool is smaller than it looks
- operators may think "40 proxies" means 40 active async paths, but that is not true

Risk:
- overestimating Reddit resilience
- misreading pool capacity

Recommendation:
- either support SOCKS in the async path deliberately
- or label metrics clearly as:
  - total proxies
  - async-usable proxies
  - sync-only proxies

### P1. Editorial token budget is local-file based, not system-authoritative

Files:
- `engine/market_editorial/orchestrator.py`

Why this matters:
- AI market publishing now affects public visibility.

Problem:
- daily token usage is stored in a local JSON file
- this is safe for one worker on one host
- it is not authoritative across:
  - multiple processes
  - multiple machines
  - restored containers
  - manual reruns

Risk:
- quota accounting drift
- duplicated spend
- false confidence in budget caps

Recommendation:
- move editorial budget state to the database or a small shared store
- keep filesystem budget only for local/dev

### P1. Editorial publish mode became product logic before the shaping layer was stable

Files:
- `app/src/lib/market-editorial.ts`
- `app/src/lib/public-idea-eligibility.ts`
- `engine/market_editorial/orchestrator.py`

Why this matters:
- AI is now part of the visibility path, not just copy polish.

Problem:
- The editorial layer is doing:
  - title shaping
  - summary shaping
  - visibility decisions
  - duplicate hiding
- But upstream theme shaping and proxy/source quality are still unstable.

Risk:
- the AI ends up spending effort filtering noise that should have been killed earlier
- board quality becomes dependent on editorial rescue rather than clean source shaping

Recommendation:
- keep improving editorial, but also move more junk removal upstream:
  - malformed `dyn-*`
  - weak `sub-*`
  - noisy broad themes

### P2. Guest-public dashboard and authenticated dashboard are still conceptually blurred

Files:
- `app/src/lib/beta-access.ts`
- `app/src/app/dashboard/layout.tsx`
- `app/src/app/dashboard/StockMarket.tsx`

Why this matters:
- The dashboard currently plays two roles:
  - public showroom
  - real authenticated workspace

Problem:
- same shell
- same route family
- mixed guest/read-only CTAs
- mixed auth-required actions

Risk:
- user confusion:
  - "Am I in the app?"
  - "Am I browsing?"
  - "Why can I see this but not act on it?"

Recommendation:
- define one clear boundary:
  - public board experience
  - authenticated workspace experience
- even if they share components, they should not feel like one ambiguous mode.

### P2. Market metrics still mix operational truth and user-facing truth

Files:
- `app/src/app/dashboard/StockMarket.tsx`
- `app/src/app/api/market/intelligence/route.ts`

Why this matters:
- users read the top metrics as the truth of the product.

Problem:
- `raw posts analyzed`
- `live opportunities`
- `feed visible`
- `raw idea count`
- `new 72h`

These are useful, but they do not all describe the same stage of the funnel.

Risk:
- user sees `5,461 posts` and expects the board to be full
- user sees only a few visible opportunities and thinks the scraper is broken

Recommendation:
- surface the funnel explicitly:
  - raw posts analyzed
  - candidate opportunities
  - visible opportunities
  - evidence attached to visible opportunities

### P2. Top-bar identity is still weakly tied to auth truth

Files:
- `app/src/app/dashboard/components/TopBar.tsx`
- `app/src/app/dashboard/DashboardLayout.tsx`

Why this matters:
- the fastest visual proof of being signed in is seeing your email.

Problem:
- this signal is now improved, but it still depends on passing user email through the layout shell
- the app still has no single small auth badge or explicit session state indicator beyond that

Recommendation:
- keep the email
- optionally add one small `Connected` or avatar state for immediate clarity

### P3. Feature-flag combinations can still create odd user states

Files:
- `app/src/lib/feature-flags.ts`
- `app/src/lib/beta-access.ts`

Problem:
- `BETA_OPEN`
- `BETA_FULL_ACCESS`
- per-feature flags

These can combine into states that are technically valid but experientially strange.

Example:
- public dashboard open
- some surfaces hidden
- auth-required actions still visible

Recommendation:
- define named product modes rather than many booleans
- example:
  - `public_preview`
  - `private_beta`
  - `full_beta`
  - `internal_admin`

## Immediate Priorities

### Priority 1
- make auth completion server-authoritative
- reduce duplicated guest/session repair logic

### Priority 2
- centralize beta entry routing
- make every guest CTA use the same auth entry helper

### Priority 3
- unify final market visibility into one decision layer
- stop rebuilding visibility logic in multiple places

### Priority 4
- improve upstream shaping before AI editorial
- reduce malformed and weak candidate themes earlier

### Priority 5
- harden runtime truth:
  - proxy retirement
  - async proxy capacity reporting
  - shared editorial budget state

## Bottom Line

The app is not failing because one component is broken.

It is behaving like:
- a marketing site
- a guest preview app
- an authenticated SaaS app
- an operator-driven market pipeline

all at once.

The logic bugs appear when those 4 identities disagree.

The most important architectural task now is:
- make auth and beta entry deterministic
- make market visibility single-source-of-truth
- move noisy filtering earlier in the pipeline

