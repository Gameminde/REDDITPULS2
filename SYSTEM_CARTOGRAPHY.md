# RedditPulse — Complete System Cartography (Verified)

## 1. Architecture Map

### FRONTEND (Next.js 16 / TypeScript)

#### Core Configuration & Middleware
- `next.config.ts`: Strict Content-Security-Policy blocking inline unsafe scripts, securing Supabase/Groq/OpenAI/Anthropic websockets & api endpoints.
- `app/src/middleware.ts`: Intercepts `/dashboard/*`. Uses `@supabase/ssr` `createServerClient`. Redirects unauthenticated users to `/login` and authenticated users away from `/login`.

#### Pages & Routes
| Route | File Path | What It Renders / Does |
|-------|-----------|------------------------|
| `GET /` | `app/src/app/page.tsx` | Main landing page |
| `GET /login` | `app/src/app/login/page.tsx` | Authentication UI |
| `GET /dashboard` | `app/src/app/dashboard/page.tsx` | Dashboard home (stats, recent scans) |
| `GET /dashboard/validate` | `app/src/app/dashboard/validate/page.tsx` | Idea submission and live pipeline visualization |
| `GET /dashboard/settings` | `app/src/app/dashboard/settings/page.tsx` | Profile and AI Model configuration UI (with verify hooks) |
| `GET /dashboard/reports` | `app/src/app/dashboard/reports/page.tsx` | List of all past validation reports |
| `GET /dashboard/reports/[id]` | `app/src/app/dashboard/reports/[id]/page.tsx` | Full detailed report view `<ResultsView />` |
| `GET /dashboard/scans` | `app/src/app/dashboard/scans/page.tsx` | Keyword scans list |
| `GET /dashboard/explore` | `app/src/app/dashboard/explore/page.tsx` | Community ideas feed (reading `ideas` table) |
| `GET /dashboard/trends` | `app/src/app/dashboard/trends/page.tsx` | Intelligence: Market trends |
| `GET /dashboard/wtp` | `app/src/app/dashboard/wtp/page.tsx` | Intelligence: Willingness-to-pay signals |
| `GET /dashboard/competitors`| `app/src/app/dashboard/competitors/page.tsx`| Intelligence: Competitor analysis |
| `GET /dashboard/sources` | `app/src/app/dashboard/sources/page.tsx` | Intelligence: Data sources |
| `GET /dashboard/saved` | `app/src/app/dashboard/saved/page.tsx` | Bookmarked ideas |
| `GET /dashboard/digest` | `app/src/app/dashboard/digest/page.tsx` | Timeline of findings |

#### API Routes
| Method/Route | File Path | Purpose |
|--------------|-----------|---------|
| `POST /api/validate` | `app/src/app/api/validate/route.ts` | Rate limits (5/hr), Premium check, accepts optional `depth` field (`quick`/`deep`/`investigation`), Spawns Python `child_process` orchestrator with `--config-file`, Returns `validationId`. |
| `GET /api/validate/[jobId]/status`| `app/src/app/api/validate/[jobId]/status/route.ts` | Polling endpoint for queue state + `idea_validations` row. |
| `GET/POST/DELETE /api/settings/ai`| `app/src/app/api/settings/ai/route.ts` | Manage `user_ai_config` through encrypted RPC-backed reads/writes. |
| `POST /api/settings/ai/verify`| `app/src/app/api/settings/ai/verify/route.ts` | Verifies AI provider API key live via `/engines/models/verify_key` logic. |
| `GET /api/intelligence` | `app/src/app/api/intelligence/route.ts` | Aggregates & extracts JSON from `report` field across all runs. |
| `GET/POST /api/scan` | `app/src/app/api/scan/route.ts` | Triggers background global keyword scans (`run_scan.py`). |
| `GET /api/scan/[id]` | `app/src/app/api/scan/[id]/route.ts` | Fetch specific scan results. |
| `GET/POST /api/watchlist`| `app/src/app/api/watchlist/route.ts` | Manage saved items on the `watchlists` table. |
| `GET /api/ideas` | `app/src/app/api/ideas/route.ts` | Fetch global ideas `ideas` table ("stock market"). |

#### Internal Components
- **`ValidatePage`**: Accepts idea text. Submits to `/api/validate`. Spawns `PhaseTimeline` and polls `setInterval(() => fetch(...), 3000)`.
- **`PhaseTimeline`**: Props `{ status: string }`. Consumes validation status string to render mapped step icons/text.
- **`ResultsView`**: Props `{ validation: Validation }`. Consumes `validation.report` JSON directly to map DOM nodes.
- **`ConfidenceMeter`**: Renders `<div style={{ width: \`${value}%\` }} />`.
- **`VerdictBadge`**: Renders pill badge (Green=BUILD IT, Red=DON'T BUILD, Yellow=RISKY).
- **`app-sidebar`**: Global navigation.
- **`premium-gate`**: Paywall component masking nested children logic.
- **`motion`**: Framer Motion wrapper (`app/components/motion.tsx`).

#### Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (Used in Route Handlers to bypass RLS for background triggers).
- `AI_ENCRYPTION_KEY` (Used by AI config endpoint to manage `pgp_sym_encrypt` / `pgp_sym_decrypt`).

---

### BACKEND (Python engine/ Orchestrators)

#### Root Scripts (Callable via `child_process.spawn`)
- `validate_idea.py`: Orchestrates idea decomposition, scraping, intel gathering, deep batch LLM synthesis, and consensus debate.
- `enrich_idea.py`: Supplemental data fetcher (Stack Overflow + GitHub issues). Caches to `enrichment_cache`. Detects "confirmed gaps".
- `generate_report.py`: Safe CLI wrapper replacing old RCE-vulnerable inline string passing. Reads from `--config-file` to reconstruct `ReportSynthesizer`.
- `scraper_job.py`: Massive cron-capable worker targeting massive subreddits spanning 45 static hardcoded topics to populate the global "Stock Market" (`ideas` / `posts`).

#### Engine Modules (`/engine/`)
- **Core Pipeline:** `multi_brain.py` (parallel LLM adapter + debate consensus logic), `config.py` (master scraping dictionaries), `validation_depth.py` (3-mode depth configs: Quick/Deep/Investigation — scales source budgets, evidence caps, batch signal limits), `report_synthesizer.py`.
- **Scraping Layer (6-tier architecture):**
  - Layer 1: `reddit_async.py` (async JSON API across 42 subs)
  - Layer 2: `pullpush_scraper.py` (90 days historical pushshift/pullpush)
  - Layer 3: `sitemap_listener.py` (realtime discovery)
  - Layer 4: `reddit_auth.py` (PRAW authenticated deeper scrape)
  - Additional: `hn_scraper.py` (Algolia), `ph_scraper.py` (GraphQL), `ih_scraper.py` (Algolia).
- **Data Enrichment & Triangulation:** `github_issues_scraper.py`, `stackoverflow_scraper.py`
- **Intelligence Analytics:** `competition.py` (calculates market saturation), `trends.py` (Google Trends velocity mapping).
- **Inference Modeling:** `icp.py` (Persona generation), `scorer.py` (Data-driven metric calculation), `ai_analyzer.py` / `analyzer.py`, `credibility.py` (filters out AI slop, spam, and humor).

#### API Call Graph (Validation Run)
1. `validate_idea.py` loads `depth_config` from config JSON (defaults to `quick`).
2. `validate_idea.py` fires `multi_brain` DECOMPOSE with mode-specific keyword/subreddit caps.
2. Parallel fanout to Scrapers (`reddit`, `hn`, `ph`, `ih`).
3. Intelligence sweeps (`trends.py`, `competition.py`).
4. Output fan-in: `_batch_summarize_all` merges posts into dense signal context.
5. Synthesis Passes (1. Market, 2. Strategy, 3. Action Plan) running sequentially, preferring pinned highest priority model (usually Gemini 2.0 Flash or Claude 3.5 Sonnet).
6. Multi-Model Debate: Submits the unified context across ALL configured LLMs.
7. Disagreement? → Hides score, exposes raw reasoning, fires Round 2. Evaluates `_weighted_merge` to spit out the `final JSON blob`.
8. Updates Supabase REST API `idea_validations` with exponential backoff retry.

---

### DATABASE (Supabase / PostgreSQL)

**Schema Files (`/sql/`)**: `schema_saas.sql`, `schema_stock_market.sql`, `schema_scans.sql`, `schema_validations.sql`, `schema_ai_config.sql`, `schema_settings.sql`, `schema_enrichment.sql`, `schema_queue.sql`.

#### Schema Definition (14 Tables)
| Table | Key Roles & Constraints |
|-------|-------------------------|
| `profiles` | Linked via trigger to `auth.users`. Tracks stripe subs. RLS: Auth UID only. |
| `projects` | User grouping mechanism (`subreddits`, `pain_phrases`). RLS: Auth UID only. |
| `posts` | Heavy text blob storing scraped signals. Evaluated fields (`data_quality`, `ai_slop_score`, `opportunity_final_score`). Linked to project or global. |
| `ideas` | **The Idea Stock Market**. Unique `slug`. Holds `current_score`, `score_24h_ago`, `change_24h`, `trend_direction`, `keywords`, `reddit_velocity`. |
| `idea_history` | Historical archive for charting stock prices of global ideas. |
| `watchlists` | Bridges `user_id` and `idea_id` for "Portfolio tracking". |
| `scraper_runs` | Audit logs for background master job duration and error states. |
| `scans` | User-initiated global keyword sweeps. Arrays of `keywords`. RLS protected. |
| `ai_analysis` | Bridges `scan_id` to individual `post_id` with LLM responses (`problem_description`, `willingness_to_pay`). |
| `idea_validations`| The primary table for `validate/page.tsx`! Holds `status`, `verdict`, `confidence`, `depth` (quick/deep/investigation), and the massive `report` JSONB (includes `depth_metadata`). |
| `user_ai_config` | Holds user's BYOK LLM keys. Uses `pgp_sym_encrypt` storing `api_key_encrypted` (BYTEA). Max 6 active per user. |
| `user_settings` | Legacy/drifted settings table still present in the live DB; migration intent and docs are not fully aligned. |
| `enrichment_cache`| Short-lived (7 day TTL via `expires_at`). Caches GitHub/StackOverflow triangulated JSON blobs to prevent heavy re-scraping. |
| `validation_queue`| Serializer task table holding async process requests. Backend/service-role access only after the 2026-03-24 hardening pass. |

*Note: The actual LLM `report` JSON Schema generated by `validate_idea.py` matches exactly what is rendered by `<ResultsView>`, mapped out in the section below.*

---

#### Database State Note
- Foreign publishing tables were removed from the live Supabase project on 2026-03-24.
- `user_requested_subreddits` was restored.
- `trend_signals` and `validation_queue` are now blocked from public REST access.
- `user_ai_config_safe` still exists as a masked view, but its live grants remain broader than intended.
- Current verification reference: [SUPABASE_POST_HARDENING_CHECKLIST.md](/c:/Users/PC/Desktop/youcef/A/SUPABASE_POST_HARDENING_CHECKLIST.md)

## 2. Broken Things Inventory 🚨
*(Mismatches between Python JSON generation & Frontend Component Rendering)*

**1. The "Summary" Mismatch**
- **Frontend reads:** `<p>{report.summary}</p>`
- **Python writes:** `"executive_summary"` in the Verdict pass JSON.
- *Result:* Blank summary shown in the UI.

**2. The "Action Plan" Mismatch**
- **Frontend expects:** `report.action_plan` array mapped to `{ step, title, description }`.
- **Python writes:** `"launch_roadmap"` array mapped to `{ week, title, tasks, cost, outcome }`.
- *Result:* Action Plan UI section silently fails to map and drops from view.

**3. The "Intelligence Grids" Mismatch**
- **Frontend expects:** `report.audience_validation`, `report.competitor_gaps`, and `report.price_signals` at the absolute root of the JSON blob.
- **Python writes:** Those data points live deeply nested inside `"ideal_customer_profile"`, `"competition_landscape.your_unfair_advantage"`, and `"pricing_strategy.tiers"`.
- *Result:* The Audience + Pain, Competitor Gaps, and Price Signals cards are never rendered in the Dashboard report view.

**4. The "Data Sources" Metadata Error (Clarified)**
- Current logic inside `validate_idea.py` does correctly assign `report["data_sources"] = source_counts`. However, the frontend currently has no code inside `<ResultsView>` mapping or iterating `report.data_sources`, causing the metrics to be swallowed into the ether despite successful Python computation.

---

## 3. Redesign Constraints (The 2026 Paradigm)

**What is SAFE TO REDESIGN & DESTROY:**
1. **The Entire `.tsx` Frontend Topology:** I can utterly decimate and rebuild every single `.tsx` file, removing the generic layout entirely and replacing it with the **Spatial Bento Grid framework**.
2. **Glassmorphic Component Replacements:** I can swap the basic UI inputs, grids, and dashboards for dynamic, floating HUD panels mimicking spatial computing UX.
3. **Data Mappings (within the UI):** I can freely remap `validation.report.launch_roadmap` (from Python) directly into the new UI's action renderer (fixing the previous Broken Things), bypassing the old `report.action_plan` mapping entirely.
4. **CSS & Styling:** I can safely remove all default tailwind and apply the extreme glassmorphic aesthetics LO dictates.

**What MUST BE PRESERVED (Do Not Touch 🚫):**
1. **Database Table Structures:** `posts`, `ideas`, `idea_validations`, `scans`, `user_ai_config`, etc. Altering these will crash the Python Orchestrators which lack auto-remapping ORM logic and rely heavily on raw REST patches/inserts parsing these exact named structures.
2. **Python System Prompts / Keys:** I must not rename `launch_roadmap` to `action_plan` inside `VERDICT_SYSTEM` or `validate_idea.py` — I must mold the *frontend* to consume what Python outputs, not the inverse. Changing Python keys risks breaking the LLM's comprehension and `extract_json` parsing.
3. **Queue Polling Architecture:** The `POST /api/validate` enqueue logic and the `GET /api/validate/[jobId]/status` polling loop MUST remain intact. The 3000ms polling sequence is the lifeline connecting the queued Python runtime back to the Next.js React hydration cycle.
4. **Environment Variables & Keys:** `AI_ENCRYPTION_KEY`, `SUPABASE_KEY` / `url` must stay structurally identical to properly allow the RPC logic in Postgres (`pgp_sym_encrypt`) to process BYOK keys.
