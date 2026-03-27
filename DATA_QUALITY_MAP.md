# RedditPulse Data Quality Map

## Purpose

This file maps:

- what data RedditPulse stores
- how each dataset is produced
- which product surface uses it
- how trustworthy it is
- where the app is currently mixing different trust levels

The goal is simple:

> RedditPulse should know what it knows, how it knows it, and what it should not overclaim.

---

## The 4 Real Data Layers

RedditPulse does **not** have one intelligence system. It has four:

1. **Evidence Layer**
   - raw scraped content and metadata
   - closest thing to ground truth

2. **Interpretation Layer**
   - AI or heuristic summaries on top of evidence
   - useful, but not decision-grade by default

3. **Market Memory Layer**
   - aggregated topics, trends, scores, monitors, history
   - good for pattern detection and ranking

4. **Decision Layer**
   - targeted idea validation
   - highest-trust product output

The app gets weaker whenever these layers are treated as equivalent.

---

## Trust Tiers

Use these trust tiers across the whole app:

| Tier | Name | Meaning | Example |
|------|------|---------|---------|
| T1 | Raw Evidence | Directly scraped source text or metadata | `posts.title`, `posts.full_text`, subreddit, score |
| T2 | Deterministic Enrichment | Rule-based or deterministic interpretation of evidence | source taxonomy, frustration score, evidence tier |
| T3 | Model Inference | AI-generated interpretation or synthesis | `ai_analysis.problem_description`, scan synthesis |
| T4 | Aggregate Heuristic | Topic-level ranking, velocity, clustering, trend summaries | `ideas.current_score`, trend baselines, confidence tiers |
| T5 | Decision-Grade Validation | Guardrailed validation output after filtering, synthesis, and debate | `idea_validations.report` |

Rule of thumb:

- **T1-T2** can support direct proof
- **T3-T4** should support exploration and context
- **T5** is the only layer allowed to make strong product decisions

---

## Canonical Data Inventory

### 1. Evidence Layer

#### `posts`
- Defined in [schema_saas.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/sql/schema_saas.sql)
- Populated by:
  - [scraper_job.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scraper_job.py)
  - [run_scan.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/run_scan.py)
- Contains:
  - raw content
  - subreddit/platform metadata
  - engagement
  - timestamps
  - deterministic/heuristic enrichment like sentiment, frustration, opportunity, source, score breakdown
- Trust tier:
  - **T1** for raw fields
  - **T2** for enrichment fields
- Used by:
  - scan details
  - market clustering
  - alerts/complaints/trends
  - validation rescoring

What it is good for:
- direct evidence
- source provenance
- downstream filtering

What it is bad for:
- final product verdicts without filtering

---

### 2. Interpretation Layer

#### `scans`
- Defined in [schema_scans.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/sql/schema_scans.sql)
- Populated by [run_scan.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/run_scan.py)
- Contains:
  - user-triggered keyword scan metadata
  - credibility tier/data
  - trend data
  - ICP data
  - competition data
  - synthesis report
- Trust tier:
  - mostly **T3**
  - some credibility/trend pieces can be treated as **T2-T4** depending on field
- Used by:
  - scan pages
  - exploratory analysis

What it is good for:
- fast exploration
- discovery workflows

What it is bad for:
- overriding validation output

#### `ai_analysis`
- Defined in [schema_scans.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/sql/schema_scans.sql)
- Populated by [run_scan.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/run_scan.py)
- Contains per-post AI interpretations:
  - problem description
  - urgency
  - willingness to pay
  - WTP evidence
  - market size
  - solution idea
- Trust tier:
  - **T3**
- Used by:
  - scan details
  - exploratory UI

What it is good for:
- exploration
- post-level drill-down

What it is bad for:
- direct report claims unless explicitly joined and guarded

#### `enrichment_cache`
- Defined in [schema_enrichment.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/sql/schema_enrichment.sql)
- Populated by [enrich_idea.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/enrich_idea.py) and `/api/enrich`
- Contains:
  - Stack Overflow signals
  - GitHub issues
  - G2 gaps
  - app store pains
  - confirmed gaps
- Trust tier:
  - **T3-T4**
- Used by:
  - deeper enrichment flows
  - confirmatory side-intelligence

What it is good for:
- triangulation
- supporting technical/product gaps

What it is bad for:
- being mistaken for buyer-native demand proof

---

### 3. Market Memory Layer

#### `ideas`
- Defined in [schema_stock_market.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/sql/schema_stock_market.sql)
- Populated by [scraper_job.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scraper_job.py)
- Contains:
  - topic clusters
  - market score
  - trend direction
  - confidence level
  - source counts
  - top posts
  - pain summary
  - ICP data
  - competition data
  - score breakdown
- Trust tier:
  - **T4**
  - with some embedded **T1-T3** material
- Used by:
  - market board
  - idea cards
  - trend pages
  - compare flows

What it is good for:
- prioritization
- ranking
- topic memory

What it is bad for:
- exact build/no-build judgments

#### `idea_history`
- Defined in [schema_stock_market.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/sql/schema_stock_market.sql)
- Populated by [scraper_job.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scraper_job.py)
- Contains:
  - historical snapshots of idea score and signal counts
- Trust tier:
  - **T4**
- Good for:
  - charting
  - trajectory

#### `scraper_runs`
- Defined in [schema_stock_market.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/sql/schema_stock_market.sql)
- Populated by [scraper_job.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scraper_job.py)
- Contains:
  - operational audit trail for market scraper
- Trust tier:
  - **T2**

#### `trend_signals`
- Referenced across market/trend routes and scraper aggregation
- Derived from [scraper_job.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scraper_job.py)
- Trust tier:
  - **T4**

What it is good for:
- timing context

What it is bad for:
- proving buyer pain

---

### 4. Decision Layer

#### `idea_validations`
- Defined in [schema_validations.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/sql/schema_validations.sql)
- Extended by migrations like:
  - [007_idea_validations_extra_columns.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/migrations/007_idea_validations_extra_columns.sql)
  - [014_validation_depth.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/migrations/014_validation_depth.sql)
  - [019_validation_progress_log.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/migrations/019_validation_progress_log.sql)
- Populated by [validate_idea.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/validate_idea.py)
- Contains:
  - decomposition
  - source breakdown
  - filtered evidence
  - problem validity
  - business validity
  - debate
  - final report JSON
  - progress log
- Trust tier:
  - **T5**
- Used by:
  - validation page
  - reports page
  - compare ideas
  - watchlists tied to validations

What it is good for:
- build/no-build guidance
- explicit uncertainty
- decision support

What it is bad for:
- long-term market memory without grounding back to evidence

#### `validation_queue`
- Defined in [schema_queue.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/schema_queue.sql)
- Contains async job state for validations
- Trust tier:
  - operational only

---

### 5. Monitoring / Retention Layer

#### `pain_alerts`, `alert_matches`, `competitor_complaints`, `graveyard_reports`, `user_requested_subreddits`
- Defined in [schema_retention.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/sql/schema_retention.sql)
- Populated by:
  - scraper and validation side effects
  - user actions
- Trust tier:
  - mixed
  - `competitor_complaints` is mostly **T2-T3**
  - alerts are operational wrappers around evidence
  - graveyard reports are report-grade exports but not primary decision records

#### `monitors`, `monitor_events`, `monitor_snapshots`
- Defined in [009_monitor_core.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/migrations/009_monitor_core.sql) and [010_live_market_memory.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/migrations/010_live_market_memory.sql)
- Trust tier:
  - **T4**
- Used by:
  - watchlist-like recurring monitoring
  - future briefing surfaces

#### `morning_brief_cache`
- Defined in [006_morning_brief_cache.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/migrations/006_morning_brief_cache.sql)
- Trust tier:
  - output cache only

---

## Source Acquisition Map

### Market pipeline
- Entry point: [scraper_job.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scraper_job.py)
- Acquires:
  - Reddit async live
  - Reddit sync fallback
  - PullPush historical posts
  - PullPush historical comments
  - Reddit sitemap
  - PRAW authenticated
  - Hacker News
  - Product Hunt
  - Indie Hackers
- Produces:
  - `posts`
  - `ideas`
  - `idea_history`
  - `scraper_runs`
  - `trend_signals`
  - `pain_alerts` matches
  - `competitor_complaints`

### Scan pipeline
- Entry point: [run_scan.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/run_scan.py)
- Acquires:
  - Reddit
  - HN
  - Product Hunt
  - Indie Hackers
- Produces:
  - `scans`
  - `posts`
  - `ai_analysis`

### Validation pipeline
- Entry point: [validate_idea.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/validate_idea.py)
- Acquires:
  - Reddit posts
  - Reddit comments
  - G2
  - jobs
  - vendor blogs
  - HN
  - Product Hunt
  - Indie Hackers
  - Stack Overflow
  - GitHub Issues
- Produces:
  - `idea_validations.report`
  - `idea_validations.progress_log`
  - validation status / source breakdown / audit

---

## What Should Drive What

### Allowed to drive Problem Validity
- T1 raw buyer-native evidence
- T2 deterministic evidence tiers and provenance
- T5 guarded validation synthesis

### Allowed to support Business Validity
- T1/T2 evidence
- T3 interpretation
- T4 trends, market memory, competitor context
- T5 final validation analysis

### Should never be treated as direct proof by themselves
- per-post `ai_analysis`
- scan synthesis reports
- market score / idea rank
- trend acceleration
- competitor count
- pricing guesses without WTP

---

## Current Data Quality Risks

### 1. Same truth exists in multiple places
Examples:
- ICP exists in `scans`, `ideas`, and `idea_validations.report`
- competition exists in `scans`, `ideas`, validation reports, and complaints tables
- trend exists in `trend_data`, `trend_signals`, and report timing

Risk:
- different pages can tell different truths about the same idea

### 2. Trust levels are mixed inside single UI surfaces
Example:
- a market card may show raw evidence, heuristic scores, and inferred pain summary together

Risk:
- users can mistake heuristics for proof

### 3. No universal claim lineage
Today many claims do **not** carry:
- exact source rows
- transformation chain
- trust tier
- freshness

Risk:
- hard to debug
- hard to explain
- easy to overclaim

### 4. Interpretation layers are richer than governance layers
The app can generate:
- WTP guesses
- TAM guesses
- competitor gaps
- pricing guidance

But it does not yet have a single system-level rule saying:
- which of these are hypotheses
- which are evidence-backed
- which can affect verdicts

### 5. System docs are already drifting
[SYSTEM_CARTOGRAPHY.md](/c:/Users/PC/Desktop/youcef/A/RedditPulse/SYSTEM_CARTOGRAPHY.md) is useful, but parts of it are stale against the current code and data flow.

Risk:
- the product can outrun its own mental model

---

## The Genius Step

Build a **Canonical Evidence Ledger**.

Not a new scraping source.
Not another LLM prompt.
Not another dashboard card.

A ledger.

Every important surfaced claim should map to:

| Field | Meaning |
|------|---------|
| `claim_id` | stable identifier |
| `claim_type` | pain, WTP, competition, timing, ICP, pricing, TAM, risk |
| `trust_tier` | T1-T5 |
| `source_table` | where it came from |
| `source_ids` | exact rows behind it |
| `derivation_steps` | raw -> filtered -> inferred -> validated |
| `buyer_native` | yes/no |
| `allowed_for_problem_validity` | yes/no |
| `allowed_for_business_validity` | yes/no |
| `last_refreshed_at` | freshness |
| `confidence_reason` | why the app trusts it |

Then:

- market cards can explain scores honestly
- validation reports can clearly separate proof from hypothesis
- monitoring can surface only durable claims
- debugging becomes much faster

---

## What This Unlocks

If the ledger exists, RedditPulse can become much stronger in 4 ways:

1. **Truthful reports**
   - pricing can be labeled as heuristic
   - pain quotes can be labeled as direct proof
   - trend can stay supporting context

2. **Unified market + validation language**
   - no more conflicting ICP/competition narratives across pages

3. **Safer future source expansion**
   - new sources plug into a trust model instead of just adding more data

4. **Higher-quality product reasoning**
   - the app can explicitly say:
     - “this is real evidence”
     - “this is inferred”
     - “this is a hypothesis”

---

## Recommended Next Step

Do this next before another big source expansion:

### Step 1
- define the trust-tier contract in code and docs

### Step 2
- add lineage metadata to major report claims

### Step 3
- make market and validation UI render trust-aware sections consistently

### Step 4
- only then expand new source classes aggressively

---

## Bottom Line

RedditPulse already has a lot of data.

The next leap is **not more data**.
The next leap is **knowing which data is evidence, which data is interpretation, and which data is allowed to make decisions**.

That is how the app goes from “smart and impressive” to “strong and trustworthy.”
