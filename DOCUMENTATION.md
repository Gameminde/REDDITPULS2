# RedditPulse — Complete Developer Documentation

> **Generated from source code analysis of 115+ files, ~25,000 lines.**
> Every value, prompt, and path quoted below is extracted directly from the codebase.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture](#2-architecture)
3. [File Cartography](#3-file-cartography)
4. [Core Validation Pipeline](#4-core-validation-pipeline)
5. [Multi-Model AI Debate Engine](#5-multi-model-ai-debate-engine)
6. [Scraper Layer](#6-scraper-layer)
7. [Intelligence Engines](#7-intelligence-engines)
8. [Opportunity Engine (scraper_job.py)](#8-opportunity-engine)
9. [Enrichment Orchestrator](#9-enrichment-orchestrator)
10. [API Routes](#10-api-routes)
11. [Database Schema](#11-database-schema)
12. [Frontend Architecture](#12-frontend-architecture)
13. [Authentication & Premium Access](#13-authentication--premium-access)
14. [Environment Variables](#14-environment-variables)
15. [Limitations & Known Issues](#15-limitations--known-issues)
16. [Glossary](#16-glossary)

---

## 1. Product Overview

RedditPulse is a **startup idea validation platform** that scrapes Reddit, Hacker News, ProductHunt, IndieHackers, Stack Overflow, GitHub Issues, G2, and the App Store in real-time, runs scraped data through an adversarial multi-model AI debate, and returns a structured verdict:

- **BUILD IT / RISKY / DON'T BUILD**
- Confidence score (0–100)
- Evidence posts with engagement metrics
- Risk factors with severity tags
- Competitor analysis matrix
- ICP (Ideal Customer Profile)
- 12-week launch roadmap

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, TailwindCSS, Framer Motion, Lucide Icons |
| Backend | Python 3.10+, Node.js API routes |
| Database | Supabase (PostgreSQL + Auth + RLS + Realtime) |
| AI | Gemini, Anthropic, OpenAI, Groq, DeepSeek, Mistral, OpenRouter |
| Payments | Stripe |
| 3D | @react-three/fiber, three.js |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    NEXT.JS FRONTEND                      │
│  /dashboard/validate  →  /api/validate  →  Python CLI    │
│  /dashboard/scans     →  /api/scan      →  run_scan.py   │
│  /dashboard/explore   →  Supabase direct (ideas table)   │
│  /graveyard           →  Supabase direct (public RLS)    │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│validate_idea │ │  run_scan.py │ │scraper_job.py│
│   .py        │ │  (549 lines) │ │ (1359 lines) │
│ (1776 lines) │ │              │ │              │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       ▼                ▼                ▼
┌─────────────────────────────────────────────────────────┐
│                    ENGINE (32 modules)                    │
│  Scrapers: keyword, hn, ph, ih, pullpush, sitemap,      │
│            reddit_async, reddit_auth, stackoverflow,     │
│            github_issues, g2, appstore                   │
│  Analysis: analyzer, ai_analyzer, scorer, credibility,  │
│            icp, competition, trends, trends_aggregator   │
│  AI:       multi_brain, report_synthesizer, graveyard    │
│  Ops:      config, proxy_rotator, pain_stream,          │
│            competitor_deathwatch, morning_brief          │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              SUPABASE (PostgreSQL + Auth)                 │
│  Tables: idea_validations, ideas, idea_history,          │
│          posts, scans, ai_analysis, profiles,            │
│          user_ai_config, watchlists, pain_alerts,        │
│          alert_matches, competitor_complaints,            │
│          graveyard_reports, trend_signals,                │
│          enrichment_cache, monitors, monitor_events,      │
│          monitor_snapshots, morning_brief_cache,          │
│          scraper_runs, user_settings,                     │
│          user_requested_subreddits                        │
└─────────────────────────────────────────────────────────┘
```

---

## 3. File Cartography

### Root Scripts (6 files)

| File | Lines | Purpose |
|------|-------|---------|
| `validate_idea.py` | 1776 | Core validation pipeline — 3-phase AI synthesis |
| `scraper_job.py` | 1359 | Background Opportunity Engine — scrapes all sources, clusters into 45 topics |
| `run_scan.py` | 549 | Scan runner — keyword scrape → AI analysis → synthesis → Supabase |
| `enrich_idea.py` | 303 | Enrichment orchestrator — SO + GitHub + G2 + AppStore with 7-day cache |
| `run_validation_test.py` | 70 | CLI test harness for validation pipeline |
| `generate_report.py` | 43 | Safe CLI wrapper for report synthesis (replaces old RCE-vulnerable inline exec) |

### Engine Modules (29 files)

| Module | Lines | Category | Purpose |
|--------|-------|----------|---------|
| `multi_brain.py` | 1181 | AI | Multi-model debate engine — 7 providers, adversarial roles, weighted merge |
| `keyword_scraper.py` | 528 | Scraper | Reddit keyword search — global + per-subreddit, 42 target subs |
| `competition.py` | 510 | Analysis | Google/Bing product count scraping, 40+ known competitors DB |
| `credibility.py` | 457 | Analysis | Data quality assessment — 5 tiers, Shannon entropy diversity |
| `ih_scraper.py` | 439 | Scraper | IndieHackers — Algolia + web scraping fallback, dynamic key refresh |
| `ph_scraper.py` | 446 | Scraper | ProductHunt — GraphQL → RSS → web scraping 3-layer fallback |
| `scorer.py` | 400 | Analysis | Post scoring — subreddit baselines, frustration/opportunity signals |
| `analyzer.py` | 382 | Analysis | 4-pass local NLP — slop filter, VADER, frustration/opportunity markers |
| `trends.py` | 331 | Analysis | Google Trends via pytrends — 5 tiers with score multipliers |
| `github_issues_scraper.py` | 321 | Scraper | GitHub Issues API — 20-topic repo map, signal_score ranking |
| `graveyard.py` | 301 | SEO | 50+ pre-validated failed ideas for organic traffic |
| `reddit_async.py` | 292 | Scraper | aiohttp concurrent Reddit — 8 max concurrent, token-bucket rate limiter |
| `trends_aggregator.py` | 269 | Analysis | Keyword momentum — bigram extraction, 5 time windows, Supabase upsert |
| `icp.py` | 254 | Analysis | Ideal Customer Profile builder — persona/tool/budget/pain aggregation |
| `sitemap_listener.py` | 248 | Scraper | Reddit XML sitemap polling — discovers posts before search indexing |
| `stackoverflow_scraper.py` | 247 | Scraper | Stack Exchange API v2.3 — 35-topic tag map, unanswered questions |
| `pullpush_scraper.py` | 246 | Scraper | PullPush.io — 90-day historical Reddit + comments, proxy rotator |
| `morning_brief.py` | 237 | Ops | Daily digest — alerts + complaints + trends, 1h cache TTL |
| `config.py` | 238 | Config | 42 subreddits, 25 pain phrases, 10 user agents, scoring weights |
| `validation_depth.py` | 160 | Config | 3-mode depth configs (Quick/Deep/Investigation) — source budgets, evidence caps, method-depth knobs |
| `reddit_auth.py` | 224 | Scraper | PRAW authenticated Reddit — 100 req/min, OAuth2 |
| `hn_scraper.py` | 206 | Scraper | Hacker News — Algolia API, Ask/Show HN sections |
| `competitor_deathwatch.py` | 186 | Ops | 15 regex complaint signals, UUID5 dedup, Supabase persistence |
| `report_synthesizer.py` | 177 | AI | Market Signal Reports — BUILD/EXPLORE/SKIP via AIBrain debate |
| `ai_analyzer.py` | 169 | Analysis | Per-post AI analysis — Gemini→Groq→OpenAI fallback chain |
| `pain_stream.py` | 165 | Ops | Retention alerts — keyword+subreddit matching against new posts |
| `g2_scraper.py` | 99 | Scraper | G2 review HTML parser — dislikes extraction, complaint bigrams |
| `appstore_scraper.py` | 83 | Scraper | iTunes Search API + RSS reviews — 3-star filter, pain bigrams |
| `proxy_rotator.py` | 52 | Ops | Thread-safe round-robin proxy rotation from PROXY_LIST env |

### SQL Schemas (13 files)

| File | Lines | Tables Created |
|------|-------|---------------|
| `SETUP_DATABASE.sql` | 72 | `scans`, `ai_analysis` (base tables + RLS) |
| `schema_saas.sql` | 129 | `posts`, `profiles`, `projects` (core SaaS + auto-profile trigger) |
| `schema_stock_market.sql` | 163 | `ideas`, `idea_history`, `watchlists`, `scraper_runs` (stock market metaphor) |
| `schema_validations.sql` | 43 | `idea_validations` (validation runs + RLS) |
| `schema_ai_config.sql` | 33 | `user_ai_config` (encrypted API keys + model selection) |
| `schema_enrichment.sql` | 65 | `enrichment_cache` (SO/GH/G2/AppStore JSONB, 7-day TTL) |
| `schema_retention.sql` | 110 | `pain_alerts`, `alert_matches`, `competitor_complaints`, `graveyard_reports`, `user_requested_subreddits` |
| `schema_rls_lockdown.sql` | 78 | Security hardening — blocks plan escalation, `user_ai_config_safe` VIEW |
| `schema_settings.sql` | 42 | `user_settings` (legacy plaintext API keys) |
| `schema_scans.sql` | 88 | Extended `scans` + `ai_analysis` schema |
| `fix_api_key_column.sql` | 13 | Adds plain `api_key` fallback column |

### Migrations (selected highlights)

| File | Purpose |
|------|---------|
| `005_strategic_features.sql` | Creates `pain_alerts`, `alert_matches`, `competitor_complaints`, `graveyard_reports` + RLS |
| `006_morning_brief_cache.sql` | Creates `morning_brief_cache` (per-user, JSONB brief + timeline) |
| `011_drop_legacy_plaintext_keys.sql` | Drops plaintext AI-key paths and recreates `user_ai_config_safe` masked view |
| `012_ai_config_encryption_rpcs.sql` | Adds encrypted AI-config RPCs and base grant model |
| `013_ai_config_multi_model_support.sql` | Extends encrypted AI-config RPCs for multi-model support |
| `007_idea_validations_extra_columns.sql` | Adds `verdict_source`, `synthesis_method`, `debate_mode`, `platform_breakdown` |
| `008_ideas_theme_fields.sql` | Adds `post_count_24h`, `pain_count`, `pain_summary` to ideas |
| `009_monitor_core.sql` | Creates `monitors` + `monitor_events` (unified monitoring layer) |
| `010_live_market_memory.sql` | Creates `monitor_snapshots` (state snapshots with direction tracking) |
| `014_validation_depth.sql` | Adds `depth` column to `idea_validations` (text, default 'quick') |
| `015_idea_trend_baselines.sql` | Adds `last_24h_update` / `last_7d_update` trend-baseline timestamps |
| `016_schema_cleanup_lockdown_and_repair.sql` | Removes accidental foreign tables, restores `user_requested_subreddits`, and locks down `validation_queue` / `trend_signals` |
| `017_normalize_public_grants.sql` | Normalizes anon/authenticated/service-role grants to match live RLS usage |

---

## 4. Core Validation Pipeline

**File:** `validate_idea.py` (1776 lines)

### Validation Depth Modes

The pipeline supports 3 depth modes that scale evidence collection:

| Mode | Reddit Lookback | Keywords | Evidence Budget | Pass3 Competitors |
|---|---|---|---|---|
| Quick (default) | 10min | 8 | 100 | 5 |
| Deep | 1h | 12 | 150 | 8 |
| Investigation | 3h | 16 | 180 | 10 |

Mode is passed via config JSON from the queue worker. Each mode also scales fallback rescue threshold and batch signal caps. Core judgment logic (contradiction thresholds, confidence boost, verdict override) stays consistent across modes.

### Phase 1 — AI Decomposition

The user's raw idea text is sent to a `DECOMPOSE_SYSTEM` prompt that extracts:
- `keywords` (list of 3–8 search terms)
- `subreddits` (5+ relevant subreddits beyond defaults)
- `competitors` (known tools in the space)
- `pain_hypothesis` (the core user pain)

### Phase 2 — Multi-Platform Scraping & Intelligence

Scrapes up to **8 platforms** in parallel:

| Platform | Module | Method |
|----------|--------|--------|
| Reddit (keyword) | `keyword_scraper.py` | Global + per-sub search via .json API |
| Reddit (async) | `reddit_async.py` | aiohttp with 8 max concurrent, 42 subs in ~15s |
| Reddit (auth) | `reddit_auth.py` | PRAW OAuth2, 100 req/min |
| Reddit (historical) | `pullpush_scraper.py` | PullPush.io, 90 days back |
| Hacker News | `hn_scraper.py` | Algolia API, Ask/Show HN |
| ProductHunt | `ph_scraper.py` | GraphQL → RSS → web scraping |
| IndieHackers | `ih_scraper.py` | Algolia → web fallback |
| Reddit (sitemap) | `sitemap_listener.py` | XML sitemap for newest posts |

**Post filtering pipeline:**
1. Remove `[removed]`/`[deleted]` posts
2. Spam filter (compiled regex from `SPAM_PATTERNS` in config.py)
3. Humor filter (≥2 humor indicators = discarded)
4. Minimum 20 characters
5. Cross-platform deduplication (title similarity > 85%)
6. Sort by engagement score

**Post sampling:** Top 200 posts by score, then `_smart_sample()` selects a budget of posts (100/150/180 depending on depth mode) using 4 buckets: top engagement, most recent, random spread, and outliers.

### Phase 2.5 — Local Analysis Pipeline

**File:** `analyzer.py` (382 lines)

Four-pass local NLP before any AI calls:

1. **AI Slop Filter** — 25+ phrases like `"as an ai"`, `"i cannot"`, `"it's worth noting"` → immediately discards bot-generated content
2. **VADER Sentiment** — nltk's SentimentIntensityAnalyzer with a custom 50-word **B2B Friction Matrix** (e.g., `"overpriced": -2.5`, `"game-changer": 3.0`)
3. **Frustration Markers** — 25 patterns: `"I hate"`, `"so frustrating"`, `"wish there was"`, `"can't believe"`, etc.
4. **Opportunity Markers** — 15 patterns: `"I'd pay"`, `"shut up and take my money"`, `"willing to pay"`, `"need a tool"`, etc.
5. **Context Validation** — checks if post is actually about software/tools (not just venting)
6. **Desperation Level** — L1 (mild) to L3 (critical) based on marker density

### Phase 3 — AI Synthesis (3-Pass)

Three sequential AI prompts, each building on the previous:

| Pass | System Prompt | Focus |
|------|--------------|-------|
| `PASS1_SYSTEM` (Market) | Market size, demand signals, WTP evidence, competitor gaps | 13-field JSON |
| `PASS2_SYSTEM` (Strategy) | Positioning, pricing, ICP, risk matrix, differentiation | 11-field JSON |
| `PASS3_SYSTEM` (Action) | 12-week roadmap, MVP spec, GTM strategy, metrics | 9-field JSON |

### Phase 3.5 — Multi-Model Debate (Verdict)

If user has 2+ AI models configured, the `VERDICT_SYSTEM` prompt triggers multi-model adversarial debate (see Section 5).

### Data Quality Checks

**Function:** `_check_data_quality()` in validate_idea.py

Caps confidence based on:
- Post count < 15 → max 55%
- Platform imbalance (>90% from one source) → -5%
- WTP vs pricing discrepancy → -8%
- Contradicting sentiment signals → -10%
- Stale data (>30 days average) → -5%

---

## 5. Multi-Model AI Debate Engine

**File:** `multi_brain.py` (1181 lines)

### Supported Providers

| Provider | Models | API Pattern |
|----------|--------|-------------|
| Gemini | `gemini-2.0-flash`, `gemini-2.5-pro`, etc. | `generativelanguage.googleapis.com` |
| Anthropic | `claude-3-haiku`, `claude-3.5-sonnet` | `api.anthropic.com` |
| OpenAI | `gpt-4o`, `gpt-4o-mini` | `api.openai.com` |
| Groq | `llama-3.3-70b-versatile`, `mixtral-8x7b` | `api.groq.com` |
| DeepSeek | `deepseek-chat`, `deepseek-reasoner` | `api.deepseek.com` |
| Mistral | `mistral-large-latest` | `api.mistral.ai` |
| OpenRouter | Any model via proxy | `openrouter.ai/api` |

### Debate Architecture

```
Round 1: Each model independently analyzes the data
    ↓
Role Assignment: SKEPTIC / BULL / MARKET_ANALYST (calibrated)
    ↓
Round 2: Models challenge each other's positions
    ↓
Round 3: Final positions with confidence scores
    ↓
Weighted Merge: evidence_count * (1 - unknowns_ratio)
    ↓
Verdict: Weighted majority vote with dissent tracking
```

### Weight Calculation

```python
weight = evidence_count * (1 - unknowns_ratio)
```

Where `unknowns_ratio` = count of "unknown"/"unclear" values ÷ total fields.

### Verdict Logic

- If weighted total for BUILD > 50% → `"BUILD IT"`
- If weighted total for DONT > 50% → `"DON'T BUILD"`
- Otherwise → `"RISKY"`
- Dissent is preserved in metadata when models disagree

---

## 6. Scraper Layer

### 6.1 Reddit Keyword Scraper (`keyword_scraper.py`, 528 lines)

- **42 target subreddits** defined in `config.py`:
  `SaaS`, `startups`, `Entrepreneur`, `smallbusiness`, `microsaas`, `freelance`, `webdev`, `devops`, `selfhosted`, `nocode`, `ProductManagement`, etc.
- Searches globally via Reddit `.json` API + per-subreddit
- Rate limiting: 2.5s between requests, rotating User-Agent from 10 agents
- Spam/humor filtering via compiled regex patterns

### 6.2 Reddit Async (`reddit_async.py`, 292 lines)

- `aiohttp` concurrent scraper
- **8 max concurrent** connections via semaphore
- Token-bucket rate limiter
- Scrapes 42 subreddits in ~15 seconds

### 6.3 Reddit Auth (`reddit_auth.py`, 224 lines)

- PRAW (Python Reddit API Wrapper) with OAuth2
- 100 requests/minute rate limit
- Uses `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`

### 6.4 PullPush Historical (`pullpush_scraper.py`, 246 lines)

- **PullPush.io API** — free, no auth, 90-day historical data
- Submissions endpoint: `api.pullpush.io/reddit/search/submission/`
- Comments endpoint: `api.pullpush.io/reddit/search/comment/`
- Proxy rotation via `proxy_rotator.py`
- WTP extraction from comments ("I'd pay $X for this")

### 6.5 Reddit Sitemap (`sitemap_listener.py`, 248 lines)

- Polls `reddit.com/sitemaps/recent.xml`
- Discovers posts **before they appear in Reddit search**
- URL dedup cache (max 10,000 entries)
- Post hydration via `.json` API

### 6.6 Hacker News (`hn_scraper.py`, 206 lines)

- **Algolia API**: `hn.algolia.com/api/v1/search_by_date`
- Filters: Ask HN, Show HN sections
- Normalizes to standard post format

### 6.7 ProductHunt (`ph_scraper.py`, 446 lines)

Three-layer fallback:
1. **GraphQL API** (authenticated, fastest)
2. **RSS Feed** (`producthunt.com/feed`)
3. **Direct Web Scraping** (HTML parsing)

### 6.8 IndieHackers (`ih_scraper.py`, 439 lines)

- **Algolia Search** with dynamic key refreshing
- Fallback: web scraping with CSS selectors
- Normalizes all fields to standard schema

### 6.9 Stack Overflow (`stackoverflow_scraper.py`, 247 lines)

- **Stack Exchange API v2.3** — 10,000 req/day free
- 35-topic `TOPIC_TAG_MAP` mapping ideas to SO tags
- Two search strategies: tag-based unanswered + text-based relevance
- Signal score: `votes * log(view_count + 1)`

### 6.10 GitHub Issues (`github_issues_scraper.py`, 321 lines)

- **GitHub API v3** — 60 req/hr (unauth), 5K/hr (with token)
- 20-topic `TOPIC_REPO_MAP` with known repos per topic
- Two layers: global issue search + known repo scraping
- Signal score: `thumbs_up * 3 + total_reactions + comments * log(comments + 1)`

### 6.11 G2 Reviews (`g2_scraper.py`, 99 lines)

- Scrapes `g2.com/products/{slug}/reviews` via HTML parsing
- Extracts: dislikes, likes, rating, industry, company size
- Filters: rating ≤ 3 only (negative reviews = market gaps)
- Complaint bigram extraction via Counter

### 6.12 App Store (`appstore_scraper.py`, 83 lines)

- **iTunes Search API**: `itunes.apple.com/search`
- **Customer Reviews RSS**: `itunes.apple.com/us/rss/customerreviews/id={app_id}/json`
- Filters 3-star reviews only (mixed sentiment = richest signals)
- Pain bigram extraction

---

## 7. Intelligence Engines

### 7.1 Scorer (`scorer.py`, 400 lines)

Normalizes post engagement against **subreddit baselines**:

```python
SUBREDDIT_BASELINES = {
    "startups": {"median_score": 15, "median_comments": 8},
    "SaaS": {"median_score": 10, "median_comments": 5},
    ...
}
```

Score components:
- Engagement score (normalized against baseline)
- Frustration score (matched pain phrases)
- Opportunity score (matched opportunity signals)
- Recency boost (exponential decay, 7-day half-life)
- Cross-subreddit boost (×1.5 if seen in 3+ subs)
- Velocity (comments-per-hour rate)

### 7.2 Credibility Engine (`credibility.py`, 457 lines)

Five assessment tiers:

| Tier | Post Count | Source Diversity | Label |
|------|-----------|-----------------|-------|
| STRONG | ≥50 | ≥3 sources | ✅ Strong evidence |
| MODERATE | ≥25 | ≥2 sources | 🟡 Moderate evidence |
| WEAK | ≥10 | ≥1 source | 🟠 Weak evidence |
| INSUFFICIENT | ≥3 | any | 🔴 Insufficient data |
| NONE | <3 | any | ⚫ No meaningful data |

- **Shannon entropy** for source diversity score
- Prompt modifier adjusts AI confidence claims based on data quality
- `show_opportunity` flag: only True for MODERATE+ credibility

### 7.3 ICP Builder (`icp.py`, 254 lines)

Aggregates from analyzed posts to build Ideal Customer Profile:
- **Primary persona** (most common user type)
- **Top tools mentioned** (existing solutions they use)
- **Budget signals** (extracted dollar amounts)
- **Pain patterns** (clustered frustration themes)
- Coverage metric: `icp_rate = posts_with_icp_signal / total_posts`

### 7.4 Competition Analyzer (`competition.py`, 510 lines)

- Google/Bing scraping for product counts
- 40+ `KNOWN_COMPETITORS` database mapping topics to competitors
- Competition tiers: NONE, LOW, MODERATE, HIGH, SATURATED
- Generates competition prompt section for AI synthesis

### 7.5 Google Trends (`trends.py`, 331 lines)

- `pytrends` library for Google Trends data
- Five trend tiers with multipliers:

| Tier | Condition | Multiplier |
|------|-----------|-----------|
| EXPLODING | Recent avg > 2× older avg | 1.4× |
| GROWING | Recent avg > 1.3× older avg | 1.2× |
| STABLE | Within 30% | 1.0× |
| DECLINING | Recent avg < 0.7× older avg | 0.8× |
| DEAD | Recent avg < 0.3× older avg | 0.5× |

### 7.6 Trends Aggregator (`trends_aggregator.py`, 269 lines)

- Builds keyword momentum snapshots from stored posts
- Bigram keyword extraction with stop-word filtering
- 5 time windows: 24h, 48h, 7d, 14d, 30d
- Velocity = `post_count_24h / max(prev24h, 1)`
- Classifies into EXPLODING/GROWING/STABLE/DECLINING/DEAD
- Upserts top 100 keywords to `trend_signals` table

### 7.7 Competitor Deathwatch (`competitor_deathwatch.py`, 186 lines)

- 15 regex complaint signals: `"moving away from"`, `"cancelled my subscription"`, `"terrible support"`, etc.
- Scans posts mentioning known competitors for complaint patterns
- UUID5 dedup (namespace + title hash)
- Persists to `competitor_complaints` table

### 7.8 Pain Stream (`pain_stream.py`, 165 lines)

- Retention alerts: watches for new posts matching keyword + subreddit combos
- Tied to `pain_alerts` table (user creates alert after validation)
- Matches stored in `alert_matches` with `seen` flag

### 7.9 Graveyard SEO (`graveyard.py`, 301 lines)

- 50+ pre-validated failed startup ideas (hardcoded list)
- Single-pass AI analysis for each idea
- Public pages at `/graveyard/{slug}` for SEO traffic
- Stored in `graveyard_reports` table with `is_public = true`

### 7.10 Morning Brief (`morning_brief.py`, 237 lines)

- Daily digest per user from Supabase data
- Combines: alert_matches (24h) + competitor_complaints (24h) + trend_signals (top 5)
- Timeline builder with buckets ("Today", "This Week")
- 1-hour cache TTL in `morning_brief_cache` table
- Stale validation suggestions (>30 days old)

---

## 8. Opportunity Engine

**File:** `scraper_job.py` (1359 lines)

Background script that runs on a schedule:

1. Scrapes Reddit (all subs, new + hot) + HN + PH + IH
2. Stores raw posts in `posts` table (upsert, max 2000/run)
3. Clusters posts into **45 tracked topics** across 12 categories
4. Calculates "stock price" for each idea
5. Updates `ideas` + `idea_history` tables
6. Runs Pain Stream alerts
7. Runs Competitor Deathwatch
8. Runs Trends Aggregation
9. Nudges existing validation confidence scores (market pulse)
10. Logs run in `scraper_runs` table

### 45 Tracked Topics (excerpt)

```
fintech:     invoice-automation, accounting-software, payment-processing, personal-finance
productivity: time-tracking, project-management, note-taking, document-signing, forms-surveys, scheduling-booking, ai-meeting-notes
marketing:   email-marketing, seo-tools, social-media-scheduling, landing-pages, content-creation, influencer-marketing
dev-tools:   no-code-tools, api-monitoring, website-builder, ci-cd-devops, developer-tools
ai:          ai-writing, ai-image-generation, ai-automation, ai-coding
saas:        customer-support, crm-tools, onboarding-tools, feedback-tools
ecommerce:   ecommerce-tools, inventory-management
hr:          recruitment-hiring, remote-work-tools
security:    vpn-privacy
data:        data-analytics, web-scraping
+ education, freelance, proptech, design, video-conferencing
```

Each topic has 10–18 keywords for matching.

---

## 9. Enrichment Orchestrator

**File:** `enrich_idea.py` (303 lines)

Adds deep-signal enrichment to discovered ideas by querying 4 external sources:

1. **Stack Overflow** — unanswered questions (demand signals)
2. **GitHub Issues** — open issues with most 👍 reactions (feature gaps)
3. **G2 Reviews** — low-rating review complaints (competitor weaknesses)
4. **App Store Reviews** — 3-star review pains (mobile market gaps)

### Triangulation: Confirmed Gaps

**Function:** `detect_confirmed_gaps()`

When the same feature gap appears in BOTH Stack Overflow questions AND GitHub issues, it's flagged as a **"confirmed gap"**:
- Extracts bigrams from SO question titles
- Checks if those bigrams appear in GitHub issue titles
- If found in G2 complaints too → `"triple-confirmed"`
- Returns top 5 confirmed gaps

### Caching

- Results cached in `enrichment_cache` table (Supabase)
- **7-day TTL** (`expires_at = now + 7 days`)
- Returns cached data immediately if fresh
- Force refresh via `force_refresh=True` parameter

---

## 10. API Routes

All API routes are in `app/src/app/api/`.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/validate` | POST | Spawns `validate_idea.py` via `child_process.spawn()` |
| `/api/scan` | POST | Spawns `run_scan.py` with `--config-file` |
| `/api/settings/ai` | GET/POST/DELETE | CRUD for `user_ai_config` (encrypted API keys) |
| `/api/stripe/checkout` | POST | Creates Stripe checkout session |
| `/api/stripe/webhook` | POST | Handles Stripe `checkout.session.completed` |
| `/api/graveyard/seed` | POST | Triggers graveyard report generation |
| `/api/morning-brief` | GET | Returns user's daily digest |
| `/api/enrich` | POST | Triggers idea enrichment pipeline |
| `/api/monitors` | GET/POST | CRUD for unified monitors |
| `/api/monitor-events` | GET | Fetch monitor events timeline |
| `/api/monitor-feed` | GET | Aggregated feed across all monitors |
| `/api/watchlist` | GET/POST/DELETE | Portfolio tracking for ideas |
| `/api/compare-ideas` | POST | Side-by-side idea comparison |
| `/api/anti-idea` | POST | Devil's advocate analysis |
| `/api/decision-pack` | POST | Full decision package generation |
| `/api/first-customer` | POST | First customer acquisition strategy |
| `/api/founder-market-fit` | POST | Founder-market fit assessment |
| `/api/market-attack-simulator` | POST | Market entry simulation |

### Spawn Pattern (validate and scan routes)

```typescript
const proc = spawn("python", ["validate_idea.py", "--config-file", configPath]);
```

- Writes a temporary JSON config file to `/tmp/`
- Spawns Python as a child process
- Streams stdout/stderr back to client via `proc.stdout.on('data', ...)`
- Avoids shell injection (no string interpolation in command)

---

## 11. Database Schema

### Core Tables

#### `idea_validations`
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES auth.users(id)
idea_text TEXT
model TEXT           -- "multi-brain", "gemini-2.0-flash", etc.
status TEXT          -- "queued", "decomposing", "scraping", "synthesizing", "done", "failed"
verdict TEXT         -- "BUILD IT", "RISKY", "DON'T BUILD"
confidence INTEGER   -- 0-100
report JSONB         -- Full structured report
error TEXT
created_at TIMESTAMPTZ
completed_at TIMESTAMPTZ
-- Migration columns:
verdict_source TEXT
synthesis_method TEXT
debate_mode TEXT     -- "single" or "debate"
platform_breakdown JSONB
```

#### `ideas` (Stock Market)
```sql
id UUID PRIMARY KEY
topic VARCHAR(255) UNIQUE
slug VARCHAR(255) UNIQUE
current_score FLOAT        -- 0-100, "stock price"
score_24h_ago FLOAT
score_7d_ago FLOAT
score_30d_ago FLOAT
change_24h FLOAT           -- delta
change_7d FLOAT
change_30d FLOAT
trend_direction VARCHAR(10) -- "rising", "falling", "stable", "new"
confidence_level VARCHAR(20)
post_count_total INTEGER
post_count_24h INTEGER
post_count_7d INTEGER
source_count INTEGER
sources JSONB
reddit_velocity FLOAT
google_trend_score FLOAT
competition_score FLOAT
cross_platform_multiplier FLOAT
icp_data JSONB
competition_data JSONB
pain_count INTEGER
pain_summary TEXT
top_posts JSONB
keywords JSONB
category VARCHAR(100)
```

#### `posts`
```sql
id TEXT PRIMARY KEY        -- "{source}_{external_id}"
title TEXT
selftext TEXT
full_text TEXT
subreddit TEXT
score INTEGER
upvote_ratio FLOAT
num_comments INTEGER
permalink TEXT
author TEXT
url TEXT
created_utc TIMESTAMPTZ
matched_phrases TEXT[]
sentiment_compound FLOAT
scraped_at TIMESTAMPTZ
scan_id UUID
user_id UUID
```

#### `profiles`
```sql
id UUID PRIMARY KEY REFERENCES auth.users(id)
email TEXT
plan TEXT               -- "free", "pro", "enterprise"
stripe_customer_id TEXT
stripe_payment_id TEXT
paid_at TIMESTAMPTZ
created_at TIMESTAMPTZ
```

#### `user_ai_config`
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES auth.users(id)
provider TEXT            -- "gemini", "anthropic", "openai", etc.
api_key_encrypted BYTEA  -- pgp_sym_encrypt(key, AI_ENCRYPTION_KEY)
api_key TEXT             -- plaintext fallback
selected_model TEXT
is_active BOOLEAN
priority INTEGER
endpoint_url TEXT
created_at TIMESTAMPTZ
```

### Monitoring Tables

| Table | Purpose |
|-------|---------|
| `monitors` | Unified monitoring layer — tracks opportunities, validations, pain themes |
| `monitor_events` | Individual signals detected per monitor |
| `monitor_snapshots` | State snapshots with direction (strengthening/weakening/steady) |
| `pain_alerts` | User keyword watchlists |
| `alert_matches` | Matched posts for alerts |
| `competitor_complaints` | Detected competitor complaints |
| `watchlists` | User portfolio tracking |

### Supporting Tables

| Table | Purpose |
|-------|---------|
| `idea_history` | Historical score data for charts |
| `scans` | Scan runs with status tracking |
| `ai_analysis` | Per-post AI analysis results |
| `scraper_runs` | Scraper job execution log |
| `trend_signals` | Keyword momentum snapshots |
| `enrichment_cache` | SO/GH/G2/AppStore enrichment (7-day TTL) |
| `graveyard_reports` | Public SEO pages for failed ideas |
| `morning_brief_cache` | Per-user daily digest cache |
| `user_settings` | Legacy/drifted settings table still present in the live DB; migration intent and docs are not fully aligned |
| `user_requested_subreddits` | User-discovered subreddits to add to scraper coverage |

### Row Level Security

Every current live base table has RLS enabled. Key policies:

- **User-scoped**: `idea_validations`, `pain_alerts`, `alert_matches`, `watchlists`, `monitors`, `monitor_events`, `monitor_snapshots` → `auth.uid() = user_id`
- **Public read**: `ideas`, `idea_history`, `graveyard_reports` (where `is_public = true`), `enrichment_cache`, `scraper_runs`
- **Plan escalation blocked**: `profiles` UPDATE policy uses subquery to verify `plan` hasn't changed
- **API key protection**: `user_ai_config_safe` VIEW masks `api_key_encrypted` as `'••••••••'`

---

Additional live security notes:

- `validation_queue` and `trend_signals` are service-role-only after the 2026-03-24 hardening pass.
- `user_ai_config_safe` is still a masked view, but its live grants remain broader than intended and should be tightened.
- Current verification reference: [SUPABASE_POST_HARDENING_CHECKLIST.md](/c:/Users/PC/Desktop/youcef/A/SUPABASE_POST_HARDENING_CHECKLIST.md)

## 12. Frontend Architecture

### Dashboard Pages (16 pages)

| Route | File | Feature |
|-------|------|---------|
| `/dashboard` | `page.tsx` + `DashboardHome.tsx` | Overview with StockMarket 3D visualization |
| `/dashboard/validate` | `validate/page.tsx` | Idea validation form + expandable terminal + debate cards |
| `/dashboard/reports` | `reports/page.tsx` | List of completed validations |
| `/dashboard/reports/[id]` | `reports/[id]/page.tsx` | Full validation report view |
| `/dashboard/reports/compare` | `reports/compare/page.tsx` | Side-by-side idea comparison |
| `/dashboard/explore` | `explore/page.tsx` | Browse idea stock market |
| `/dashboard/idea/[slug]` | `idea/[slug]/page.tsx` | Individual idea detail page |
| `/dashboard/trends` | `trends/page.tsx` | Keyword trend signals |
| `/dashboard/scans` | `scans/page.tsx` | Scan management |
| `/dashboard/alerts` | `alerts/page.tsx` | Pain Stream alerts |
| `/dashboard/competitors` | `competitors/page.tsx` | Competitor Deathwatch feed |
| `/dashboard/digest` | `digest/page.tsx` | Morning Brief daily digest |
| `/dashboard/sources` | `sources/page.tsx` | Data source status |
| `/dashboard/saved` | `saved/page.tsx` | Watchlist/portfolio |
| `/dashboard/settings` | `settings/page.tsx` | AI model configuration |
| `/dashboard/pricing` | `pricing/page.tsx` | Stripe pricing page |
| `/dashboard/wtp` | `wtp/page.tsx` | Willingness-to-pay analysis |
| `/graveyard` | `graveyard/page.tsx` | Public SEO graveyard index |
| `/graveyard/[slug]` | `graveyard/[slug]/page.tsx` | Individual graveyard report |
| `/login` | `login/page.tsx` | Supabase Auth login |

### Frontend Libraries (20 modules in `app/src/lib/`)

| Module | Purpose |
|--------|---------|
| `supabase-browser.ts` | Browser-side Supabase client |
| `supabase-server.ts` | Server-side Supabase client |
| `check-premium.ts` | Server-side premium email whitelist check |
| `use-user-plan.ts` | Client-side React hook for premium status |
| `process-limiter.ts` | Rate limiting for API calls |
| `validation-insights.ts` | Extracts structured insights from validation reports |
| `watchlist-data.ts` | Watchlist CRUD operations |
| `anti-idea.ts` | Devil's advocate AI analysis |
| `compare-ideas.ts` | Side-by-side idea comparison logic |
| `competitor-weakness.ts` | Competitor weakness radar |
| `decision-pack.ts` | Full decision package generator |
| `evidence.ts` | Evidence contract validation |
| `first-customer.ts` | First customer acquisition strategy |
| `founder-market-fit.ts` | Founder-market fit assessment |
| `live-market-memory.ts` | Monitor snapshot management |
| `market-attack-simulator.ts` | Market entry simulation |
| `monitors.ts` | Monitor CRUD operations |
| `monitor-feed.ts` | Aggregated monitor event feed |
| `opportunity-to-revenue.ts` | Revenue pathway analysis |
| `service-first-saas-pathfinder.ts` | Service-first SaaS strategy |
| `trust.ts` | Trust score calculations |
| `why-now.ts` | "Why now?" timing analysis |

### Design System

- **CSS Variables**: Defined in `app/src/styles/design-tokens.css` (7.6KB)
- **Styling**: TailwindCSS with custom `bento-cell` component pattern
- **Animations**: Framer Motion throughout
- **3D**: StockMarket visualization using `@react-three/fiber`
- **Icons**: Lucide React icon library
- **Navigation**: Dock component (macOS-style bottom dock) + TopBar

---

## 13. Authentication & Premium Access

### Auth Provider

Supabase Auth with email/password and magic link login.

### Premium Email Whitelist

Hardcoded in two files:

**`app/src/lib/check-premium.ts`** (server-side):
```typescript
const PREMIUM_EMAILS = [
  "youcefneoyoucef@gmail.com",
  "cheriet.samimhamed@gmail.com",
];
```

**`app/src/lib/use-user-plan.ts`** (client-side):
```typescript
const PREMIUM_EMAILS = [
  "youcefneoyoucef@gmail.com",
  "cheriet.samimhamed@gmail.com",
];
```

### Stripe Integration

- Checkout session created via `/api/stripe/checkout`
- Webhook at `/api/stripe/webhook` handles `checkout.session.completed`
- Updates `profiles.plan` to `"pro"` after successful payment
- Plan escalation blocked by RLS (users can't self-promote via API)

---

## 14. Environment Variables

| Variable | Required | Used By |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | All Python scripts + Next.js |
| `SUPABASE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Client-side Supabase |
| `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side Supabase (bypasses RLS) |
| `AI_ENCRYPTION_KEY` | Yes | Encrypts/decrypts API keys in `user_ai_config` |
| `GEMINI_API_KEY` | Fallback | Default AI model when no user config |
| `GROQ_API_KEY` | Optional | Groq provider fallback |
| `OPENAI_API_KEY` | Optional | OpenAI provider fallback |
| `OPENROUTER_API_KEY` | Optional | OpenRouter proxy |
| `GITHUB_TOKEN` | Optional | Increases GitHub API rate limit (60→5000/hr) |
| `REDDIT_CLIENT_ID` | Optional | PRAW authenticated scraping |
| `REDDIT_CLIENT_SECRET` | Optional | PRAW authenticated scraping |
| `STRIPE_SECRET_KEY` | Yes | Stripe server-side |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Yes | Stripe client-side |
| `PROXY_LIST` | Optional | Comma-separated proxy URLs for scraper rotation |

---

## 15. Limitations & Known Issues

**Current state note (2026-03-24):**

- Validation now runs through a `pg-boss` queue worker with retries and depth-aware timeouts via [queue.ts](/c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/lib/queue.ts) and [worker.ts](/c:/Users/PC/Desktop/youcef/A/RedditPulse/app/worker.ts).
- The repo now includes targeted pipeline tests in [test_pipeline.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/tests/test_pipeline.py).
- Treat any older wording below that says “no queue” or “no tests” as historical drift from an earlier app state.

1. **Google/Bing Scraping** — Competition analysis relies on web scraping of search results, which is susceptible to blocks and CAPTCHAs. Robust fallback to `KNOWN_COMPETITORS` database mitigates this.

2. **PullPush.io Availability** — Historical Reddit data depends on PullPush.io, a third-party service that has intermittent downtime.

3. **G2/AppStore Scraping** — HTML parsing is fragile and will break when sites update their layouts. These are Phase 2 enrichment sources with graceful degradation.

4. **Rate Limits** — Reddit .json API (unofficial), GitHub (60/hr unauth), Stack Exchange (10K/day), Google Trends (via pytrends, aggressive blocking). All scrapers have retry/backoff logic.

5. **Premium Email Whitelist** — Hardcoded in two separate files (`check-premium.ts` and `use-user-plan.ts`). Must be updated in both places simultaneously.

6. **Single-Region Deployment** — No CDN or multi-region support. Supabase and Next.js run from a single region.

7. **No Automated Testing** — No unit tests, integration tests, or E2E tests exist in the codebase.

8. **Python Process Spawning** — API routes spawn Python as child processes. No queue system, no retry on failure, no resource limits.

9. **Pyre Type Errors** — Several engine files have unresolved type inference errors that don't affect runtime behavior but should be addressed.

---

## 16. Glossary

| Term | Definition |
|------|-----------|
| **AIBrain** | Class in `multi_brain.py` that manages multi-model AI calls and debate |
| **Adversarial Debate** | Process where AI models argue opposing positions (SKEPTIC vs BULL vs ANALYST) |
| **Confirmed Gap** | Feature gap detected independently in both SO questions and GitHub issues |
| **Credibility Tier** | Data quality rating: STRONG → MODERATE → WEAK → INSUFFICIENT → NONE |
| **Deathwatch** | Monitoring competitor complaint signals across Reddit |
| **Decomposition** | Phase 1 of validation — extracting keywords and subreddits from idea text |
| **Enrichment** | Adding SO/GitHub/G2/AppStore signals to a topic beyond Reddit data |
| **Graveyard** | Public SEO pages showing pre-analyzed failed startup ideas |
| **ICP** | Ideal Customer Profile built from post analysis |
| **Idea Stock Market** | Metaphor: each tracked topic has a "price" (0–100) that moves based on signals |
| **Market Pulse** | Background process that nudges validation confidence based on new matching posts |
| **Morning Brief** | Daily digest of alerts, competitor signals, and trend changes |
| **Multi-Brain** | The multi-model debate system that uses weighted evidence merging |
| **Pain Stream** | Retention feature: alerts when new posts match a validated idea's keywords |
| **PullPush** | Third-party API providing historical Reddit data (up to 90 days) |
| **RLS** | Row Level Security — PostgreSQL feature ensuring users only see their own data |
| **Sitemap Listener** | Discovers Reddit posts via XML sitemap before they appear in search |
| **Trend Signal** | Keyword momentum data with velocity and tier classification |
| **Triple-Confirmed** | Gap detected in SO + GitHub Issues + G2 reviews |
| **VADER** | Valence Aware Dictionary for Sentiment Reasoning — NLP sentiment tool |
| **WTP** | Willingness To Pay — extracted from posts containing pricing signals |

---

## Appendix A: Design Documents

The `docs/` folder contains 17 design documents for planned/implemented features:

| Document | Description |
|----------|-------------|
| `anti_idea_engine_v1.md` | Devil's advocate analysis spec |
| `codex_audit_phase0.md` | Comprehensive codebase audit |
| `compare_ideas_v1.md` | Side-by-side idea comparison spec |
| `competitor_weakness_radar_v1.md` | Competitor weakness detection spec |
| `decision_pack_v1.md` | Full decision package spec |
| `evidence_contract.md` | Evidence quality standards |
| `first_customer_engine_v1.md` | First customer acquisition spec |
| `founder_market_fit_matcher_v1.md` | Founder-market fit assessment spec |
| `live_market_memory_v2.md` | Monitor snapshots and delta tracking |
| `market_attack_engine_blueprint.md` | Market entry strategy blueprint |
| `market_attack_execution_plan.md` | Detailed execution plan for market attack |
| `market_attack_simulator_v1.md` | Market entry simulation spec |
| `monitoring_architecture.md` | Unified monitoring layer architecture |
| `opportunity_to_revenue_engine_v1.md` | Revenue pathway analysis spec |
| `service_first_saas_pathfinder_v1.md` | Service-first SaaS strategy spec |
| `trust_model.md` | Trust score calculation model |
| `why_now_engine_v1.md` | "Why now?" timing analysis spec |

---

*Documentation generated by reading every file in the RedditPulse codebase. Total files analyzed: 115+. Total lines of code: ~25,000.*

---

## 17. Technical Debt & Remediation Roadmap

**Current state note (2026-03-24):**

- The queue gap called out in older audit text is no longer current; a `pg-boss` validation queue is now live in [queue.ts](/c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/lib/queue.ts).
- The “zero automated tests” claim is also stale; the repo now has targeted validation pipeline tests in [test_pipeline.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/tests/test_pipeline.py).
- The most urgent current security drift is the publicly readable `user_ai_config_safe` view documented in [SUPABASE_POST_HARDENING_CHECKLIST.md](/c:/Users/PC/Desktop/youcef/A/SUPABASE_POST_HARDENING_CHECKLIST.md).

### Overall Assessment: B+

| Dimension | Score | Notes |
|-----------|-------|-------|
| Feature depth | 92 | 8 scrapers, 3-round debate, 45 topics, graveyard SEO |
| Architecture design | 72 | Clean separation: Next.js → API → Python engine → Supabase |
| Data quality logic | 85 | Shannon entropy, 5-tier credibility, confidence capping |
| Security posture | 48 | ~~Hardcoded emails~~ (fixed), ~~shell injection~~ (fixed), legacy plaintext keys (migration ready) |
| Reliability / ops | 28 | No queue, child-process spawning, fragile scrapers |
| Scalability | 42 | Sync Python blocks, random sampling, limited caching |
| Code maintainability | 48 | 19 SQL files, God scripts, dual config systems, no tests |

### Critical Issues — Fixed

| # | Issue | Status |
|---|-------|--------|
| 01 | **Shell injection in `/api/enrich`** — user input interpolated into `exec()` | ✅ Fixed — migrated to `spawn()` + config-file |
| 02 | **Premium emails hardcoded** — adding users required code deploy | ✅ Fixed — DB lookup primary, founder-only fallback |
| 03 | **No rate limit on enrich route** | ✅ Fixed — 3/hr limit added |
| 04 | **exec/eval audit** — RCE remediation verification | ✅ Verified — zero `exec()`/`eval()` in Python |

### Critical Issues — Migration Ready

| # | Issue | Migration |
|---|-------|-----------|
| 05 | **Legacy plaintext API keys** in `user_settings` and `api_key` column | `migrations/011_drop_legacy_plaintext_keys.sql` — run pre-flight checks first |

### High Priority — Next Sprint

| # | Issue | Priority | Recommended Fix |
|---|-------|----------|----------------|
| 06 | **No job queue** — Python child process with zero retry | P0 | Add pg-boss (runs inside Supabase, no Redis needed) |
| 07 | **Zero automated tests** across 25,000 lines | P1 | Test verdict logic, confidence capping, debate weights, slop filter |
| 08 | **`scraper_job.py` is a 1,359-line God Script** | P1 | Extract into: `topic_classifier.py`, `stock_pricer.py`, `pulse_updater.py` |
| 09 | **Random sampling** introduces non-determinism | P1 | Replace `random.sample(80)` with ranked top-80 by composite score |
| 10 | **19 SQL files** — no single source of truth for schema | P1 | Consolidate into one canonical `schema.sql` + versioned migrations only |
| 11 | **Google/Bing scraping** legally and technically fragile | P1 | Expand `KNOWN_COMPETITORS` DB, add SerpAPI as paid fallback |

### Remediation Roadmap

| Timeline | Focus | Actions |
|----------|-------|---------|
| Week 1 | Security | ~~Shell injection~~ ✅, ~~Premium to DB~~ ✅, Run migration 011, audit completed ✅ |
| Week 2 | Reliability | Add pg-boss job queue, retry logic, job status polling |
| Week 3 | Cost controls | Per-user monthly validation quota, cost tracking per run |
| Week 4 | Determinism | Replace random sampling with ranked top-80, add result caching (24h TTL) |
| Month 2 | Schema | Consolidate 19 SQL files into canonical schema + versioned migrations |
| Month 2 | Tests | Minimum: verdict logic, confidence capping, debate weight, slop filter |
| Month 3 | Positioning | Reposition from "idea validator" to "market intelligence platform" |

### Genuine Technical Advantages

These are features no competitor implements:

1. **3-round adversarial AI debate** — SKEPTIC / BULL / MARKET_ANALYST with weighted merge by `evidence_count × (1 − unknowns_ratio)`
2. **Reddit sitemap listener** — discovers posts before search indexes them
3. **Shannon entropy source diversity scoring** — information theory applied to scraper output
4. **Competitor Deathwatch** — 15 complaint signal patterns with UUID5 dedup
5. **Subreddit-baseline normalized scoring** — signal quality over raw engagement
6. **Opportunity Engine** — 45 topics × 12 categories, essentially a second product
