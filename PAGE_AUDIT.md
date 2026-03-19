# RedditPulse Frontend Dashboard Audit

> **Date:** 2026-03-19  
> **Scope:** Read-only audit — no code was changed  
> **Method:** Every `page.tsx` read in full, all API routes inventoried, all lib modules catalogued, navigation structure inspected, import chains traced

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Dashboard pages | 14 (+ 3 dynamic/nested pages) |
| API routes | 28 |
| Lib modules | 25 |
| Sidebar nav items | 13 + upgrade CTA |
| Premium-gated pages | 10 |
| Free pages | 4 (Dashboard home, Explore, Scans, Pricing) |
| Dead/orphan components | 1 (`StockMarket.tsx`) |
| Unused API routes (from dashboard) | 0 confirmed orphans — all API routes trace to at least one consumer |

**Overall health:** The frontend is feature-rich and well-structured. The main risk area is the report detail page (`reports/[id]/page.tsx`), which extracts ~30+ JSON keys from the Python pipeline output with extensive fallback chains. Any backend schema change risks silent rendering failures. The rest of the dashboard is clean.

---

## Phase 1 — Page Inventory

### Core Dashboard Pages

| # | Route | File | Lines | Data Source | Status | Premium | Visit Freq | Dependencies |
|---|-------|------|-------|-------------|--------|---------|------------|--------------|
| 1 | `/dashboard` | `page.tsx` | 53 | None (static) | ✅ LIVE | Free | High | `framer-motion`, `useRouter` |
| 2 | `/dashboard/validate` | `validate/page.tsx` | ~800 | `/api/validate`, `/api/validate/[jobId]/status` | ✅ LIVE | Free* | High | `validation-depth.ts`, `queue.ts`, `use-user-plan` |
| 3 | `/dashboard/reports` | `reports/page.tsx` | ~350 | Supabase `idea_validations` direct | ✅ LIVE | Premium | High | `supabase-browser`, `use-user-plan`, `premium-gate` |
| 4 | `/dashboard/explore` | `explore/page.tsx` | 628 | Supabase `idea_validations` direct | ✅ LIVE | Free | Medium | `supabase-browser`, `framer-motion` |
| 5 | `/dashboard/scans` | `scans/page.tsx` | ~490 | `/api/scan`, `/api/scan/[id]`, `/api/scan/[id]/report` | ✅ LIVE | Free | Medium | `supabase-browser`, `use-user-plan` |
| 6 | `/dashboard/settings` | `settings/page.tsx` | ~450 | `/api/settings/ai`, `/api/settings/detect`, `/api/settings/models`, `/api/settings/ai/verify` | ✅ LIVE | Free | Low | `supabase-browser`, `use-user-plan` |
| 7 | `/dashboard/trends` | `trends/page.tsx` | 557 | `/api/trend-signals`, `/api/why-now` | ✅ LIVE | Premium | Medium | `use-user-plan`, `premium-gate`, `framer-motion` |
| 8 | `/dashboard/sources` | `sources/page.tsx` | 160 | `/api/intelligence?section=sources` | ✅ LIVE | Premium | Low | `use-user-plan`, `premium-gate` |
| 9 | `/dashboard/wtp` | `wtp/page.tsx` | 142 | `/api/intelligence?section=wtp` | ✅ LIVE | Premium | Low | `use-user-plan`, `premium-gate` |
| 10 | `/dashboard/competitors` | `competitors/page.tsx` | 597 | `/api/intelligence`, `/api/competitor-complaints`, `/api/competitor-radar` | ✅ LIVE | Premium | Medium | `use-user-plan`, `premium-gate`, `framer-motion` |
| 11 | `/dashboard/saved` | `saved/page.tsx` | 504 | `/api/monitors` (GET + DELETE) | ✅ LIVE | Premium | Medium | `use-user-plan`, `premium-gate`, `motion` |
| 12 | `/dashboard/digest` | `digest/page.tsx` | 349 | `/api/digest` | ✅ LIVE | Free | Medium | None (no premium gate) |
| 13 | `/dashboard/alerts` | `alerts/page.tsx` | 321 | `/api/alerts`, `/api/alerts/[id]`, `/api/alerts/[id]/seen` | ✅ LIVE | Free | Medium | `useRouter` (redirects to validate) |
| 14 | `/dashboard/pricing` | `pricing/page.tsx` | 116 | None (static) | ✅ LIVE | Free | Low | `framer-motion`, `motion` components |

### Dynamic / Nested Pages

| # | Route | File(s) | Lines | Data Source | Status | Premium |
|---|-------|---------|-------|-------------|--------|---------|
| 15 | `/dashboard/reports/[id]` | `reports/[id]/page.tsx` | **1388** | `/api/validate/[id]`, `/api/watchlist` | ⚠️ PARTIAL | Premium |
| 16 | `/dashboard/reports/compare` | `reports/compare/page.tsx` | 596 | `/api/compare-ideas` | ✅ LIVE | Premium |
| 17 | `/dashboard/idea/[slug]` | `idea/[slug]/page.tsx` + `IdeaDetail.tsx` | 8 + 560 | `/api/ideas/[slug]` | ✅ LIVE | Free |

> **Note on validate page:** Free users can see the form and launch a validation, but depth mode selector is premium-gated. The page itself is accessible to all users.

---

## Phase 2 — Navigation Audit

### Sidebar Structure (`app-sidebar.tsx`, 217 lines)

| Group | # | Item | Route | Icon | Premium? |
|-------|---|------|-------|------|----------|
| **Core** | 1 | Dashboard | `/dashboard` | `LayoutDashboard` | No |
| | 2 | Validate | `/dashboard/validate` | `Zap` | No |
| | 3 | Explore | `/dashboard/explore` | `Compass` | No |
| | 4 | Scans | `/dashboard/scans` | `Search` | No |
| | 5 | Trends | `/dashboard/trends` | `TrendingUp` | Yes |
| | 6 | Sources | `/dashboard/sources` | `Globe` | Yes |
| **Intelligence** | 7 | WTP | `/dashboard/wtp` | `DollarSign` | Yes |
| | 8 | Competitors | `/dashboard/competitors` | `Radar` | Yes |
| | 9 | Pricing | — | — | — |
| | 10 | Saved Ideas | `/dashboard/saved` | `Bookmark` | Yes |
| **Personal** | 11 | Digest | `/dashboard/digest` | `Mail` | No |
| | 12 | Alerts | `/dashboard/alerts` | `BellRing` | No |
| | 13 | Settings | `/dashboard/settings` | `Settings` | No |

**Upgrade CTA:** Below the main nav, a "Get Pro ✨" button links to `/dashboard/pricing`. Pricing is NOT in the nav items list — it's a separate CTA.

**Settings placement:** "Personal" group, slot 13 — bottom of nav.

### Observations

- **Pricing page exists at `/dashboard/pricing`** but is only reachable via the upgrade CTA button and direct URL. It has no sidebar nav entry.
- **Reports page (`/dashboard/reports`)** is NOT in the sidebar nav. Users reach it from `Explore` page links or after completing a validation. This seems intentional (reports are a drill-down, not a top-level section).
- **Compare page (`/dashboard/reports/compare`)** is reachable only from the Reports list page (checkbox + compare button). No sidebar entry—correct pattern.
- **Idea detail (`/dashboard/idea/[slug]`)** is reachable from the Explore page. No sidebar entry—correct pattern.

---

## Phase 3 — Data Freshness Audit

### Pages Querying Supabase Directly (Client-Side)

| Page | Table | Query Type | Caching | Notes |
|------|-------|-----------|---------|-------|
| `/dashboard/reports` | `idea_validations` | `select().order('created_at')` | `no-store` | Always live. No client cache. |
| `/dashboard/explore` | `idea_validations` | `select().order('created_at')` | None specified | Uses Supabase JS client directly — queries on mount. |
| `/dashboard/scans` | N/A (uses `/api/scan`) | Via API route | `no-store` | API route queries Supabase server-side. |
| `/dashboard/settings` | N/A (uses settings API) | Via API route | `no-store` | API route handles Supabase. |

### Pages Using API Routes (Server Fetches Data)

| Page | API Route | Fetch Cache | Polling? |
|------|-----------|-------------|----------|
| Validate | `/api/validate`, `/api/validate/[jobId]/status` | `no-store` | Yes, 2s interval during validation |
| Trends | `/api/trend-signals`, `/api/why-now` | `no-store` | No |
| Sources | `/api/intelligence?section=sources` | `no-store` | No |
| WTP | `/api/intelligence?section=wtp` | `no-store` | No |
| Competitors | `/api/intelligence` + 2 more | `no-store` | No |
| Saved | `/api/monitors` | `no-store` | No |
| Digest | `/api/digest` | `no-store` | No (manual refresh button) |
| Alerts | `/api/alerts` | `no-store` | Yes, **60s interval** |
| Report Detail | `/api/validate/[id]` | `no-store` | No |
| Compare | `/api/compare-ideas` | `no-store` | No |
| Idea Detail | `/api/ideas/[slug]` | Default | No |

### Observations

- All fetches use `cache: "no-store"` — data is always fresh from DB on each page load.
- No client-side SWR/React Query caching layer exists. Every page mount triggers a fresh fetch.
- **Alerts page** is the only page with timed polling (60s). Validate page polls during active validation only.
- **Digest page** has a manual refresh button — good UX pattern.

---

## Phase 4 — Broken Sections Audit (Report Detail Page)

> [!WARNING]
> The report detail page (`reports/[id]/page.tsx`, **1388 lines**) is the highest-risk page in the dashboard. It extracts ~35 top-level JSON keys from the Python `validate_idea.py` report output using extensive fallback chains.

### JSON Field Extraction Map

The frontend extracts these fields from `report` JSON (lines 231–275):

| Frontend Variable | Primary Key | Fallback Key(s) | Renders? |
|---|---|---|---|
| `execSummary` | `executive_summary` | `summary` | ✅ With empty state |
| `roadmap` | `launch_roadmap` | `action_plan` | ✅ With empty state |
| `icp` | `ideal_customer_profile` | `audience_validation` | ✅ With empty state |
| `comp` | `competition_landscape` | `competitor_gaps` | ✅ With empty state |
| `pricing` | `pricing_strategy` | `price_signals` | ✅ With empty state |
| `market` | `market_analysis` | — | ✅ With empty state |
| `risks` | `risk_matrix` | `risk_factors` | ✅ With empty state |
| `financial` | `financial_reality` | — | ✅ With empty state |
| `signalSummary` | `signal_summary` | — | ✅ With empty state |
| `first10` | `first_10_customers_strategy` | — | ✅ With empty state |
| `monetizationChannels` | `monetization_channels` | — | ✅ With empty state |
| `mvpFeatures` | `mvp_features` | — | ✅ With empty state |
| `cutFeatures` | `cut_features` | — | ✅ With empty state |
| `platformWarnings` | `data_quality.platform_warnings` | `platform_warnings` | ✅ Conditional |
| `evidence` | `debate_evidence` | `evidence`, `top_posts` | ✅ With empty state |
| `dataSources` | `data_sources` | — | ✅ Renders tags |
| `trends` | `trends_data` | — | Extracted but **never rendered** ⚠️ |
| `competitors` | `comp.direct_competitors` | — | ✅ Grid cards |
| `debateTranscript` | `debate_transcript` | — | ✅ DebatePanel |
| `debateLog` | `debate_log` | — | ✅ Consensus trace |
| `modelsUsed` | `models_used` | — | ✅ Model badges |
| `postsFound` | `posts_scraped` | `report.posts_found` | ✅ KPI bar |
| `postsAnalyzed` | `posts_analyzed` | `report.posts_analyzed` | ✅ KPI bar |

### ICP Sub-Fields Extracted

| Sub-field | Key | Renders? |
|---|---|---|
| Primary persona | `icp.primary_persona` | ✅ |
| Day in the life | `icp.day_in_the_life` | ✅ |
| Demographics | `icp.demographics` | ✅ |
| Psychographics | `icp.psychographics` | ✅ |
| Communities | `icp.specific_communities` | ✅ Chip list |
| Influencers | `icp.influencers_they_follow` | ✅ List |
| Tools | `icp.tools_they_already_use` | ✅ Chip list |
| Objections | `icp.buying_objections` | ✅ List |
| Previous solutions | `icp.previous_solutions_tried` | ✅ (extracted, rendering conditional) |
| WTP evidence | `icp.willingness_to_pay_evidence` | ✅ List |
| Budget range | `icp.budget_range` | ✅ |
| Buying triggers | `icp.buying_triggers` | ✅ |

### Decision Pack Fields (from `report.decision_pack`)

The decision pack is rendered via a massive card grid (lines 420–647). All fields below are consumed:

- `verdict` (label, rationale)
- `confidence` (label, score, level, proof_summary)
- `demand_proof` (summary, proof_summary, evidence_count, source_count, freshness_label, representative_evidence)
- `buyer_clarity` (summary, wedge_summary, buying_triggers)
- `competitor_gap` (summary, strongest_gap, live_weakness)
- `why_now` (timing_category, momentum_direction, summary, inferred_why_now_note)
- `revenue_path` (recommended_entry_mode, speed_to_revenue_band, summary, first_offer_suggestion, pricing_test_suggestion, first_customer_path)
- `first_customer` (primary_channel, confidence_score, likely_first_customer_archetype, first_outreach_angle, first_proof_path, best_initial_validation_motion)
- `market_attack` (best_overall_attack_mode, best_fastest_revenue_mode, best_lowest_risk_mode, most_scalable_mode, tradeoff_notes)
- `service_first_pathfinder` (recommended_productization_posture, productization_readiness_score, posture_rationale, strongest_reason_for_posture, strongest_caution, what_must_become_true_before_productization)
- `anti_idea` (verdict.label, verdict.summary, confidence_score, strongest_reason_to_wait_pivot_or_kill, what_would_need_to_improve)
- `next_move` (summary, recommended_action, first_step)
- `kill_criteria` (summary, items)

### Issues Found

| Issue | Severity | Details |
|-------|----------|---------|
| `trends_data` extracted but never rendered | LOW | Line 260 extracts `r.trends_data` into `trends` variable, but it's never used in JSX. Dead variable. |
| `previousSolutions` extracted but conditionally dead | LOW | Array extracted at line 268 but no rendering block for it exists—only the other ICP sub-fields have render sections. |
| Fallback chains mask backend bugs | MEDIUM | The extensive `||` fallback chains (e.g., `r.competition_landscape || r.competitor_gaps`) mean the frontend silently degrades if the Python backend changes key names. No error logging when primary keys are missing. |
| Empty state messages are descriptive | ✅ GOOD | Every section has a helpful empty state explaining why data is missing. |

---

## Phase 5 — Dead Code Audit

### Unused/Orphan Files

| File | Type | Issue | Severity |
|------|------|-------|----------|
| `dashboard/StockMarket.tsx` | Component | Not imported by any `page.tsx`. Contains `/api/discover` and `/api/enrich` calls. Appears to be a standalone component that was never wired into a page route. | MEDIUM |
| `trends_data` variable in `reports/[id]/page.tsx:260` | Dead variable | Extracted from report JSON but never rendered anywhere in the 1388-line JSX | LOW |
| `previousSolutions` in `reports/[id]/page.tsx:268` | Dead variable | `icp.previous_solutions_tried` extracted into array but no render block exists | LOW |

### API Routes Without Dashboard Page Consumers

| API Route | Called By | Notes |
|-----------|----------|-------|
| `/api/graveyard` | `app/graveyard/page.tsx` (public, NOT in dashboard) | Not dead — used by a public, non-dashboard page |
| `/api/discover` | `StockMarket.tsx` (orphan component) | Functionally dead unless `StockMarket.tsx` gets wired in |
| `/api/enrich` | `StockMarket.tsx` (orphan component) | Same as above |
| `/api/auth/signup` | Auth flow | Not dashboard — expected |

### Lib Modules — All Active

All 25 lib modules trace to at least one import chain that reaches an API route or page:

| Module | Primary Consumer(s) |
|--------|-------------------|
| `anti-idea.ts` | `decision-pack.ts`, `opportunity-strategy.ts` |
| `check-premium.ts` | API routes (server-side auth) |
| `compare-ideas.ts` | `/api/compare-ideas`, `reports/compare/page.tsx` (type import) |
| `competitor-weakness.ts` | `validation-insights.ts`, `decision-pack.ts` |
| `decision-pack.ts` | `validation-insights.ts`, `reports/[id]/page.tsx` (type import) |
| `evidence.ts` | `validation-insights.ts`, `monitors.ts`, `opportunity-strategy.ts` |
| `first-customer.ts` | `decision-pack.ts`, `opportunity-strategy.ts` |
| `founder-market-fit.ts` | `reports/compare/page.tsx`, `compare-ideas.ts` |
| `live-market-memory.ts` | `monitor-feed.ts` |
| `market-attack-simulator.ts` | `decision-pack.ts`, `opportunity-strategy.ts` |
| `monitor-feed.ts` | `/api/monitors`, `/api/digest` |
| `monitors.ts` | `monitor-feed.ts` |
| `opportunity-strategy.ts` | `monitors.ts`, API routes |
| `opportunity-to-revenue.ts` | `decision-pack.ts`, `opportunity-strategy.ts` |
| `process-limiter.ts` | `/api/scan`, `/api/scan/[id]/report`, `/api/discover` |
| `queue.ts` | `/api/validate` |
| `service-first-saas-pathfinder.ts` | `decision-pack.ts`, `opportunity-strategy.ts` |
| `supabase-browser.ts` | `use-user-plan.ts`, direct page imports |
| `supabase-server.ts` | API routes (server-side) |
| `trust.ts` | 10+ consumers (core utility) |
| `use-user-plan.ts` | Nearly every premium-gated page |
| `validation-depth.ts` | `queue.ts`, `validate/page.tsx` |
| `validation-insights.ts` | API routes |
| `watchlist-data.ts` | `monitors.ts`, `monitor-feed.ts`, API routes |
| `why-now.ts` | `decision-pack.ts`, `monitors.ts`, `opportunity-strategy.ts` |

**No orphan lib modules found.** All modules are part of active import chains.

---

## Phase 6 — Prioritized Fix List

| Priority | Fix | Page/File | Effort |
|----------|-----|-----------|--------|
| 🔴 P1 | **Wire `StockMarket.tsx` into a page or delete it.** It contains real logic calling `/api/discover` and `/api/enrich`—it should either become a dashboard page or be removed to prevent confusion. | `dashboard/StockMarket.tsx` | Small |
| 🟡 P2 | **Remove dead `trends` variable extraction** in report detail page (line 260). It's extracted but never rendered—either render a trends section or remove the extraction. | `reports/[id]/page.tsx:260` | Trivial |
| 🟡 P2 | **Render or remove `previous_solutions_tried`** from ICP extraction (line 268). Currently silently extracted but never shown to users. | `reports/[id]/page.tsx:268` | Trivial |
| 🟡 P2 | **Add `/dashboard/pricing` to sidebar** or document that it's intentionally CTA-only. Currently the only dashboard page with no sidebar entry that isn't a drill-down page. | `app-sidebar.tsx` | Trivial |
| 🟡 P2 | **Add `/dashboard/reports` to sidebar.** Reports is a primary page that users visit after validation. Currently only reachable via Explore page links or post-validation redirect. No sidebar entry. | `app-sidebar.tsx` | Trivial |
| 🟢 P3 | **Add error logging to fallback key resolution** in report detail. When `r.competition_landscape` is missing and falls back to `r.competitor_gaps`, log a warning so backend key changes don't silently degrade rendering. | `reports/[id]/page.tsx:230-260` | Small |
| 🟢 P3 | **Audit the `/api/graveyard` public pages.** They exist outside the dashboard (`/graveyard`, `/graveyard/[slug]`) and are functional, but they're not linked from any dashboard navigation. Decide if they should be featured or deprecated. | `app/graveyard/` | Small |
| 🟢 P3 | **Consider adding SWR/React Query caching.** Every page uses `cache: "no-store"` with fresh fetches on every mount. For pages like Trends/Sources/WTP that change slowly, a stale-while-revalidate strategy would improve perceived performance. | All API-consuming pages | Medium |
| 🟢 P3 | **Digest page has no premium gate** even though it depends on monitor data which is premium. Non-premium users will see an empty brief, not an upgrade prompt. | `digest/page.tsx` | Trivial |

---

## Appendix A — Full API Route Inventory (28 routes)

| # | Route | Methods | Used By |
|---|-------|---------|---------|
| 1 | `/api/alerts` | GET | alerts page |
| 2 | `/api/alerts/[id]` | DELETE | alerts page |
| 3 | `/api/alerts/[id]/seen` | PATCH | alerts page |
| 4 | `/api/auth/signup` | POST | auth flow |
| 5 | `/api/compare-ideas` | GET | compare page |
| 6 | `/api/competitor-complaints` | GET | competitors page |
| 7 | `/api/competitor-radar` | GET | competitors page |
| 8 | `/api/digest` | GET | digest page |
| 9 | `/api/discover` | GET | `StockMarket.tsx` (orphan) |
| 10 | `/api/enrich` | GET/POST | `StockMarket.tsx` (orphan) |
| 11 | `/api/graveyard` | GET | public graveyard pages |
| 12 | `/api/ideas/[slug]` | GET | idea detail page |
| 13 | `/api/ideas` | GET | explore page (indirect) |
| 14 | `/api/intelligence` | GET | sources, wtp, competitors pages |
| 15 | `/api/monitors` | GET, DELETE | saved/monitors page |
| 16 | `/api/scan/[id]/report` | GET | scans page |
| 17 | `/api/scan/[id]` | GET, DELETE | scans page |
| 18 | `/api/scan` | POST | scans page |
| 19 | `/api/settings/ai` | GET, POST | settings page |
| 20 | `/api/settings/ai/verify` | POST | settings page |
| 21 | `/api/settings/detect` | GET | settings page |
| 22 | `/api/settings/models` | GET | settings page |
| 23 | `/api/trend-signals` | GET | trends page |
| 24 | `/api/validate/[jobId]` | GET | report detail page |
| 25 | `/api/validate/[jobId]/status` | GET | validate page (polling) |
| 26 | `/api/validate` | POST | validate page |
| 27 | `/api/watchlist` | GET, POST, DELETE | report detail page, idea detail page |
| 28 | `/api/why-now` | GET | trends page |

---

## Appendix B — Total Lines of Code by Page

| Page | Lines | Complexity |
|------|-------|------------|
| `reports/[id]/page.tsx` | **1,388** | Very High — largest page, renders entire validation report |
| `explore/page.tsx` | 628 | High — sortable/filterable idea grid |
| `competitors/page.tsx` | 597 | High — multi-API, three data sections |
| `reports/compare/page.tsx` | 596 | High — side-by-side comparison with founder profile |
| `idea/[slug]/IdeaDetail.tsx` | 560 | High — SVG chart, trust/strategy sections |
| `trends/page.tsx` | 557 | High — real-time signals with why-now modal |
| `saved/page.tsx` | 504 | Medium — monitors with strategy/memory panels |
| `scans/page.tsx` | ~490 | Medium — launch + poll + results |
| `settings/page.tsx` | ~450 | Medium — AI key management |
| `validate/page.tsx` | ~800 | High — form + terminal pipeline + history |
| `digest/page.tsx` | 349 | Medium — brief + timeline |
| `alerts/page.tsx` | 321 | Medium — live polling with match cards |
| `sources/page.tsx` | 160 | Low — simple list |
| `wtp/page.tsx` | 142 | Low — simple list |
| `pricing/page.tsx` | 116 | Low — static feature comparison |
| `dashboard/page.tsx` | 53 | Low — landing hub |
| `idea/[slug]/page.tsx` | 8 | Wrapper only |

**Total frontend LOC (dashboard pages only): ~7,769 lines**
