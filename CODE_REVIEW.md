# RedditPulse — Exhaustive Code Review & Logic Analysis
> ENI audit | 2026-03-18 | 36 files read | ~10,700 lines audited

---

## Executive Summary

RedditPulse is an architecturally ambitious product: 8 scrapers feed a multi-stage filtering pipeline, which feeds a 3-pass AI synthesis, which feeds a multi-model adversarial debate engine. For a solo/duo project this is sophisticated engineering. The confidence-cap system, the evidence-weighted debate consensus, and the batch summarization pipeline are genuinely well-designed.

**What's working**: The filtering pipeline (`validate_idea.py:1196-1430`) is the strongest part of the codebase. The `_relevance_assessment()` function correctly differentiates forced subreddits, topic-native subreddits, buyer-language sources, and generic subreddits — each with appropriate score thresholds. The fallback filter is a true additive union (not a replacement). The smart sampling strategy (40 top + 10 recent + 35 random + 15 outliers from 100 budget) produces good coverage. The debate engine's ±10 confidence clamp on HELD verdicts, engagement scoring, and round2 discipline blocks are well-thought-out anti-sycophancy measures.

**What's broken**: The scrapers have inconsistent timestamp formats (ISO strings vs Unix floats), several deprecated API calls (`datetime.utcfromtimestamp()`), and the `keyword_scraper.py` default `min_keyword_matches=2` is too aggressive for targeted validation (though `validate_idea.py` passes `min_keyword_matches=1`). The competition engine's Google search functions can timeout (90s total for 3 queries), causing false BLUE_OCEAN classifications — but this IS mitigated by the `KNOWN_COMPETITORS` short-circuit and `_apply_evidence_corrections()`. The most dangerous pattern is the confidence boost that can push past the cap's intent (cap at 55% + boost of 15 → 70%, defeating the purpose of the cap).

**What's dangerous**: The `re` module is imported inside a hot loop (`validate_idea.py:1049` inside `_check_data_quality`) on every run — not a crash risk, but wasteful. More critically, `random.sample()` in `_smart_sample()` is non-deterministic, meaning the same idea validated twice can produce different samples and therefore different verdicts. The batch summarization runs 6 parallel AI calls with no rate-limit awareness, which could exhaust API quotas on Groq's free tier mid-run.

**Most urgent fix**: The confidence cap + boost interaction (see P0 Bug #1 below). A cap of 55% for single-platform data can be boosted to 70%, which completely undermines the cap's purpose of preventing overconfident verdicts on thin data.

---

## Scraping Layer — Per-Scraper Analysis

### SCRAPER: keyword_scraper.py (Reddit Anonymous)

**File**: `engine/keyword_scraper.py` (514 lines)

**POST VOLUME**:
- Anonymous path: max 5 pages × 100 = 500 posts from global search, plus per-subreddit search across 15-30 subs (100/sub).
- PRAW path: global search limit=250, plus subreddit scrape sorts=["new","hot"] limit=100.
- PullPush backfill: 12 subs × 50 posts = 600 additional historical posts max.
- Theoretical max per 10min scan: ~2000-3000 posts before dedup. Practical: 100-500 after keyword filtering.

**FETCH MECHANISM**:
- **Anonymous**: `https://www.reddit.com/search.json` and `/r/{sub}/search.json` with random User-Agent rotation (4 agents, line 26-31).
- **PRAW**: Official Reddit API via `reddit_auth.py` (100 req/min).
- Connection timeout: 15s (line 72). No retries — rate-limited requests sleep 10s then return empty `([], "")` (line 73-76).
- PullPush: delegates to `pullpush_scraper.py`, 0.5s sleep between subs.

**POST FORMAT**:
- Returns dict with: `id`, `title`, `selftext`, `full_text`, `score`, `upvote_ratio`, `num_comments`, `subreddit`, `permalink`, `author`, `url`, `matched_keywords`.
- **BUG**: `created_utc` uses deprecated `datetime.utcfromtimestamp()` → ISO string output (line 148). This is inconsistent with scrapers that output Unix floats.
- No `source` field is set — posts from this scraper lack explicit source tagging. Downstream `_source_key()` in `validate_idea.py:1255` infers "reddit" from the `subreddit` field being present.

**SOURCE CLASSIFICATION**:
- No explicit `source` field. The `_source_key()` function in `validate_idea.py:1255-1280` handles this correctly — if `subreddit` is present with no `source`, it returns `"reddit"` (line 1278-1279).

**DEDUPLICATION**:
- Uses `seen_ids` set (line 292) keyed on `post["id"]` (Reddit's base36 ID). PRAW path uses `external_id`.
- Cross-scraper dedup in `validate_idea.py` uses the same `id` field. Working correctly.

**FAILURE MODES**:
- Rate limit (429) → sleeps 10s, returns empty list. **Caller is NOT notified** — appears as "0 posts found" silently.
- Non-200 → prints error, returns empty list silently.
- Network timeout → caught by `except Exception`, returns empty list silently.
- **All failure modes return `([], "")` — indistinguishable from "no matching posts exist"**.

**KNOWN BUGS / LOGIC FLAWS**:
1. **P2 — `min_keyword_matches` default is 2** (line 115, 277) but `validate_idea.py` passes `min_keyword_matches=1` at call sites. The function signature default would silently over-filter if called without the explicit argument.
2. **P2 — `_keyword_matches` is defined but inconsistently used**: `_parse_post()` (line 135) uses simple `kw.lower() in text_lower` substring matching, while `_keyword_matches()` (line 157-172) uses a smarter word-level matching for multi-word phrases. The PRAW path (line 322) correctly uses `_keyword_matches()`, but the anonymous path's `_parse_post()` does not.
3. **P2 — Deprecated `datetime.utcfromtimestamp()`** (line 148) — will raise `DeprecationWarning` in Python 3.12+ and is removed in 3.14.
4. **P3 — Long scan polling cycle** (line 467-492): `wait = min(60, remaining)` means the last cycle could sleep for up to 60s past the intended duration.

---

### SCRAPER: reddit_async.py (Reddit Async Anonymous)

**File**: `engine/reddit_async.py` (241 lines)

**POST VOLUME**:
- Fetches from Reddit JSON endpoints asynchronously with `max_concurrent=6` semaphore.
- Per subreddit/sort: 100 posts (limit=100). Across 15-30 subs × 1 sort ("new") = 1500-3000 raw posts.
- After dedup in `keyword_scraper.py`, typically 200-500 unique posts.

**FETCH MECHANISM**:
- Uses `aiohttp` with async semaphore for concurrency control.
- Timeout: 15s per request.
- Rate limiting: 2.5s `asyncio.sleep()` between batches.

**FAILURE MODES**:
- If `aiohttp` is not installed, falls back to sequential in `keyword_scraper.py` (line 412-413).
- Individual subreddit failures are caught and logged, don't kill the batch.

---

### SCRAPER: reddit_auth.py (PRAW/Official API)

**File**: `engine/reddit_auth.py` (184 lines)

**POST VOLUME**:
- `search_authenticated()`: limit=250 per search.
- `scrape_all_authenticated()`: 100 posts per subreddit × 2 sorts × N subs.
- Official API rate: 100 requests/minute.

**FETCH MECHANISM**:
- PRAW library wrapping Reddit OAuth2 API.
- Requires `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` env vars.
- `is_available()` checks for env vars — returns False if missing.

**SOURCE CLASSIFICATION**:
- Sets `source: "reddit"` explicitly in normalized output.

**FAILURE MODES**:
- `is_available()` returns False → keyword_scraper falls back to anonymous.
- PRAW exceptions caught individually per search call.

---

### SCRAPER: pullpush_scraper.py (Reddit Historical)

**File**: `engine/pullpush_scraper.py` (202 lines)

**POST VOLUME**:
- `scrape_historical()`: fetches from PullPush.io API, `size=50` per subreddit, `days_back=90`.
- Called for top 12 subreddits in keyword_scraper (line 440).
- Max: 12 × 50 = 600 historical posts.

**FETCH MECHANISM**:
- `https://api.pullpush.io/reddit/search/submission`
- Timeout: 30s.
- No authentication required.

**SOURCE CLASSIFICATION**:
- Sets `source: "pullpush"` — this IS handled by `_source_key()` in `validate_idea.py:1261` which maps `"pullpush"` → `"reddit"`.

**FAILURE MODES**:
- Returns `[]` on any exception. Caught in keyword_scraper with "PullPush backfill skipped" message.

---

### SCRAPER: sitemap_listener.py (Reddit Sitemap)

**File**: `engine/sitemap_listener.py` (201 lines)

**POST VOLUME**:
- Parses Reddit sitemap XML for recent URLs.
- Used in `scraper_job.py` background pipeline, NOT in validation pipeline.
- Returns new URLs discovered since last crawl.

**FETCH MECHANISM**:
- Fetches `https://www.reddit.com/sitemaps/subreddit-sitemaps/{sub}.xml`.
- Connection timeout: 10s.

**SOURCE CLASSIFICATION**:
- Sets `source: "sitemap"` — mapped to `"reddit"` by `_source_key()`.

**FAILURE MODES**:
- XML parse errors caught and logged. Returns empty list.

---

### SCRAPER: hn_scraper.py (Hacker News)

**File**: `engine/hn_scraper.py` (167 lines)

**POST VOLUME**:
- Uses HN Algolia API: `http://hn.algolia.com/api/v1/search_by_date`.
- `hitsPerPage=100`, searches last 30 days.
- Typical return: 20-100 posts per keyword set.

**FETCH MECHANISM**:
- Algolia API — no authentication required.
- Timeout: 20s.
- No rate limiting or backoff.

**POST FORMAT**:
- Returns: `external_id`, `title`, `body` (from `story_text`), `score` (points), `num_comments`, `subreddit` (set to `"HackerNews/{tag}"`).
- **BUG**: `created_utc` is set via `datetime.strptime().timestamp()` — returns a Unix float. This is CORRECT and consistent, unlike keyword_scraper.

**SOURCE CLASSIFICATION**:
- Sets `source: "hackernews"`. Correctly mapped by `_source_key()`.

**FAILURE MODES**:
- Returns `[]` on exception. Prints warning message.

---

### SCRAPER: ph_scraper.py (ProductHunt)

**File**: `engine/ph_scraper.py` (394 lines)

**POST VOLUME**:
- Multi-layer: GraphQL API → RSS feed → Web scraping fallback.
- GraphQL: 50 posts per query. RSS: 20 entries. Web scrape: 20 products.
- Typical return: 10-50 posts after combining all layers.

**FETCH MECHANISM**:
- GraphQL: `https://api.producthunt.com/v2/api/graphql` with `PH_API_KEY` bearer token.
- RSS: `https://www.producthunt.com/feed` — no auth.
- Web scrape: direct HTML parsing — no auth.
- Timeout: 15s for all requests.

**SOURCE CLASSIFICATION**:
- Sets `source: "producthunt"`. Correctly mapped.

**FAILURE MODES**:
- Each layer fails independently. If all 3 fail, returns `[]`.
- GraphQL 401 → logs "PH API key invalid", falls through to RSS.
- **Silent failure pattern**: empty list return with no indication whether API was attempted vs returned zero results.

---

### SCRAPER: ih_scraper.py (IndieHackers)

**File**: `engine/ih_scraper.py` (474 lines)

**POST VOLUME**:
- Algolia search: `hitsPerPage=100`. Up to 5 pages = 500 posts per keyword.
- Web scraping fallback: parses HTML, typically 20-50 posts.
- Practical return: 50-200 posts after dedup.

**FETCH MECHANISM**:
- Primary: Algolia API with dynamically refreshed keys (`_refresh_algolia_keys()` scrapes the IH homepage for embedded API credentials).
- Secondary: Direct web scraping with BeautifulSoup.
- Timeout: 20s for Algolia, 15s for web scraping.

**KEY RESET** (Known Issue #7):
- `_keys_refreshed` is a module-level global (line 21).
- `run_ih_scrape()` DOES reset it to `False` at line 388: `_keys_refreshed = False`.
- **STATUS: FIXED**. The reset happens BEFORE `_refresh_algolia_keys()` is called at line 395.

**SOURCE CLASSIFICATION**:
- Sets `source: "indiehackers"`. Correctly mapped.

**FAILURE MODES**:
- Algolia failure → sets `algolia_dead = True`, falls through to web scraping.
- Both fail → returns whatever was collected (could be empty).
- `_refresh_algolia_keys()` can fail silently if IH changes their HTML structure — the regex-based key extraction (parsing embedded JS) is fragile.

---

### SCRAPER: stackoverflow_scraper.py (Stack Overflow)

**File**: `engine/stackoverflow_scraper.py` (255 lines)

**POST VOLUME**:
- Uses SO API v2.3: `https://api.stackexchange.com/2.3/search/advanced`.
- `pagesize=100`, up to 3 pages = 300 questions.
- Rate limit: 300 requests/day without key, 10000 with key.

**FETCH MECHANISM**:
- REST API with optional `SO_API_KEY`.
- Timeout: 20s.
- API returns gzipped by default (handled by requests).

**POST FORMAT**:
- **BUG**: `created_utc` uses `datetime.utcfromtimestamp().isoformat() + "Z"` (deprecated, ISO string output) — same issue as keyword_scraper.

**SOURCE CLASSIFICATION**:
- Sets `source: "stackoverflow"`. Correctly mapped.

---

### SCRAPER: github_issues_scraper.py (GitHub Issues)

**File**: `engine/github_issues_scraper.py` (323 lines)

**POST VOLUME**:
- Uses GitHub Search API: `https://api.github.com/search/issues`.
- `per_page=50`, up to 2 pages = 100 issues.
- Rate limit: 30 requests/minute (search API), 5000/hour (authenticated).

**FETCH MECHANISM**:
- REST API with optional `GITHUB_TOKEN` bearer.
- Timeout: 15s.

**SOURCE CLASSIFICATION**:
- Sets `source: "github_issues"`.
- `_source_key()` in validate_idea.py maps `"github"` prefix → `"githubissues"` (line 1274-1275). **NOTE**: the raw source is `"github_issues"` (with underscore) and `_source_key()` checks `raw.startswith("github")` — this works correctly.

---

## Filtering Pipeline Analysis

### Primary Filter Gate (`validate_idea.py:1196-1340`)

**Exact scoring formula**: There is no numeric score formula in the filter. The filter uses a boolean relevance assessment (`_relevance_assessment()`) that returns `(True/False, reason_string)`.

**Pass conditions by source**:

| Source | Condition | Threshold |
|--------|-----------|-----------|
| Reddit (forced subreddit) | `score >= RELAXED_SCORE(2)` | Always pass if in forced_subreddits |
| Reddit (topic-native sub) | `score >= 2` AND `(colloquial_hits >= 1 OR body_formal_hits >= 1 OR kw_hits >= 1)` | Body match required |
| Reddit (generic sub) | `score >= 3` AND `(title_has_core_kw OR kw_hits >= 2)` | Stricter: title or 2+ keyword matches |
| Reddit (generic, relaxed) | `score >= 2` AND `any body/keyword match` | Body match fallback |
| HN | `score >= 3` AND `(title_has_core_kw OR kw_hits >= 2)` | Same as generic Reddit |
| IndieHackers | `score >= 2` AND `(body_formal_hits >= 1 OR kw_hits >= 1)` | Relaxed like reddit buyer-language |
| ProductHunt | `score >= 3` AND `(title_has_core_kw OR kw_hits >= 2)` | Standard threshold |

**"Title match" meaning**: `_title_has_core_kw()` (line 1291-1294) checks if the post title string-contains any core keyword (case-insensitive substring match, NOT regex, NOT exact word boundary match). This means "api" would match "capitalize" — potential false positive for short keywords.

**"Body match" meaning**: `_match_count()` (line 1282-1283) counts how many phrases appear as substrings in the concatenated body text (`selftext + body + text + full_text`). Body IS loaded for all sources — the concatenation at line 1302-1305 pulls from multiple possible field names.

**Posts with `score=0`**: Rejected by `score >= RELAXED_SCORE(2)` check. Score 0 and 1 posts are always filtered out.

**Posts with empty `full_text`**: Would have 0 body matches, 0 colloquial hits, and rely solely on `matched_keywords` from the scraper. If `matched_keywords` is also empty, rejected.

### Source-Aware Logic

- **Forced subreddits**: YES, get special treatment — score threshold drops from 3 to 2, and no keyword match required in title (line 1314-1317).
- **Subreddit quality differentiation**: YES, via `niche_subreddit_map` (line 1216-1248) for finance/legal/healthcare/agency/real_estate/hr/restaurant/retail niches. Matching subs get the relaxed `topic_native_subreddits` treatment.
- **Buyer-native vs developer differentiation**: YES. `buyer_language_sources = {"reddit", "reddit_comment", "indiehackers"}` (line 1201) get `RELAXED_SCORE=2` in fallback. HN doesn't get this treatment.

### Fallback Filter (`validate_idea.py:1346-1367`)

- Triggered when `len(pre_filtered) < 10` (line 1346).
- Condition: `score >= RELAXED_SCORE` for buyer sources, `score >= MIN_SCORE` for others, AND at least 1 keyword match (matched_terms, body_formal, or colloquial).
- **Is it truly additive?** YES. Line 1364-1366: `pre_filtered = primary_pre_filtered + [p for p in fallback_candidates if p not in primary_pre_filtered]`. Uses Python `not in` operator for list membership check (uses `is` identity, not content equality — but since these are the same dict objects, this works correctly).
- **Can fallback cause duplicates?** NO — the `if p not in primary_pre_filtered` check prevents this.
- **Can fallback REPLACE primary results?** Only if `pre_filtered` would be empty: line 1365-1366 has `or posts` which falls back to ALL posts as emergency if both primary AND fallback return empty.

### Smart Sample (`validate_idea.py:1138-1191`)

- **Budget**: 100 posts (line 1138).
- **Algorithm**: Deterministic buckets (top 40 by `weighted_score`, 10 most recent, 15 outliers = low score + high comments), PLUS `random.sample()` of 35 from remainder.
- **NON-DETERMINISTIC**: `random.sample()` (line 1187) uses no seed. Same idea validated twice → different random 35 → potentially different AI synthesis → **different verdict**. This is a **P1 determinism bug**.
- **Max sample size**: 100. If total posts ≤ 100, all posts are used (line 1148-1149).

### Source Classification Bug (Known Issue #1)

**Current normalization code** (`_source_key()` at line 1255-1280):

```python
known_reddit_sources = {"reddit", "reddit_comment", "pushshift", "pullpush", "reddit_search"}
if raw.startswith("hackernews"): return "hackernews"
if raw.startswith("producthunt"): return "producthunt"
if raw.startswith("indiehackers"): return "indiehackers"
if raw.startswith("stack"): return "stackoverflow"
if raw.startswith("github"): return "githubissues"
if raw_source in known_reddit_sources or raw.startswith("reddit") or raw_source.startswith("r/"):
    return "reddit"
if subreddit: return "reddit"
```

**STATUS: FIXED**. The `known_reddit_sources` set covers all Reddit scraper source values. The `subreddit` field fallback at line 1278-1279 catches posts from `keyword_scraper.py` that don't set a `source` field. The `startswith()` checks handle prefix variations. The earlier bug (Reddit posts counted as wrong source) is resolved.

### Post-Filter Observable Metrics

**Currently logged** (lines 1383-1430):
- Primary pass count and breakdown by source
- Reddit-specific detail: forced_subreddit_pass, body_match_pass, rejected_low_score, rejected_no_match
- Reddit pass rate percentage (with target 35-50%)
- Fallback mode and rescued count

**Still invisible**:
- Per-source pass rates for HN, PH, IH, SO, GH
- Individual post pass/fail reasons (only available as aggregate counts)
- The actual `weighted_score` used by `_smart_sample()` for the top-40 bucket — no log shows which posts were selected
- Batch summarization individual batch success/failure details beyond count

---

## Evidence Quality Analysis

### Scoring System (`scorer.py`)

**Engagement score formula** (line 41-54):
```python
score_ratio = math.log(1 + score / med_score) 
comment_ratio = math.log(1 + num_comments / med_comments)
raw = score_ratio * 0.6 + comment_ratio * 0.4
return min(raw / 2.5, 1.0)
```

**Subreddit baselines**: 15 subreddits defined (line 20-36). Default: median_score=10, median_comments=15. Examples: r/SaaS median=8, r/webdev median=25.

**Source weight multiplier**: No direct source weight in scoring. Cross-platform multiplier from `credibility.py` is applied as a multiplicative factor: 1.0× for single-source, 1.5× for 2 platforms, 2.2× for 3, 3.0× for 4 (line 272-282 in credibility.py).

**Recency boost** (line 70-80): Full bonus (1.0) for posts < 7 days old, linear decay to 0 over 90 days. Very reasonable.

**Can a post get a negative score?** NO. All components are ≥0 (log(1+x) ≥ 0, frustration ≥ 0, etc.). Minimum score is 0.0.

### Credibility System (`credibility.py`)

**5 credibility tiers** (line 26-72):

| Tier | Posts | Sources | Show Opportunity |
|------|-------|---------|-----------------|
| INSUFFICIENT | 0-19 | 1+ | No |
| LOW | 20-49 | 1+ | Yes |
| MODERATE | 50-199 | 1+ | Yes |
| HIGH | 200-499 | 2+ | Yes |
| STRONG | 500+ | 3+ | Yes |

**Shannon entropy**: YES, actually used in `_source_diversity()` (line 129-146). Normalized to 0-1 scale. Used in the `CredibilityReport.source_diversity_score` field.

**Is credibility feeding back into confidence?** PARTIALLY. The `credibility.py` module produces a `CredibilityReport` but it's primarily used in `scraper_job.py` background pipeline, not directly in `validate_idea.py`'s confidence cap. The confidence cap in `validate_idea.py` has its OWN post-count thresholds (lines 958-969) that are separate from credibility tiers. These thresholds are MORE aggressive: <5 posts → cap 30%, <10 → cap 45%, <20 → cap 65%.

**Is `show_opportunity` being used?** YES, by `credibility.py:346-380` to generate AI prompt modifiers. But `validate_idea.py` doesn't call `assess_credibility()` — it has its own inline post-count logic. This is a **design smell**: two parallel confidence systems.

### Analyzer (`engine/analyzer.py`)

**AI slop filter**: Runs during analysis phase. Uses VADER sentiment as one signal. If VADER fails to load, the code catches the import error and falls back to a simplified sentiment score.

**Frustration/opportunity detection**: Works via keyword matching in `full_text`. Short posts (<30 characters) are already filtered out by `keyword_scraper.py:130`, so the analyzer never sees them.

### Confidence Cap System (`validate_idea.py:942-1125`)

**Full list of confidence cap rules**:

| Condition | Cap | Line |
|-----------|-----|------|
| `total_posts < 5` | 30% | 959 |
| `total_posts < 10` | 45% | 963 |
| `total_posts < 20` | 65% | 967 |
| `platforms_with_data <= 1` | 55% | 979 |
| `dominance > 0.85` (platform imbalance) | 55% | 984 |
| HN audience mismatch (non-dev ICP + HN dominant) | -10% penalty | 999 |
| WTP mismatch (no WTP signals + specific pricing) | 60% | 1035 |
| Pain not validated | 50% | 1041 |
| Market timing DECLINING/DEAD | 55% | 1064 |
| Few evidence posts (<3) | 60% | 1069 |

**HN audience mismatch**: Correctly applied via `_is_audience_platform_mismatch()` (line 373-378). Checks if idea keywords contain non-dev terms AND HN dominance > 70%.

**Platform imbalance**: Correctly calculated using proportion-based dominance (line 973-975), not just platform count.

**WTP mismatch**: Checks for negative WTP phrases in pass1 output AND presence of specific pricing tiers in pass2. If both true → cap at 60%, add to contradictions list.

**Conversion fantasy**: Checks if any projection month has conversion rate ≥ 10% → adds to contradictions; ≥ 7% → adds to warnings (lines 1099-1107). Correctly extracts numeric values from varied AI output formats.

**Confidence boosts** (line 1802-1831):

| Signal | Boost |
|--------|-------|
| GROWING trend | +5 |
| EXPLODING trend | +10 |
| LOW/MEDIUM competition | +5 |
| Pain validated + 10+ evidence | +5 |
| WTP signals present | +5 |

Total boost capped at 15. Final boosted confidence capped at 85.

**P0 BUG — Cap + Boost interaction**: Cap is applied first (line 1797), then boost is added (line 1821). The boost has its own ceiling of 85 (line 1821), but there is NO check that the boosted value doesn't exceed the CAP's intended purpose. Example: single-platform + thin data → cap at 55%, then GROWING trend + LOW competition + WTP → +15 boost → 70%. The cap was supposed to limit confidence because data is from one platform, but the boost defeats this. **The fix should be: `boosted = min(capped_confidence + total_boost, min(85, data_quality["confidence_cap"]))`**.

---

## Debate Engine Analysis (`multi_brain.py`)

### Model Initialization (`AIBrain.__init__`, line 841-869)

- Filters to `is_active=True` configs.
- Deduplicates by `(provider, resolved_model)` signature — prevents 2 identical Groq/Llama configs.
- Sorts by priority ascending.
- Raises exception if 0 active configs remain.
- `resolve_model()` auto-corrects stale/wrong model names via `MODEL_ALIASES` (line 377-423).

**What happens with 0 models?** → Exception raised at line 864: "No active AI models configured."

**What happens with 1 model?** → Round 1 runs with single model. If it succeeds, `_weighted_merge()` is called directly (line 1077-1086). No debate. Verdict is the single model's output.

**Priority ordering**: Correct — `sorted(active_configs, key=lambda row: row.get("priority", 9999))` (line 846).

### Round 1 (line 930-1048)

- **Parallel execution**: YES. `ThreadPoolExecutor(max_workers=6)` with `concurrent.futures.as_completed()` (line 996-1001).
- **Timeout mechanism**: No explicit per-model timeout in Round 1. Each provider function has its own `timeout=120` on `requests.post()`. Timeout errors are detected via `_is_timeout_error()` and the config is added to `_unavailable_config_ids`.
- **Invalid JSON response**: `extract_json()` attempts repair via `_repair_truncated_json()` (lines 804-825). If repair fails, `json.loads()` raises `JSONDecodeError`, caught by `except Exception` at line 984. Model is marked as errored, result=None.
- **Unexpected verdict value**: `normalize_verdict_text()` (line 544-547) normalizes to uppercase, replaces apostrophes, hyphens, spaces with underscores. Any non-standard verdict string passes through — no validation against a whitelist. This is intentional — the weighted merge handles arbitrary verdict strings.
- **Role assignment**: DETERMINISTIC. `AGENT_ROLES[agent_index % len(AGENT_ROLES)]` (line 952). Index 0=SKEPTIC, 1=BULL, 2=MARKET_ANALYST. Since configs are sorted by priority, the order is stable.

### Round 2 (line 1104-1289)

- **Context for each model**: Own full R1 JSON output + sanitized (scores/verdicts stripped) other models' reasoning + non-LLM signals (trends, competition).
- **Context trimming for small context windows**: YES, for "qwen" models. If estimated tokens > 6000, R1 output is summarized to 300 words max via `summarize_round1_for_debate()` (line 1170-1190).
- **Max context before trimming**: 6000 estimated tokens (line 1170). Token estimation is `len(text) / 4` (line 674-679).
- **Invalid verdict in R2**: Same `normalize_verdict_text()` normalization.
- **2/3 models timeout in R2**: Each is processed sequentially (NOT parallel — line 1142 `for a in valid`), so each timeout adds up. If all fail, line 1287-1289: "All Round 2 agents failed — falling back to Round 1 results." **P2 — Round 2 is sequential**, unlike Round 1 which is parallel. This is a performance bug for 3+ model setups.

### Weight Calculation (line 1315-1341)

**Exact formula** (line 1329):
```python
weight = max(0.5, 1.0 + (evidence_count * 0.1))
```

This means: a model citing 10 evidence posts gets weight 2.0, a model citing 0 gets weight 1.0 (floored at 0.5).

**`unknowns_ratio` calculation**: NOT used anymore. The old formula `1 / (1 + unknowns * 0.2)` was replaced by the evidence-based formula above. Unknowns are tracked but do NOT penalize weight.

**`evidence_count = 0`**: Weight = max(0.5, 1.0 + 0) = 1.0. Not problematic.

**Can weight be negative or zero?** NO. Minimum is 0.5 due to `max(0.5, ...)`.

### Confidence Clamping (line 1207-1211)

**±10 limit on HELD verdicts**: YES, enforced in Python (line 1208):
```python
if held:
    current_confidence = max(previous_confidence - 10, min(previous_confidence + 10, current_confidence))
```

**Enforcement location**: After receiving R2 response, before writing to `round2_entries`. Correct location.

**Engagement penalty** (line 1209-1210): If `engagement_score == 0` (model didn't reference any other model) AND confidence increased, confidence is forced back to `previous_confidence`. This effectively prevents all confidence increases without engagement. **Well-designed anti-sycophancy measure**.

**Can a model reach 100 in one round?** In R1: yes, models can output confidence=100. In R2 with held verdict: capped at previous+10. If R1 was 90, R2 max is 100. If R1 was 100, R2 stays at 100. So yes, 100 is reachable.

### Final Synthesis (`_weighted_merge`, line 1306-1571)

- **Weighted vote**: `verdict_weights[v] += weight` for each model. Highest total weight wins.
- **Tiebreaker**: If top verdicts have equal weight (within 1e-9), `final_verdict = "RISKY"` (line 1353). This is the conservative tiebreaker.
- **Dissent identification**: Correct — any model whose verdict ≠ final_verdict is recorded in `dissent` list (line 1382-1397).
- **`dissent_reason`**: Extracted from the model's R2 argument text via `build_dissent_reason()` (line 1502). Falls back to first substantive sentence, then to truncated snippet.
- **High dissent penalty**: If dissent ≥ 50% of total models → confidence capped at 45% (line 1369). If tie → capped at 40% (line 1366).

### debate_transcript Structure (line 1510-1535)

- **Written to report JSON?** YES, at `validate_idea.py:1975`: `report["debate_transcript"] = verdict_report.get("debate_transcript")`.
- **Contains `round2_summary`?** YES (line 1522).
- **Contains `engagement_score` per model?** YES, in round2_entries within transcript_rounds (line 1223).
- **Contains `confidence_delta` per round?** YES (line 1220).
- **Old reports without transcript handled?** `verdict_report.get("debate_transcript")` returns `None` if missing — frontend should handle null.

---

## Competition Engine Analysis (`competition.py`)

### Tier Calculation (line 390-416)

**Exact tier ladder**:

| Tier | Product Count (g2 + ph) |
|------|------------------------|
| BLUE_OCEAN | ≤ 5 |
| EMERGING | 6-20 |
| COMPETITIVE | 21-100 |
| SATURATED | > 100 |

**KNOWN_COMPETITORS feeding**: YES. `match_known_competitors()` returns a synthetic report with `len(known_comp) * 8` as total_products. If matched, Google search is SKIPPED entirely (line 507-511) to avoid timeout-induced BLUE_OCEAN false positives.

**Complaint evidence feeding**: YES. `_apply_evidence_corrections()` (line 226-297) corrects BLUE_OCEAN → EMERGING (if known competitors exist) or → COMPETITIVE (if complaints + 2+ active competitor names).

**Can BLUE_OCEAN survive despite known competitors?** Only if `analyze_competition()` goes through the Google search path (no KNOWN_COMPETITORS match) AND Google returns ≤5 products AND `_apply_evidence_corrections()` receives empty known_competitors list AND 0 complaint_count. In the `validate_idea.py` flow (line 2218-2225), `known_competitors=early_competitor_names` is always passed, so this scenario requires the AI decomposition to produce 0 competitor names AND deathwatch to find 0 complaints. Effectively: BLUE_OCEAN only survives for truly novel ideas with no known competition.

**Post-synthesis correction** (`validate_idea.py:1877-1888`): Additional safety net — if competition_data returned BLUE_OCEAN but the AI report named competitors, it's corrected to EMERGING/COMPETITIVE. This double-correction ensures BLUE_OCEAN is very hard to produce falsely.

### G2 / ProductHunt Scraping

- **G2**: `_count_g2_products()` uses Google search (`site:g2.com "{kw}" product`) with Bing fallback. Does NOT scrape G2 directly.
- **PH**: `_count_ph_launches()` uses Google search (`site:producthunt.com "{kw}" launch`).
- Both can return -1 on failure (timeout/block).
- If both return -1, `all_failed` flag stays True, and competition defaults based on known competitors.

### Competitor Deathwatch Integration (`validate_idea.py:2194-2210, 2273-2291`)

- **Early scan** (line 2196-2210): Runs BEFORE competition analysis, using decomposition competitor hints. Scans scraped posts for complaint patterns about named competitors.
- **Post-synthesis scan** (line 2273-2291): Runs AFTER report is built. Adds newly discovered competitors from the AI report.
- **Race condition?** No — both scans operate on the same `posts` list which is fully populated by phase2. The complaint data flows into competition analysis via `complaint_count` and `complaint_competitors` parameters.
- **Stale data possible?** The early scan uses decomposition competitor names which may differ from what the AI report discovers. The post-synthesis scan catches these. No true race condition.

---

## Bug Catalogue

### P0 — Production-Blocking

| # | Bug | File:Line | Description | Fix |
|---|-----|-----------|-------------|-----|
| 1 | **Confidence boost defeats cap intent** | `validate_idea.py:1821` | Cap of 55% (single-platform) + 15pt boost → 70%. Cap's purpose is defeated. | Change line 1821 to `boosted = min(capped_confidence + total_boost, min(85, data_quality["confidence_cap"]))` |
| 2 | **Non-deterministic sampling** | `validate_idea.py:1187` | `random.sample()` with no seed → same idea produces different verdicts on re-run. | Add `_random.seed(hash(idea_text))` before sampling |

### P1 — Can Cause Wrong Results

| # | Bug | File:Line | Description | Fix |
|---|-----|-----------|-------------|-----|
| 3 | **Round 2 is sequential (not parallel)** | `multi_brain.py:1142` | R2 runs `for a in valid` sequentially. With 3 models × 120s timeout = 360s worst case. R1 uses ThreadPoolExecutor. | Wrap R2 in same parallel executor pattern |
| 4 | **Deprecated `datetime.utcfromtimestamp()`** | `keyword_scraper.py:148`, `stackoverflow_scraper.py` | Python 3.12+ DeprecationWarning, removed in 3.14 | Use `datetime.fromtimestamp(ts, tz=timezone.utc)` |
| 5 | **Inconsistent `_parse_post` vs `_keyword_matches`** | `keyword_scraper.py:135 vs 157` | Anonymous path uses simple substring, PRAW path uses word-level matching. Same keywords can match differently. | Use `_keyword_matches()` consistently |
| 6 | **`re` import inside function body** | `validate_idea.py:1049` | `import re` inside `_check_data_quality()` — works but is a code smell and wastes cycles | Move to top-level import |
| 7 | **Substring keyword matching false positives** | `validate_idea.py:1293-1294` | `_title_has_core_kw()` uses `kw in title` — "api" matches "capitalize", "hr" matches "three" | Use word boundary regex or `\b` matching |

### P2 — Quality Degradation

| # | Bug | File:Line | Description | Fix |
|---|-----|-----------|-------------|-----|
| 8 | **Two parallel confidence systems** | `credibility.py` + `validate_idea.py:958` | `credibility.py` has INSUFFICIENT/LOW/MODERATE/HIGH/STRONG tiers; `validate_idea.py` has separate post-count caps. They don't reference each other. | Consolidate into one system |
| 9 | **Silent scraper failures** | Multiple scrapers | All scrapers return `[]` on failure — caller cannot distinguish "no results" from "service down". | Return `([], {"status": "error"})` tuple |
| 10 | **Batch summarization no rate-limit awareness** | `validate_idea.py:1516` | `ThreadPoolExecutor(max_workers=6)` runs 6 AI calls simultaneously. Groq free tier = ~30 req/min. | Add rate limiter or reduce max_workers for Groq |
| 11 | **`'filter_diagnostics' in dir()` checks** | `validate_idea.py:1901-1903` | Uses `'var_name' in dir()` to check if local variable exists. Fragile — should use `try/except NameError` or ensure variable is always defined. | Initialize variables at function start |
| 12 | **Evidence dedup by first 200 chars** | `multi_brain.py:1417` | `ev_key = ev_str.lower().strip()[:200]` — two different evidence items with same first 200 chars would be deduped incorrectly. | Use full text or hash |
| 13 | **Cross-platform dedup uses `SequenceMatcher`** | `credibility.py:314,331` | O(n²) comparison for dedup with 0.85 threshold. With 500+ posts, this is slow. | Use locality-sensitive hashing |

---

## Known Issues Verification

### 1. Reddit Source Classification

**STATUS: FIXED** ✓

`_source_key()` at `validate_idea.py:1255-1280` correctly normalizes all Reddit source variants (`"reddit"`, `"reddit_comment"`, `"pushshift"`, `"pullpush"`, `"reddit_search"`, and any `source.startswith("reddit")` or `source.startswith("r/")`). Posts without a `source` field but with a `subreddit` field are correctly classified as `"reddit"` (line 1278-1279). The filter logging at line 1388-1421 now shows Reddit-specific pass rates with correct counts.

### 2. Qwen Context Overflow in Round 2

**STATUS: FIXED** ✓

`multi_brain.py:1168-1190` checks if model label contains "qwen" AND estimated tokens > 6000. If so, both own_analysis and other models' reasoning are summarized via `summarize_round1_for_debate()` (max_words=300). Token estimation at line 674: `len(text) / 4`. The trimming is logged: `"R2 context trimmed for qwen: X -> Y tokens"`.

### 3. Primary Filter Reddit Pass Rate

**STATUS: FIXED** ✓

The `_relevance_assessment()` function (line 1300-1340) correctly handles forced subreddits (line 1314-1317), topic-native subreddits (line 1318-1323), and body-match passes (line 1326-1327). The pass rate is logged at line 1418-1421 with a "target 35-50%" annotation. The body_match_pass path ensures Reddit posts with buyer-language in the body (but not title) are captured.

### 4. Competition BLUE_OCEAN False Negative

**STATUS: FIXED** ✓

Three layers of protection:
1. `match_known_competitors()` short-circuits Google search entirely if idea matches known categories (line 477-511).
2. `_apply_evidence_corrections()` (line 226-297) corrects BLUE_OCEAN → EMERGING/COMPETITIVE based on known_competitors and complaint evidence.
3. Post-synthesis correction in `validate_idea.py:1877-1888` catches any remaining BLUE_OCEAN that contradicts AI-reported competitors.

### 5. Confidence Cap + Boost Interaction

**STATUS: STILL PRESENT** ⚠️

Cap is applied at line 1797: `capped_confidence = min(raw_confidence, data_quality["confidence_cap"])`.
Boost is applied at line 1821: `boosted = min(capped_confidence + total_boost, 85)`.
The boost ceiling (85) is independent of the cap value. A cap of 30% (for <5 posts) + max boost of 15 → 45%, which is reasonable. But a cap of 55% (single platform) + boost of 15 → 70%, which defeats the purpose. The fix requires: `boosted = min(capped_confidence + total_boost, min(85, data_quality["confidence_cap"] + 5))` or similar.

### 6. Fallback Rescue vs Primary Union

**STATUS: FIXED** ✓

Line 1364-1366:
```python
pre_filtered = (
    primary_pre_filtered + [p for p in fallback_candidates if p not in primary_pre_filtered]
) or posts
```
This is a true additive union. Primary results are always preserved. Fallback only adds NEW posts not already in primary. The `or posts` at the end is an emergency fallback that only triggers if both primary AND fallback produce zero results — it gives ALL posts to the AI rather than returning nothing.

### 7. IH Algolia Key Reset Per Run

**STATUS: FIXED** ✓

`ih_scraper.py:386-388`:
```python
global _keys_refreshed
_keys_refreshed = False
```
This runs at the START of `run_ih_scrape()`, BEFORE `_refresh_algolia_keys()` is called at line 395. Correctly ensures fresh key refresh on each scan.

### 8. pytrends FutureWarning

**STATUS: NOT FOUND** ✓

No `fillna` calls found in `engine/trends.py`. Either already fixed or never present in the current codebase version. The `df.fillna(False)` downcasting warning is a pytrends library internal issue — if pytrends is used, the warning would come from the library itself.

---

## Priority Fix List

| Priority | Bug # | File:Line | One-line Description |
|----------|-------|-----------|---------------------|
| **P0** | 1 | `validate_idea.py:1821` | Confidence boost can defeat cap intent — add cap-aware ceiling |
| **P0** | 2 | `validate_idea.py:1187` | Non-deterministic `random.sample()` — add seed |
| **P1** | 3 | `multi_brain.py:1142` | Round 2 sequential — parallelize like Round 1 |
| **P1** | 4 | `keyword_scraper.py:148` | Deprecated `utcfromtimestamp()` — use timezone-aware |
| **P1** | 5 | `keyword_scraper.py:135` | Inconsistent keyword matching between paths |
| **P1** | 7 | `validate_idea.py:1293` | Substring matching false positives for short keywords |
| **P2** | 8 | Multiple | Two parallel confidence systems (credibility.py vs inline caps) |
| **P2** | 9 | Multiple scrapers | Silent failures indistinguishable from empty results |
| **P2** | 10 | `validate_idea.py:1516` | Batch AI calls with no rate-limit awareness |
| **P2** | 11 | `validate_idea.py:1901` | Fragile `'var' in dir()` checks |
| **P2** | 12 | `multi_brain.py:1417` | Evidence dedup by first 200 chars — can lose unique evidence |
| **P2** | 13 | `credibility.py:331` | O(n²) dedup with SequenceMatcher |

---

## What Is Working Correctly

1. **Filtering pipeline** (`validate_idea.py:1196-1450`): Excellent. The multi-tier relevance assessment with forced subreddits, topic-native niche matching, buyer-language body evidence, and fallback rescue is sophisticated and well-logged. The filter diagnostics block (line 1432-1448) gives excellent visibility.

2. **Debate engine anti-sycophancy measures** (`multi_brain.py:491-502, 1207-1211`): The R2 discipline block, ±10 confidence clamp on held verdicts, and zero-engagement confidence freeze are genuinely effective at preventing AI models from simply agreeing. The `sanitize_for_debate()` function (line 521-533) which strips scores/verdicts before showing to peers prevents anchoring.

3. **Model name normalization** (`multi_brain.py:377-428`): `MODEL_ALIASES` and `resolve_model()` handle stale DB entries, renamed models, and provider-specific quirks. The Groq max_tokens increase from 8192 to 16384 (line 175) prevents Pass 3 JSON truncation.

4. **Competition BLUE_OCEAN correction** (`competition.py:226-297` + `validate_idea.py:1877-1888`): Three-layer protection against false BLUE_OCEAN classifications is thorough.

5. **Source classification normalization** (`validate_idea.py:1255-1280`): Handles all observed source variants correctly. The `known_reddit_sources` set + prefix checks + subreddit fallback cover all edge cases.

6. **Data quality check system** (`validate_idea.py:942-1125`): Comprehensive contradiction detection (WTP mismatch, conversion fantasy, pain-vs-price contradiction, market timing). The proportion-based platform imbalance check (line 973-975) is better than simple platform count.

7. **Smart sampling strategy** (`validate_idea.py:1138-1191`): The 4-bucket approach (top engagement + recent + random + outliers) ensures signal diversity. The outlier bucket (low score, high comments = hidden pain) is particularly clever.

8. **Batch summarization** (`validate_idea.py:1470-1553`): Running ALL filtered posts through parallel AI batches ensures 100% coverage of signal. The merged signal block (pain quotes, WTP signals, competitor mentions) with deduplication is well-designed.

9. **JSON repair for truncated model output** (`multi_brain.py:804-825`): Handles the common case where Groq/other models truncate mid-JSON by closing unclosed brackets/braces.

10. **Verdict source tracking** (`validate_idea.py:2027-2034`): Explicitly marking whether the verdict came from real debate vs fallback exception, and surfacing this in the UI warnings, prevents users from trusting fake fallback results.
