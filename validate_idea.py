"""
RedditPulse — Idea Validator (Multi-Brain Edition)
3-Phase Pipeline using AIBrain debate engine:
  Phase 1: AI Decomposition (idea → keywords, competitors, audience, pain)
  Phase 2: Market Scraping (keywords → Reddit + HN posts)
  Phase 3: AI Synthesis via Multi-Model Debate (posts + idea → verdict + report)
"""

import os
import sys
import json
import time
import re
import argparse
import traceback
import requests

# Add engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "engine"))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from keyword_scraper import run_keyword_scan, discover_subreddits
from multi_brain import AIBrain, get_user_ai_configs, extract_json
from validation_depth import get_depth_config, log_depth_config

# ── Scraper imports (graceful fallback if any missing) ──
try:
    from hn_scraper import run_hn_scrape
    HN_AVAILABLE = True
except ImportError:
    HN_AVAILABLE = False

try:
    from ph_scraper import run_ph_scrape
    PH_AVAILABLE = True
except ImportError:
    PH_AVAILABLE = False

try:
    from ih_scraper import run_ih_scrape
    IH_AVAILABLE = True
except ImportError:
    IH_AVAILABLE = False

try:
    from stackoverflow_scraper import scrape_stackoverflow
    SO_AVAILABLE = True
except ImportError:
    SO_AVAILABLE = False

try:
    from github_issues_scraper import scrape_github_issues
    GH_ISSUES_AVAILABLE = True
except ImportError:
    GH_ISSUES_AVAILABLE = False

# ── Intelligence imports ──
try:
    from trends import analyze_keywords, trend_summary_for_report
    TRENDS_AVAILABLE = True
except ImportError:
    TRENDS_AVAILABLE = False

try:
    from competition import analyze_competition, competition_prompt_section, competition_summary
    COMPETITION_AVAILABLE = True
except ImportError:
    COMPETITION_AVAILABLE = False

try:
    from icp import build_icp
    ICP_AVAILABLE = True
except ImportError:
    ICP_AVAILABLE = False

# ── Retention + Intelligence imports ──
try:
    from pain_stream import create_alert as create_pain_alert
    PAIN_STREAM_AVAILABLE = True
except ImportError:
    PAIN_STREAM_AVAILABLE = False

try:
    from competitor_deathwatch import scan_for_complaints, save_complaints
    DEATHWATCH_AVAILABLE = True
except ImportError:
    DEATHWATCH_AVAILABLE = False

# ── Supabase config ──
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_KEY", ""))


class ValidationPersistenceError(RuntimeError):
    """Raised when validation state cannot be persisted to Supabase."""


def _supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def update_validation(validation_id, updates, retries=3):
    """Update idea_validations row in Supabase. Retries on transient network errors.
    
    ECONNRESET mid-run was leaving status stuck at 'queued' in Supabase,
    causing the frontend poller to always see phase=0 and show 'Starting'.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValidationPersistenceError("Supabase is not configured for validation state updates")

    url = f"{SUPABASE_URL}/rest/v1/idea_validations?id=eq.{validation_id}"
    last_err = None
    for attempt in range(retries):
        try:
            r = requests.patch(url, json=updates, headers=_supabase_headers(), timeout=15)
            if r.status_code < 400:
                return True
            last_err = ValidationPersistenceError(
                f"Supabase update error {r.status_code}: {r.text[:200]}"
            )
            print(f"  [!] {last_err}")
        except Exception as e:
            last_err = e
        if attempt < retries - 1:
            wait = 2 ** attempt  # 1s, 2s backoff
            print(f"  [!] Supabase update failed (attempt {attempt+1}/{retries}), retrying in {wait}s: {last_err}")
            time.sleep(wait)

    print(f"  [!] Supabase update gave up after {retries} attempts: {last_err}")
    raise ValidationPersistenceError(str(last_err))


# ═══════════════════════════════════════════════════════
# PHASE 1: AI DECOMPOSITION
# ═══════════════════════════════════════════════════════

DECOMPOSE_SYSTEM = """You are a startup market research expert. Given a startup idea description, extract the essential components needed to validate it through market research.

Return ONLY valid JSON with this exact structure:
{
  "keywords": ["keyword1", "keyword2", ...],
  "colloquial_keywords": ["buyer complaint phrase 1", "buyer complaint phrase 2", ...],
  "subreddits": ["primary niche sub", "secondary sub", ...],
  "competitors": ["Competitor1", "Competitor2", ...],
  "audience": "Description of target audience",
  "pain_hypothesis": "The core pain point this solves",
  "search_queries": ["reddit search query 1", "reddit search query 2", ...]
}

RULES:
KEYWORD RULES:
Generate two keyword categories:

1. "keywords" — formal/SEO terms used on ProductHunt, HN, IndieHackers, job boards
   Example: "email management automation", "accounting workflow tools"

2. "colloquial_keywords" — the exact phrases a buyer would use when complaining
   on Reddit, Slack, or in a forum. Think frustration language, not product language.
   Example: "drowning in client emails", "inbox completely out of control",
            "too many emails from clients", "can't keep up with accounting emails"

- keywords MUST be SHORT (1-3 words max). Reddit search works best with short phrases.
  GOOD keywords: "code review", "PR review", "pull request", "code quality", "code linting"
  BAD keywords: "AI-powered code review tool for small teams", "automated pull request review system"
- Generate 8-12 short keywords covering: the pain, the solution category, and adjacent tool names
- Include both specific tool names and SHORT pain phrases ("slow reviews", "code bugs", "manual testing")
- Generate 4-8 colloquial complaint phrases. Make them buyer-native and emotionally real.
- Competitors should be existing tools that partially solve this problem (include 5-8)
- search_queries can be slightly longer (3-6 words) for targeted Reddit searches
- colloquial_keywords are Reddit-only complaint-language inputs
- subreddits must include the PRIMARY niche subreddit for the ICP even if keyword match is low
- For any non-developer B2B idea, include at minimum the 2 subreddits where the ICP actually posts and complains
- Example: for "AI inbox copilot for accounting firms" -> MUST include "accounting" and "bookkeeping"
- Keep all strings concise and search-engine friendly
"""


def phase1_decompose(idea_text, brain, validation_id, depth_config=None):
    """Phase 1: Extract keywords, competitors, audience from idea text."""
    if depth_config is None:
        depth_config = get_depth_config("quick")
    print("\n  ══ PHASE 1: AI Decomposition ══")
    update_validation(validation_id, {"status": "decomposing"})

    prompt = f"""Analyze this startup idea and extract the key components for market validation:

IDEA: {idea_text}

Extract keywords people would search for when experiencing this pain, list existing competitors, identify the target audience, and state the core pain hypothesis."""

    # Use single call for decomposition (no debate needed here)
    raw = brain.single_call(prompt, DECOMPOSE_SYSTEM)
    data = extract_json(raw)

    def _dedupe(items):
        seen = set()
        deduped = []
        for item in items:
            normalized = str(item).strip()
            key = normalized.lower()
            if normalized and key not in seen:
                seen.add(key)
                deduped.append(normalized)
        return deduped

    formal_cap = depth_config.get("formal_keyword_cap", 15)
    colloquial_cap = depth_config.get("colloquial_keyword_cap", 10)
    sub_cap = depth_config.get("subreddit_cap", 8)
    formal_keywords = _dedupe(data.get("keywords", []) + data.get("search_queries", []))[:formal_cap]
    colloquial_keywords = _dedupe(data.get("colloquial_keywords", []))[:colloquial_cap]
    if not colloquial_keywords:
        colloquial_keywords = formal_keywords[:5]
    subreddits = _dedupe(data.get("subreddits", []))[:sub_cap]

    result = {
        "keywords": formal_keywords,
        "colloquial_keywords": colloquial_keywords,
        "subreddits": subreddits,
        "competitors": data.get("competitors", []),
        "audience": data.get("audience", ""),
        "pain_hypothesis": data.get("pain_hypothesis", ""),
    }

    update_validation(validation_id, {
        "status": "decomposed",
        "extracted_keywords": result["keywords"],
        "extracted_competitors": result["competitors"],
        "extracted_audience": result["audience"],
        "pain_hypothesis": result["pain_hypothesis"],
    })

    print(f"  [✓] Keywords: {result['keywords']}")
    print(f"  [✓] Colloquial Keywords: {result['colloquial_keywords']}")
    print(f"  [✓] Target Subreddits: {result['subreddits']}")
    print(f"  [✓] Competitors: {result['competitors']}")
    print(f"  [✓] Audience: {result['audience']}")
    return result


# ═══════════════════════════════════════════════════════
# SIGNAL WEIGHTING (platform authority × score × recency)
# ═══════════════════════════════════════════════════════

PLATFORM_WEIGHTS = {
    "reddit": 1.0,
    "hackernews": 1.5,     # Higher-quality technical audience
    "producthunt": 1.3,    # Launch signals, maker audience
    "indiehackers": 1.2,   # Revenue-focused founders
    "stackoverflow": 1.2,  # Technical pain with implementation context
    "githubissues": 1.15,  # Open-source issue demand / friction signals
}

NON_DEV_ICP_KEYWORDS = [
    "accounting", "bookkeeping", "legal", "law firm", "medical", "healthcare",
    "restaurant", "retail", "small business", "firm", "agency", "clinic",
    "dentist", "real estate", "hr", "human resources", "finance",
]


def _compute_weighted_score(post):
    """Weight posts by platform authority × score × recency decay."""
    raw_score = max(post.get("score", 0), 1)
    platform = post.get("source", "reddit").lower()
    platform_w = PLATFORM_WEIGHTS.get(platform, 1.0)

    # Recency decay: last 7 days = 1.0x, 30 days = 0.7x, older = 0.4x
    from datetime import datetime, timezone
    post_date = post.get("created_utc", 0)
    age_days = 30  # default

    if post_date:
        try:
            if isinstance(post_date, str):
                # Handle ISO string from keyword_scraper ("2024-03-15T12:00:00Z")
                dt = datetime.fromisoformat(post_date.replace("Z", "+00:00"))
                age_days = (datetime.now(timezone.utc) - dt).days
            elif isinstance(post_date, (int, float)) and post_date > 0:
                # Handle Unix timestamp (from HN/PH/IH scrapers)
                dt = datetime.fromtimestamp(post_date, tz=timezone.utc)
                age_days = (datetime.now(timezone.utc) - dt).days
        except (OSError, ValueError, TypeError):
            age_days = 30

    recency = 1.0 if age_days <= 7 else (0.7 if age_days <= 30 else 0.4)

    return round(raw_score * platform_w * recency, 1)


def _platform_warning(platform: str, health: dict, posts_count: int) -> dict | None:
    status = str((health or {}).get("status") or "ok")
    error_code = (health or {}).get("error_code")
    error_detail = (health or {}).get("error_detail")

    if status == "ok" and posts_count > 0:
        return None

    platform_label = {
        "producthunt": "ProductHunt",
        "indiehackers": "IndieHackers",
        "hackernews": "Hacker News",
        "reddit": "Reddit",
        "stackoverflow": "Stack Overflow",
        "githubissues": "GitHub Issues",
    }.get(platform, platform.title())

    if platform == "producthunt" and error_code == "graphql_auth_failed" and posts_count == 0:
        issue = "ProductHunt: currently unavailable - known auth limitation."
    elif platform == "producthunt" and error_code == "graphql_auth_failed":
        issue = "ProductHunt: API auth unavailable - limited to fallback results. Coverage may be reduced."
    elif platform == "producthunt" and status == "degraded":
        issue = error_detail or "ProductHunt: limited to fallback results. Coverage may be reduced."
    elif platform == "indiehackers" and error_code == "algolia_auth_failed":
        issue = "IndieHackers: search auth unavailable - fallback coverage may be reduced."
    elif platform == "indiehackers" and status == "degraded":
        issue = error_detail or "IndieHackers: fallback coverage may be reduced."
    elif platform == "indiehackers" and posts_count == 0:
        issue = "IndieHackers: 0 results found. This niche may have low IH community presence, or search may be temporarily unavailable."
    elif platform == "hackernews" and (health or {}).get("dominant_pct"):
        issue = (
            f"Signal is {health['dominant_pct']:.0f}% from Hacker News - audience may skew developer. "
            "Buyer-native sources returned limited results."
        )
    elif posts_count == 0:
        issue = f"{platform_label}: 0 results found. Coverage may be reduced for this run."
    else:
        issue = f"{platform_label}: limited coverage"

    return {
        "platform": platform,
        "status": status,
        "error_code": error_code,
        "error_detail": error_detail,
        "posts": posts_count,
        "issue": issue,
    }


def _normalize_platform_warnings(platform_warnings: list[dict]) -> list[dict]:
    normalized = []
    for warning in platform_warnings or []:
        item = dict(warning)
        platform = str(item.get("platform", "")).lower()
        issue = str(item.get("issue", ""))
        error_code = item.get("error_code")
        posts = int(item.get("posts", 0) or 0)

        if platform == "producthunt" and error_code == "graphql_auth_failed" and posts == 0:
            item["issue"] = "ProductHunt: currently unavailable - known auth limitation."
        elif platform == "producthunt" and error_code == "graphql_auth_failed":
            item["issue"] = "ProductHunt: API auth unavailable - limited to fallback results. Coverage may be reduced."
        elif platform == "producthunt" and posts == 0:
            item["issue"] = issue or "ProductHunt: currently unavailable - known auth limitation."
        elif platform == "indiehackers" and posts == 0 and "0 posts" in issue:
            item["issue"] = (
                "IndieHackers: 0 results found. This niche may have low IH community presence, "
                "or search may be temporarily unavailable."
            )
        elif platform == "hackernews" and "0 posts" in issue:
            item["issue"] = "Hacker News: 0 results found. Formal keywords may not match HN discourse for this niche."
        elif platform == "reddit" and "0 posts" in issue:
            item["issue"] = (
                "Reddit: 0 results found. Buyer-language coverage may be too niche or Reddit may have rate-limited this run."
            )

        normalized.append(item)
    return normalized


def _is_audience_platform_mismatch(idea_text: str, dominant_platform: str, dominant_pct: float) -> bool:
    if dominant_pct < 0.70:
        return False
    idea_text_l = (idea_text or "").lower()
    is_non_dev = any(kw in idea_text_l for kw in NON_DEV_ICP_KEYWORDS)
    return is_non_dev and dominant_platform == "hackernews"


# ═══════════════════════════════════════════════════════
# PHASE 2: MARKET SCRAPING
# ═══════════════════════════════════════════════════════

def phase2_scrape(formal_keywords, colloquial_keywords, required_subreddits, validation_id, depth_config=None):
    """Phase 2: Scrape ALL platforms for market signals."""
    if depth_config is None:
        depth_config = get_depth_config("quick")
    print("\n  ══ PHASE 2: Market Scraping (All Platforms) ══")
    update_validation(validation_id, {"status": "scraping", "posts_found": 0})

    def on_progress(count, msg):
        update_validation(validation_id, {"posts_found": count, "status": "scraping"})

    hn_kw_budget = depth_config.get("hn_keyword_budget", 8)
    ph_kw_budget = depth_config.get("ph_keyword_budget", 8)
    ih_kw_budget = depth_config.get("ih_keyword_budget", 8)
    so_kw_budget = depth_config.get("so_keyword_budget", 3)
    gh_kw_budget = depth_config.get("gh_keyword_budget", 3)
    reddit_coll = depth_config.get("reddit_colloquial_budget", 4)
    reddit_form = depth_config.get("reddit_formal_budget", 4)
    reddit_duration = depth_config.get("reddit_duration", "10min")
    reddit_min_matches = depth_config.get("reddit_min_keyword_matches", 1)

    scrape_keywords = formal_keywords[:max(hn_kw_budget, ph_kw_budget, ih_kw_budget)]
    reddit_keywords = []
    for kw in list(colloquial_keywords[:reddit_coll]) + list(formal_keywords[:reddit_form]):
        clean = str(kw).strip()
        if clean and clean.lower() not in {item.lower() for item in reddit_keywords}:
            reddit_keywords.append(clean)
    if not reddit_keywords:
        reddit_keywords = scrape_keywords[:8]
    required_subreddits = [
        str(sub).strip().replace("r/", "").replace("/r/", "")
        for sub in (required_subreddits or [])
        if str(sub).strip()
    ]
    source_counts = {}
    platform_warnings = []  # Track platforms that returned 0 results or were unavailable

    print(f"  [REDDIT]  colloquial_keywords: {reddit_keywords}")
    print(f"  [HN]      formal keywords: {scrape_keywords}")
    print(f"  [PH]      formal keywords: {scrape_keywords}")
    print(f"  [IH]      formal keywords: {scrape_keywords}")
    print(f"  [SO]      formal keywords: {scrape_keywords[:3]}")
    print(f"  [GH]      formal keywords: {scrape_keywords[:3]}")

    # ── Reddit ──
    print(f"  [>] Scraping Reddit for: {reddit_keywords} (lookback={reddit_duration})")
    reddit_posts = run_keyword_scan(
        reddit_keywords,
        duration=reddit_duration,
        on_progress=on_progress,
        forced_subreddits=required_subreddits,
        min_keyword_matches=reddit_min_matches,
    )
    source_counts["reddit"] = len(reddit_posts)
    print(f"  [✓] Reddit: {len(reddit_posts)} posts")
    if len(reddit_posts) == 0:
        platform_warnings.append({"platform": "reddit", "issue": "0 posts returned — Reddit scraping may have been rate-limited or keywords too niche"})

    # ── Hacker News ──
    hn_posts = []
    if HN_AVAILABLE:
        print("  [>] Scraping Hacker News...")
        try:
            hn_posts = run_hn_scrape(scrape_keywords[:hn_kw_budget], max_pages=depth_config.get("hn_max_pages", 2))
            source_counts["hackernews"] = len(hn_posts)
            print(f"  [✓] HN: {len(hn_posts)} posts")
            if len(hn_posts) == 0:
                platform_warnings.append({"platform": "hackernews", "issue": "0 posts returned — keywords may not match HN discourse"})
        except Exception as e:
            print(f"  [!] HN scrape failed: {e}")
            platform_warnings.append({"platform": "hackernews", "issue": f"Scrape failed: {str(e)[:100]}"})
    else:
        platform_warnings.append({"platform": "hackernews", "issue": "Scraper not available (hn_scraper module missing)"})

    # ── ProductHunt ──
    ph_posts = []
    if PH_AVAILABLE:
        print("  [>] Scraping ProductHunt...")
        try:
            ph_result = run_ph_scrape(scrape_keywords[:ph_kw_budget], max_pages=depth_config.get("ph_max_pages", 2), return_health=True)
            ph_posts = ph_result.get("posts", [])
            source_counts["producthunt"] = len(ph_posts)
            print(f"  [✓] ProductHunt: {len(ph_posts)} posts")
            warning = _platform_warning("producthunt", ph_result, len(ph_posts))
            if warning:
                platform_warnings.append(warning)
        except Exception as e:
            print(f"  [!] ProductHunt scrape failed: {e}")
            platform_warnings.append({
                "platform": "producthunt",
                "status": "failed",
                "error_code": "scraper_exception",
                "error_detail": str(e)[:100],
                "posts": 0,
                "issue": f"ProductHunt: scrape error ({str(e)[:100]}) - data from Reddit + HN only",
            })
    else:
        platform_warnings.append({
            "platform": "producthunt",
            "status": "failed",
            "error_code": "scraper_missing",
            "error_detail": "ph_scraper module missing",
            "posts": 0,
            "issue": "ProductHunt: scraper not available - data from Reddit + HN only",
        })

    # ── IndieHackers ──
    ih_posts = []
    if IH_AVAILABLE:
        print("  [>] Scraping IndieHackers...")
        try:
            ih_result = run_ih_scrape(scrape_keywords[:ih_kw_budget], max_pages=depth_config.get("ih_max_pages", 2), return_health=True)
            ih_posts = ih_result.get("posts", [])
            source_counts["indiehackers"] = len(ih_posts)
            print(f"  [✓] IndieHackers: {len(ih_posts)} posts")
            warning = _platform_warning("indiehackers", ih_result, len(ih_posts))
            if warning:
                platform_warnings.append(warning)
        except Exception as e:
            print(f"  [!] IndieHackers scrape failed: {e}")
            platform_warnings.append({
                "platform": "indiehackers",
                "status": "failed",
                "error_code": "scraper_exception",
                "error_detail": str(e)[:100],
                "posts": 0,
                "issue": f"IndieHackers: scrape error ({str(e)[:100]}) - data from Reddit + HN only",
            })
    else:
        platform_warnings.append({
            "platform": "indiehackers",
            "status": "failed",
            "error_code": "scraper_missing",
            "error_detail": "ih_scraper module missing",
            "posts": 0,
            "issue": "IndieHackers: scraper not available - data from Reddit + HN only",
        })

    # ── Merge + deduplicate + WEIGHT ──
    so_posts = []
    if SO_AVAILABLE:
        print("  [>] Scraping Stack Overflow...")
        try:
            so_posts = scrape_stackoverflow(
                scrape_keywords[:so_kw_budget],
                max_keywords=so_kw_budget,
                time_budget=depth_config.get("so_time_budget", 30),
                pages=depth_config.get("so_pages", 1),
            )
            source_counts["stackoverflow"] = len(so_posts)
            print(f"  [OK] Stack Overflow: {len(so_posts)} posts")
            if len(so_posts) == 0:
                platform_warnings.append({
                    "platform": "stackoverflow",
                    "issue": "Stack Overflow: 0 results found. This problem may not surface as implementation pain there.",
                })
        except Exception as e:
            print(f"  [!] Stack Overflow scrape failed: {e}")
            platform_warnings.append({
                "platform": "stackoverflow",
                "issue": f"Stack Overflow: scrape failed ({str(e)[:100]}). Coverage may be reduced.",
            })
    else:
        platform_warnings.append({
            "platform": "stackoverflow",
            "issue": "Stack Overflow: scraper not available. Coverage may be reduced.",
        })

    gh_posts = []
    if GH_ISSUES_AVAILABLE:
        print("  [>] Scraping GitHub Issues...")
        try:
            gh_posts = scrape_github_issues(
                scrape_keywords[:gh_kw_budget],
                max_keywords=gh_kw_budget,
                time_budget=depth_config.get("gh_time_budget", 30),
                pages=depth_config.get("gh_pages", 1),
            )
            source_counts["githubissues"] = len(gh_posts)
            print(f"  [OK] GitHub Issues: {len(gh_posts)} posts")
            if len(gh_posts) == 0:
                platform_warnings.append({
                    "platform": "githubissues",
                    "issue": "GitHub Issues: 0 results found. This niche may not map cleanly to open-source issue traffic.",
                })
        except Exception as e:
            print(f"  [!] GitHub Issues scrape failed: {e}")
            platform_warnings.append({
                "platform": "githubissues",
                "issue": f"GitHub Issues: scrape failed ({str(e)[:100]}). Coverage may be reduced.",
            })
    else:
        platform_warnings.append({
            "platform": "githubissues",
            "issue": "GitHub Issues: scraper not available. Coverage may be reduced.",
        })

    all_posts = reddit_posts + hn_posts + ph_posts + ih_posts + so_posts + gh_posts

    # Apply signal weighting before dedup
    for p in all_posts:
        p["weighted_score"] = _compute_weighted_score(p)

    seen_post_keys = set()
    unique_posts = []
    for p in all_posts:
        source_key = str(p.get("source") or p.get("subreddit") or "unknown").lower().strip()
        external_id = str(p.get("external_id") or "").strip()
        canonical_url = str(
            p.get("permalink")
            or p.get("url")
            or p.get("post_url")
            or ""
        ).strip().lower()
        title_key = p.get("title", "").lower().strip()[:200]

        if external_id:
            dedupe_key = ("external_id", source_key, external_id)
        elif canonical_url:
            dedupe_key = ("url", source_key, canonical_url[:500])
        elif title_key:
            dedupe_key = ("title", source_key, title_key)
        else:
            dedupe_key = None

        if dedupe_key and dedupe_key not in seen_post_keys:
            seen_post_keys.add(dedupe_key)
            unique_posts.append(p)

    # Sort by weighted score — AI sees highest-signal posts first
    unique_posts.sort(key=lambda p: p.get("weighted_score", 0), reverse=True)

    platforms_used = len([k for k, v in source_counts.items() if v > 0])
    platform_warnings = _normalize_platform_warnings(platform_warnings)
    update_validation(validation_id, {
        "status": "scraped",
        "posts_found": len(unique_posts),
    })

    # ── Log warnings ──
    if platform_warnings:
        print(f"  [⚠] Platform warnings ({len(platform_warnings)}):")
        for w in platform_warnings:
            print(f"       {w['platform']}: {w['issue']}")

    print(f"  [✓] Total unique posts: {len(unique_posts)} from {platforms_used} platforms")
    print(f"  [✓] Sources: {source_counts}")
    return unique_posts, source_counts, platform_warnings


def phase2b_intelligence(
    keywords,
    validation_id,
    idea_text="",
    known_competitors=None,
    complaint_count=0,
    complaint_competitors=None,
):
    """Phase 2b: Google Trends + Competition Analysis."""
    intel = {"trends": None, "competition": None, "trend_prompt": "", "comp_prompt": ""}

    # ── Google Trends ──
    if TRENDS_AVAILABLE:
        print("\n  ══ PHASE 2b: Google Trends Analysis ══")
        update_validation(validation_id, {"status": "analyzing_trends"})
        try:
            trend_keywords = keywords[:5]  # Top 5 keywords for trends
            trend_results = analyze_keywords(trend_keywords)
            trend_report = trend_summary_for_report(trend_results)
            intel["trends"] = trend_report

            # Build prompt section
            growing = [k for k, v in trend_results.items() if v.tier in ("EXPLODING", "GROWING")]
            declining = [k for k, v in trend_results.items() if v.tier in ("DECLINING", "DEAD")]
            stable = [k for k, v in trend_results.items() if v.tier == "STABLE"]

            lines = ["\n--- GOOGLE TRENDS DATA ---"]
            for kw, r in trend_results.items():
                lines.append(f"  {kw}: {r.tier} ({r.change_pct:+.0f}% change, current interest: {r.current_interest})")
            if growing:
                lines.append(f"  Growing keywords: {', '.join(growing)}")
            if declining:
                lines.append(f"  Declining keywords: {', '.join(declining)}")
            intel["trend_prompt"] = "\n".join(lines)

            print(f"  [✓] Trends: {len(trend_results)} keywords analyzed")
            print(f"      Growing: {growing}, Declining: {declining}, Stable: {stable}")
        except Exception as e:
            print(f"  [!] Trends analysis failed: {e}")
    else:
        print("  [!] Trends module not available (install pytrends: pip install pytrends)")

    # ── Competition Analysis ──
    if COMPETITION_AVAILABLE:
        print("\n  ══ PHASE 2c: Competition Analysis ══")
        update_validation(validation_id, {"status": "analyzing_competition"})
        try:
            from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
            comp_keywords = keywords[:3]  # Top 3 for competition
            # Hard 90s timeout - prevents stuck validation if search engines hang
            # NOTE: Do NOT use 'with' context manager — its __exit__ calls shutdown(wait=True)
            # which blocks until the hung thread finishes, defeating the timeout.
            pool = ThreadPoolExecutor(max_workers=1)
            future = pool.submit(
                analyze_competition,
                comp_keywords,
                idea_text=idea_text,
                known_competitors=known_competitors,
                complaint_count=complaint_count,
                complaint_competitors=complaint_competitors,
            )
            try:
                comp_results = future.result(timeout=90)
            except FuturesTimeout:
                print("  [!] Competition analysis timed out after 90s - continuing without it")
                comp_results = {}
            finally:
                pool.shutdown(wait=False, cancel_futures=True)
            comp_report = competition_summary(comp_results)
            intel["competition"] = comp_report
            intel["comp_prompt"] = competition_prompt_section(comp_results, idea_text=idea_text)
            print(f"  [✓] Competition: {len(comp_results)} keywords analyzed")
            for kw, r in comp_results.items():
                print(f"      {kw}: {r.tier} ({r.details})")
            if comp_report.get("corrections"):
                print(f"      Competition corrections: {comp_report['corrections']}")
        except Exception as e:
            print(f"  [!] Competition analysis failed: {e}")

    return intel


# ═══════════════════════════════════════════════════════
# PHASE 3: MULTI-PASS AI SYNTHESIS (3 focused passes + debate verdict)
# ═══════════════════════════════════════════════════════
#
# WHY 3 PASSES: Groq Llama caps at 8192 output tokens. A single prompt
# requesting 12 sections runs out of space. Each pass focuses on 3-4
# sections and stays well under the limit. The FINAL VERDICT uses the
# debate engine so all models weigh in.

PASS1_SYSTEM = """You are a market research analyst. Given scraped posts from Reddit, Hacker News, ProductHunt, and IndieHackers, analyze the MARKET signal.

Return ONLY valid JSON:
{
  "pain_validated": true/false,
  "pain_description": "The EXACT pain people are expressing. Quote specific phrases from posts.",
  "pain_frequency": "daily/weekly/monthly — how often this complaint appears",
  "pain_intensity": "LOW/MEDIUM/HIGH — based on frustration language, urgency words",
  "willingness_to_pay": "SPECIFIC price signals. Quote exact statements like 'I'd pay $X'. If none found, say 'No explicit WTP signals found'",
  "market_timing": "GROWING/STABLE/DECLINING — reference the trend data if available",
  "tam_estimate": "Total Addressable Market rough estimate with reasoning",
  "evidence": [
    {"post_title": "Exact post title from the data", "source": "reddit/hn/ph/ih", "score": 123, "what_it_proves": "Specific insight this post provides"},
    {"post_title": "Another exact title", "source": "reddit/hn/ph/ih", "score": 456, "what_it_proves": "Another insight"}
  ]
}

RULES:
- Include AT LEAST 15 evidence posts. More is better. Quote exact titles from the scraped data.
- NEVER invent post titles. Only cite what appears in the data.
- For WTP, search for dollar amounts, "I'd pay", "take my money", "shut up and take", pricing discussions.
- Be specific with TAM — reference subreddit subscriber counts, post frequency, industry size.
"""

PASS2_SYSTEM = """You are a startup strategist. Given the market analysis results and competition data, design the STRATEGY.

Return ONLY valid JSON:
{
  "ideal_customer_profile": {
    "primary_persona": "WHO exactly — SPECIFIC person: job title + company size + number of side projects attempted + current revenue range + specific pain scenario from actual post evidence. BAD: 'Indie hacker who codes at nights'. GOOD: 'Ex-FAANG engineer turned solo founder, 2-3 failed MVPs in 18 months, currently at $0-500 MRR, posts roast-my-idea threads on r/SaaS every 6 weeks'",
    "demographics": "Age range, income level, tech savviness, geographic focus (EVIDENCE-BASED from posts, default: Global remote-first)",
    "psychographics": "Motivations, frustrations, values, buying behavior — derived from post language",
    "specific_communities": [
      {"name": "r/SaaS", "subscribers": "220,000", "relevance": "PRIMARY — direct ICP"},
      {"name": "Hacker News Show HN", "monthly_active": "5M+", "relevance": "HIGH — technical founders"}
    ],
    "influencers_they_follow": [
      "Creator Name (@handle) — follower count, why relevant"
    ],
    "tools_they_already_use": [
      "Tool Name ($price/mo) — what they use it for"
    ],
    "buying_objections": [
      "Specific objection from post evidence — what STOPS them from buying"
    ],
    "previous_solutions_tried": [
      "What they used BEFORE — and why it failed them"
    ],
    "day_in_the_life": "One specific paragraph describing their workflow when they encounter this pain. Include time of day, specific actions, specific frustrations. Make it feel like you watched them over their shoulder.",
    "willingness_to_pay_evidence": [
      "Direct quote showing WTP — 'quote' — [source, score]. If none found: 'No explicit WTP quotes found — inferred from competitor pricing: $X-Y/mo'"
    ],
    "budget_range": "$X-$Y per month — based on evidence",
    "buying_triggers": ["Event that makes them search for a solution", "Trigger 2", "Trigger 3"]
  },
  "competition_landscape": {
    "direct_competitors": [
      {
        "name": "Tool name",
        "price": "$X/mo",
        "users": "estimated user count or 'unknown'",
        "founded": "year or 'unknown'",
        "funding": "$X raised or 'bootstrapped' or 'unknown'",
        "weakness": "Specific technical/product weakness",
        "user_complaints": "What their users complain about most — from actual reviews/posts",
        "switching_trigger": "What makes their users switch — specific event or frustration",
        "your_attack_angle": "HOW TO WIN against this competitor — specific positioning strategy",
        "threat_level": "HIGH/MEDIUM/LOW"
      }
    ],
    "indirect_competitors": ["Tool 1 — and why it's indirect", "Tool 2"],
    "market_saturation": "EMPTY/LOW/MEDIUM/HIGH/SATURATED",
    "biggest_threat": "Competitor name — because reason (most dangerous competitor)",
    "easiest_win": "Competitor name — because their weakness (easiest to steal users from)",
    "your_unfair_advantage": "The specific gap NO competitor fills. Be concrete.",
    "moat_strategy": "How to build a defensible competitive advantage over 12 months"
  },
  "pricing_strategy": {
    "recommended_model": "freemium/subscription/one-time/usage-based",
    "tiers": [
      {"name": "Free", "price": "$0", "features": ["Feature 1", "Feature 2"], "purpose": "Acquisition hook"},
      {"name": "Pro", "price": "$X/mo", "features": ["Feature 1", "Feature 2"], "purpose": "Core revenue"},
      {"name": "Team/Enterprise", "price": "$X/mo", "features": ["Feature 1", "Feature 2"], "purpose": "Expansion revenue"}
    ],
    "reasoning": "Why this pricing based on competitor pricing and WTP signals"
  },
  "monetization_channels": [
    {"channel": "Primary revenue method", "description": "Exactly how it works", "timeline": "When revenue starts"},
    {"channel": "Secondary method", "description": "How it works", "timeline": "When"},
    {"channel": "Tertiary method", "description": "How it works", "timeline": "When"}
  ]
}

ICP RULES — NON-NEGOTIABLE:
- Every ICP field must be EVIDENCE-BASED from the scraped posts. Never invent demographics.
- specific_communities: List EXACT subreddits/forums with real subscriber counts.
- influencers_they_follow: Name SPECIFIC creators with follower counts.
- buying_objections: What STOPS them from buying — from actual post language.
- day_in_the_life: Must read like you watched them. Include time of day, specific tools, specific frustrations.
- FORBIDDEN in primary_persona: "who codes at night", "passionate about", "tech-savvy professional". Be SPECIFIC.
- Geographic focus must be EVIDENCE-BASED. Default: "Global (remote-first)". NEVER hallucinate regions.

COMPETITION RULES — NON-NEGOTIABLE:
- Reference SPECIFIC competitor names, prices, and weaknesses from the data.
- user_complaints: Quote or paraphrase REAL complaints from posts/reviews.
- your_attack_angle: Must be a specific strategy, not "build better product".
- threat_level: HIGH = direct overlap + large user base. MEDIUM = partial overlap. LOW = tangential.
- Pricing tiers must have concrete dollar amounts, not placeholders.
- Moat strategy must be actionable, not generic "build a great product".
"""

PASS3_SYSTEM = """You are a startup launch advisor. Given the market analysis and strategy, create the ACTION PLAN.

Return ONLY valid JSON:
{
  "launch_roadmap": [
    {
      "week": "Week 1-2",
      "title": "Action verb + specific outcome — NOT generic like 'Alpha Launch'",
      "tasks": ["Specific task with exact channel name", "Task with exact tool name", "Task with exact number target"],
      "validation_gate": "Do NOT proceed until: [specific metric, e.g. '3 people say I'd pay $X right now']",
      "cost_estimate": "$0",
      "channel": "r/SaaS or Show HN or Product Hunt etc.",
      "expected_outcome": "50 signups or 3 paying users etc."
    }
  ],
  "revenue_projections": {
    "month_1": {"users": "X", "paying": "X", "mrr": "$X", "assumptions": "Based on..."},
    "month_3": {"users": "X", "paying": "X", "mrr": "$X", "assumptions": "Based on..."},
    "month_6": {"users": "X", "paying": "X", "mrr": "$X", "assumptions": "Based on..."},
    "month_12": {"users": "X", "paying": "X", "mrr": "$X", "assumptions": "Based on..."}
  },
  "financial_reality": {
    "break_even_users": "You need N paying users at $price to cover monthly costs of $X",
    "time_to_1k_mrr": "Estimated X months — methodology: [conversion rate] × [traffic source]",
    "time_to_10k_mrr": "Estimated X months — requires [growth channel] at [specific rate]",
    "cac_budget": "You can spend max $X to acquire each user (LTV/3 rule)",
    "gross_margin": "Estimated X% after AI inference costs ($Y per validation)"
  },
  "risk_matrix": [
    {
      "risk": "Specific risk naming a real competitor/technology/market condition",
      "severity": "HIGH/MEDIUM/LOW",
      "probability": "HIGH/MEDIUM/LOW",
      "mitigation": "Exact steps to handle it",
      "owner": "founder/engineering/marketing — who should own this risk"
    }
  ],
  "first_10_customers_strategy": {
    "customers_1_3": {
      "source": "Exact community or channel name (e.g. r/SaaS, IndieHackers)",
      "tactic": "Exact outreach method — what to post, word for word",
      "script": "Exact message template or post copy"
    },
    "customers_4_7": {
      "source": "Scaling channel name",
      "tactic": "Conversion method — how to get them from aware to paying",
      "script": "Follow-up message or demo offer template"
    },
    "customers_8_10": {
      "source": "Referral or content channel",
      "tactic": "How to leverage first customers for word-of-mouth",
      "script": "Referral ask template or content strategy"
    }
  },
  "mvp_features": ["Core feature 1 (must have for launch)", "Core feature 2", "Core feature 3", "Core feature 4"],
  "cut_features": ["Feature that seems important but wastes time pre-launch", "Another one", "Third one"]
}

LAUNCH ROADMAP RULES — NON-NEGOTIABLE:
- Every step must be specific to THIS exact idea and ICP.
- Never write generic startup advice like "gather feedback" or "invite users".
- Each step MUST have a validation_gate — a specific metric before proceeding.
- channel must name a SPECIFIC platform (r/SaaS, not "Reddit").
- tasks must include exact numbers (50 users, $29/month, 100 replies).
- tasks must name exact tools (Stripe, Vercel, Supabase — not "tech stack").
- FORBIDDEN phrases: "gather feedback", "iterate on product", "expand marketing",
  "build MVP" (replace with specific feature list), "invite users" (replace with exact source).
- The roadmap must read like advice from a $500/hour growth consultant.

REVENUE RULES:
- Revenue projections must state assumptions. NEVER use 'based on continued growth'.
- Each month must cite a SPECIFIC comparable conversion rate (e.g. 'Grammarly free-to-paid 3%').
- If no comparable exists, say 'conservative assumption — no comparable found'.
- Use CONSERVATIVE estimates unless the data explicitly shows strong WTP.

RISK MATRIX RULES (CRITICAL):
- Each risk MUST name a specific competitor, technology, or real market condition — not a category.
- BAD: 'Market competition risk' | GOOD: 'GitHub Copilot has 1.3M users at $10/mo — direct price overlap'
- FORBIDDEN phrases: 'Market competition', 'Technical debt', 'User adoption', 'unique features', 'differentiate'.
- Must include: 1 risk naming a specific named competitor, 1 platform/infra risk, 1 GTM risk.
- MINIMUM 5 risks.

FIRST 10 CUSTOMERS RULES:
- Name SPECIFIC subreddits, communities, exact outreach templates.
- Include word-for-word post copy or DM templates.

MVP FEATURES: max 4-5 features. Everything else is a cut feature.
"""

VERDICT_SYSTEM = """You are a venture analyst delivering a final verdict on a startup idea. You've been given the full analysis (market data, strategy, action plan, and scraped posts). Synthesize into a final decision.

Return ONLY valid JSON:
{
  "verdict": "BUILD IT" or "RISKY" or "DON'T BUILD",
  "confidence": 0-100,
  "executive_summary": "4-5 sentence summary. Include: post count, platforms analyzed, trend direction, competition level, key WTP signals, and your honest recommendation. Be direct and data-driven.",
  "evidence": [
    {"post_title": "Exact post title from the scraped data", "source": "reddit/hn/ph/ih", "score": 123, "what_it_proves": "Specific market signal this post reveals"},
    {"post_title": "Another exact title", "source": "reddit/hn/ph/ih", "score": 456, "what_it_proves": "Another insight from this post"}
  ],
  "risk_factors": [
    "Market risk: specific description with real data point",
    "Technical risk: specific challenge with mitigation hint",
    "Execution risk: specific bottleneck or dependency"
  ],
  "top_posts": [
    {"title": "Most important post title", "source": "platform", "score": 123, "relevance": "Why this post matters for the decision"},
    {"title": "Second post", "source": "platform", "score": 456, "relevance": "Why important"}
  ],
  "suggestions": [
    "Specific first action for the founder",
    "Second actionable suggestion"
  ]
}

RULES:
- evidence: MINIMUM 10 posts. Quote EXACT titles from the posts you were given. NEVER invent titles.
- risk_factors: MINIMUM 3 risks — at least one market risk, one technical risk, one execution risk.
- top_posts: Pick the 10-20 most impactful posts from the data. More is better.
- SCORING: "BUILD IT" = strong signal (50+ posts, multi-platform, WTP mentions, growing trends, clear gaps). "RISKY" = moderate signal (20-50 posts, few WTP, unclear differentiation, mixed trends). "DON'T BUILD" = weak signal (<20 posts, no WTP, saturated, declining trends).
- Be BRUTALLY honest. The founder wants truth that makes money, not encouragement that wastes time.
"""


# ═══════════════════════════════════════════════════════
# DATA QUALITY & CONTRADICTION DETECTION
# ═══════════════════════════════════════════════════════

def _check_data_quality(posts, source_counts, pass1, pass2, pass3,
                         platform_warnings=None, idea_text=""):
    """
    Cross-check data quality and detect contradictions between passes.
    Returns a dict with confidence_cap, contradictions list, and warnings list.
    """
    platform_warnings = platform_warnings or []
    contradictions = []
    warnings = []
    confidence_cap = 100  # Start at max, reduce based on issues
    cap_reason = "No issues detected"

    total_posts = len(posts)
    platforms_with_data = len([k for k, v in source_counts.items() if v > 0])

    # ── FIX 1: Minimum post threshold ──
    if total_posts < 5:
        confidence_cap = min(confidence_cap, 30)
        cap_reason = f"Only {total_posts} posts scraped (need 20+ for reliable analysis)"
        warnings.append(f"CRITICAL: Only {total_posts} posts found — analysis is based on extremely thin data")
    elif total_posts < 10:
        confidence_cap = min(confidence_cap, 45)
        cap_reason = f"Only {total_posts} posts scraped (need 20+ for reliable analysis)"
        warnings.append(f"LOW DATA: Only {total_posts} posts found — confidence should be significantly penalized")
    elif total_posts < 20:
        confidence_cap = min(confidence_cap, 65)
        cap_reason = f"Only {total_posts} posts scraped (need 20+ for full confidence)"
        warnings.append(f"MODERATE DATA: {total_posts} posts found — below recommended minimum of 20")

    # Fix G: proportion-based platform balance (not just count)
    # A run with 547 HN + 1 Reddit = "2 platforms" but is 94% from one source
    total_scraped = sum(source_counts.values()) if source_counts else 0
    max_platform_posts = max(source_counts.values()) if source_counts else 0
    dominance = (max_platform_posts / total_scraped) if total_scraped > 0 else 1.0
    dominant_platform = max(source_counts, key=source_counts.get) if source_counts else "unknown"

    if platforms_with_data <= 1:
        confidence_cap = min(confidence_cap, 55)
        warnings.append(f"SINGLE SOURCE: Data from only {platforms_with_data} platform — multi-platform validation required for high confidence")
        if "only 1 platform" not in cap_reason.lower():
            cap_reason += f"; only {platforms_with_data} platform used"
    elif dominance > 0.85:
        confidence_cap = min(confidence_cap, 55)
        warnings.append(
            f"PLATFORM IMBALANCE: {dominance*100:.0f}% of posts from {dominant_platform} — "
            f"effectively single-source despite {platforms_with_data} platforms reporting"
        )
        if "platform imbalance" not in cap_reason.lower():
            cap_reason += f"; {dominance*100:.0f}% from {dominant_platform} (platform imbalance)"
    elif dominance > 0.70:
        warnings.append(
            f"PLATFORM SKEW: {dominance*100:.0f}% of posts from {dominant_platform} — "
            f"results may be biased toward {dominant_platform} audience"
        )

    extra_platform_warnings = []
    if _is_audience_platform_mismatch(idea_text, dominant_platform, dominance):
        confidence_cap = max(0, confidence_cap - 10)
        mismatch_issue = (
            f"Audience mismatch: {dominance*100:.0f}% from HN but ICP is non-developer - "
            "signals may not reflect buyer pain"
        )
        warnings.append(mismatch_issue)
        extra_platform_warnings.append({
            "platform": "hackernews",
            "status": "skewed",
            "dominant_pct": round(dominance * 100, 1),
            "posts": source_counts.get("hackernews", 0),
            "issue": (
                f"Signal is {dominance*100:.0f}% from Hacker News - audience may skew developer. "
                "Buyer-native sources returned limited results."
            ),
        })

    # Log which platforms failed
    for pw in platform_warnings:
        warnings.append(f"Platform issue — {pw['platform']}: {pw['issue']}")

    # ── FIX 2: Contradiction detection ──

    # Contradiction: WTP says "no signals" but pricing gives specific dollar amounts
    wtp_text = str(pass1.get("willingness_to_pay", "")).lower()
    no_wtp_found = any(phrase in wtp_text for phrase in [
        "no explicit", "no wtp", "no signals", "not found", "no direct",
        "no mention", "no evidence", "no clear", "none found", "lacking",
    ])
    pricing = pass2.get("pricing_strategy", {})
    has_specific_pricing = bool(pricing.get("tiers")) and len(pricing.get("tiers", [])) > 1
    if no_wtp_found and has_specific_pricing:
        contradictions.append(
            "WTP MISMATCH: Market analysis found 'no WTP signals' but pricing strategy includes specific tiers/prices — "
            "pricing is theoretical, not evidence-based"
        )
        confidence_cap = min(confidence_cap, 60)

    # Contradiction: Pain not validated but verdict is BUILD IT
    pain_validated = pass1.get("pain_validated", False)
    if not pain_validated:
        warnings.append("Pain point was NOT validated by market data — all subsequent analysis builds on weak foundation")
        confidence_cap = min(confidence_cap, 50)

    # Contradiction: Pain intensity is LOW but pricing is high ($100+)
    pain_intensity = str(pass1.get("pain_intensity", "")).upper()
    tier_prices = []
    for tier in pricing.get("tiers", []):
        price_str = str(tier.get("price", ""))
        # Extract number from price string
        import re
        price_match = re.search(r'\$(\d+)', price_str)
        if price_match:
            tier_prices.append(int(price_match.group(1)))
    max_price = max(tier_prices) if tier_prices else 0
    if pain_intensity == "LOW" and max_price > 50:
        contradictions.append(
            f"PRICE vs PAIN: Pain intensity is LOW but highest priced tier is ${max_price}/mo — "
            "users rarely pay premium for low-pain solutions"
        )

    # Contradiction: Market timing is DECLINING but verdict says BUILD
    market_timing = str(pass1.get("market_timing", "")).upper()
    if "DECLINING" in market_timing or "DEAD" in market_timing:
        warnings.append(f"Market timing is {market_timing} — building in a declining market carries high risk")
        confidence_cap = min(confidence_cap, 55)

    # Contradiction: Few evidence posts cited vs claims of strong validation
    evidence_count = len(pass1.get("evidence", []))
    if evidence_count < 3:
        warnings.append(f"Only {evidence_count} evidence posts cited — insufficient for strong validation claims")
        confidence_cap = min(confidence_cap, 60)

    # Contradiction: Revenue projections assume unrealistic conversion rates
    # Fix D: normalize revenue_projections schema first — AI may use year_1/month1/etc.
    projections = pass3.get("revenue_projections", {})
    normalized_projections = {}
    for key, val in projections.items():
        if isinstance(val, dict) and any(m in key.lower() for m in ["month", "year", "quarter"]):
            normalized_projections[key] = val

    if not normalized_projections and projections:
        print(f"  [Q] CONVERSION check: no month/year keys found in projections schema {list(projections.keys())} — check skipped")
        warnings.append("CONVERSION check skipped — revenue_projections uses non-standard key schema")

    worst_conversion = {"rate": 0, "month": "", "users": 0, "paying": 0}
    for month_key, month_data in normalized_projections.items():
        if isinstance(month_data, dict):
            users_str = str(month_data.get("users", month_data.get("total_users", "0"))).replace(",", "")
            paying_str = str(month_data.get("paying", month_data.get("paying_users", month_data.get("customers", "0")))).replace(",", "")
            users_match = re.search(r'(\d+)', users_str)
            paying_match = re.search(r'(\d+)', paying_str)
            if users_match and paying_match:
                total_users = int(users_match.group(1))
                paying_users = int(paying_match.group(1))
                if total_users > 0:
                    rate = paying_users / total_users
                    if rate > worst_conversion["rate"]:
                        worst_conversion = {"rate": rate, "month": month_key, "users": total_users, "paying": paying_users}

    if worst_conversion["rate"] >= 0.10:
        contradictions.append(
            f"CONVERSION FANTASY: {worst_conversion['month']} projects {worst_conversion['rate']:.0%} conversion rate "
            f"({worst_conversion['paying']}/{worst_conversion['users']} users) — industry average is 2-5% for freemium B2B SaaS"
        )
    elif worst_conversion["rate"] >= 0.07:
        warnings.append(
            f"Optimistic conversion: {worst_conversion['month']} projects {worst_conversion['rate']:.0%} — above industry average of 2-5%"
        )

    # Competition check: if saturation is HIGH/MEDIUM but unfair advantage is vague
    comp = pass2.get("competition_landscape", {})
    saturation = str(comp.get("market_saturation", "")).upper()
    unfair_advantage = str(comp.get("your_unfair_advantage", ""))
    if saturation in ("HIGH", "MEDIUM") and len(unfair_advantage) < 50:
        warnings.append(
            f"WEAK DIFFERENTIATION: Market saturation is {saturation} but unfair advantage description "
            f"is only {len(unfair_advantage)} chars — needs concrete specifics"
        )

    return {
        "confidence_cap": confidence_cap,
        "cap_reason": cap_reason,
        "contradictions": contradictions,
        "warnings": warnings,
        "platform_warnings": extra_platform_warnings,
    }


def phase3_synthesize(idea_text, posts, decomposition, brain, validation_id,
                      source_counts=None, intel=None, depth_config=None, **kwargs):
    """Phase 3: Multi-pass synthesis — 3 focused AI passes + debate verdict."""
    print("\n  ══ PHASE 3: Multi-Pass AI Synthesis ══")
    update_validation(validation_id, {"status": "synthesizing"})

    source_counts = source_counts or {}
    intel = intel or {}

    # ── Smart Sampling: top quality + random spread + outliers + recent ──
    evidence_budget = depth_config.get("evidence_sample_budget", 100) if depth_config else 100

    def _smart_sample(all_posts: list, budget: int = evidence_budget) -> list:
        """
        Budget raised to 100 (was 50) — better coverage with same AI cost.
        Strategy (100 total):
          - Top 40 by score       → highest engagement / best signal
          - 10 most recent        → fresh market pulse
          - 35 random from rest   → prevents echo chamber bias
          - 15 outliers           → low-score but high-comment (hidden pain)
        """
        import random as _random
        import hashlib as _hashlib
        if len(all_posts) <= budget:
            return all_posts

        # Bucket 1: top 40 by weighted signal score
        sorted_by_score = sorted(
            all_posts,
            key=lambda p: p.get("weighted_score", _compute_weighted_score(p)),
            reverse=True,
        )
        top_n = min(40, budget * 4 // 10)
        top_picks = sorted_by_score[:top_n]
        top_ids = {p.get("id", "") for p in top_picks}

        # Bucket 2: 10 most recent (by created_utc or date)
        remaining = [p for p in all_posts if p.get("id", "") not in top_ids]
        def _parse_ts(p):
            val = p.get("created_utc", p.get("created_at", 0))
            if isinstance(val, str):
                try:
                    from datetime import datetime
                    return datetime.fromisoformat(val.replace("Z", "+00:00")).timestamp()
                except Exception:
                    return 0
            return float(val) if val else 0

        sorted_by_date = sorted(remaining, key=_parse_ts, reverse=True)
        recent_picks = sorted_by_date[:10]
        recent_ids = {p.get("id", "") for p in recent_picks}

        # Bucket 3: outliers — low score, high comments (controversy/pain)
        remaining2 = [p for p in remaining if p.get("id", "") not in recent_ids]
        sorted_by_comments = sorted(remaining2, key=lambda p: p.get("num_comments", 0), reverse=True)
        outlier_candidates = [p for p in sorted_by_comments[:40] if p.get("score", 0) < 20]
        outlier_picks = outlier_candidates[:15]
        outlier_ids = {p.get("id", "") for p in outlier_picks}

        # Bucket 4: random from what's left (deterministic seed from idea_text)
        random_pool = [p for p in remaining2 if p.get("id", "") not in outlier_ids]
        random_budget = budget - top_n - len(recent_picks) - len(outlier_picks)
        _sample_seed = int(_hashlib.md5(str(idea_text or "").encode()).hexdigest(), 16) % (2**32)
        _random.seed(_sample_seed)
        random_picks = _random.sample(random_pool, min(random_budget, len(random_pool)))
        _random.seed()  # reset to system entropy after deterministic sample

        sampled = top_picks + recent_picks + random_picks + outlier_picks
        print(f"  [Smart Sample] {len(sampled)} posts: {top_n} top + {len(recent_picks)} recent + {len(random_picks)} random + {len(outlier_picks)} outliers (from {len(all_posts)} total) [seed={_sample_seed}]")
        return sampled

    # ── Pre-filter: remove noise posts before sampling ──
    # Trust-quality pass: keep a quality bar, but let buyer-language body evidence
    # count earlier for Reddit / IndieHackers instead of relying almost entirely on fallback.
    MIN_SCORE = 3
    MIN_KW_HITS = 1
    core_keywords = [kw.lower() for kw in decomposition.get("keywords", [])]
    RELAXED_SCORE = 2
    colloquial_keywords = [kw.lower() for kw in decomposition.get("colloquial_keywords", [])]
    buyer_language_sources = {"reddit", "reddit_comment", "indiehackers"}
    forced_subreddits = {
        str(sub).strip().lower().replace("r/", "").replace("/r/", "")
        for sub in decomposition.get("subreddits", []) or []
        if str(sub).strip()
    }
    niche_text = " ".join(
        [
            str(idea_text or ""),
            str(decomposition.get("audience", "") or ""),
            str(decomposition.get("pain_hypothesis", "") or ""),
            " ".join(str(kw or "") for kw in decomposition.get("keywords", []) or []),
            " ".join(str(kw or "") for kw in decomposition.get("colloquial_keywords", []) or []),
        ]
    ).lower()
    niche_subreddit_map = {
        "finance": {
            "triggers": ["accounting", "bookkeeping", "tax", "cpa", "payroll", "finance", "invoice"],
            "subs": ["accounting", "bookkeeping", "tax", "smallbusiness", "financialplanning", "finance"],
        },
        "legal": {
            "triggers": ["legal", "law firm", "lawyer", "attorney", "paralegal", "contract"],
            "subs": ["lawfirm", "lawyers", "paralegal", "legaladviceofftopic", "smallbusiness"],
        },
        "healthcare": {
            "triggers": ["medical", "healthcare", "clinic", "dentist", "dental", "patient", "doctor"],
            "subs": ["medicine", "healthit", "dentistry", "privatepractice", "nursing"],
        },
        "agency": {
            "triggers": ["agency", "client work", "marketing agency", "creative agency", "consultancy"],
            "subs": ["agency", "advertising", "marketing", "freelance", "entrepreneur"],
        },
        "real_estate": {
            "triggers": ["real estate", "realtor", "broker", "property management", "leasing"],
            "subs": ["realtors", "realestate", "propertymanagement", "realestateinvesting"],
        },
        "hr": {
            "triggers": ["hr", "human resources", "recruiting", "recruiter", "talent acquisition"],
            "subs": ["humanresources", "recruiting", "recruiters", "askhr"],
        },
        "restaurant": {
            "triggers": ["restaurant", "hospitality", "cafe", "bar", "food service"],
            "subs": ["restaurantowners", "kitchenconfidential", "barowners", "smallbusiness"],
        },
        "retail": {
            "triggers": ["retail", "shop owner", "store owner", "merchandising", "ecommerce"],
            "subs": ["retail", "shopify", "smallbusiness", "ecommerce"],
        },
    }
    topic_native_subreddits = set(forced_subreddits)
    for config in niche_subreddit_map.values():
        if any(trigger in niche_text for trigger in config["triggers"]):
            topic_native_subreddits.update(config["subs"])

    def _source_key(p):
        raw_source = str(p.get("source") or "").strip().lower()
        subreddit = str(p.get("subreddit") or "").strip().lower().replace("r/", "").replace("/r/", "")
        known_reddit_sources = {
            "reddit",
            "reddit_comment",
            "pushshift",
            "pullpush",
            "reddit_search",
        }
        raw = raw_source or "unknown"
        if raw.startswith("hackernews"):
            return "hackernews"
        if raw.startswith("producthunt"):
            return "producthunt"
        if raw.startswith("indiehackers"):
            return "indiehackers"
        if raw.startswith("stack"):
            return "stackoverflow"
        if raw.startswith("github"):
            return "githubissues"
        if raw_source in known_reddit_sources or raw.startswith("reddit") or raw_source.startswith("r/"):
            return "reddit"
        if subreddit:
            return "reddit"
        return raw or "unknown"

    def _match_count(text, phrases):
        return sum(1 for phrase in phrases if phrase and phrase in text)

    def _matched_terms(p):
        raw = p.get("matched_keywords", p.get("matched_phrases", [])) or []
        if isinstance(raw, str):
            raw = [raw]
        return [str(item).strip().lower() for item in raw if str(item).strip()]

    def _title_has_core_kw(p):
        """Returns True if the post title contains at least one core keyword (word-boundary match)."""
        title = (p.get("title", "") or "").lower()
        return any(re.search(r'\b' + re.escape(kw) + r'\b', title) for kw in core_keywords)

    def _subreddit_key(p):
        raw = str(p.get("subreddit") or "").strip().lower()
        return raw.replace("r/", "").replace("/r/", "")

    def _relevance_assessment(p):
        title = (p.get("title", "") or "").lower()
        body = " ".join(
            str(p.get(key) or "").lower()
            for key in ("selftext", "body", "text", "full_text")
        )
        kw_hits = len(_matched_terms(p))
        score = int(p.get("score", 0) or 0)
        source = _source_key(p)
        title_relevant = _title_has_core_kw(p)
        body_formal_hits = _match_count(body, core_keywords)
        colloquial_hits = _match_count(f"{title} {body}", colloquial_keywords) if source == "reddit" else 0
        if source == "reddit":
            subreddit = _subreddit_key(p)
            if subreddit in forced_subreddits:
                if score >= RELAXED_SCORE:
                    return True, "forced_subreddit_pass"
                return False, "rejected_low_score"
            if subreddit in topic_native_subreddits:
                if score < RELAXED_SCORE:
                    return False, "rejected_low_score"
                if colloquial_hits >= 1 or body_formal_hits >= 1 or kw_hits >= 1:
                    return True, "body_match_pass"
                return False, "rejected_no_match"
            if score >= MIN_SCORE and (title_relevant or kw_hits >= 2):
                return True, "standard"
            if score >= RELAXED_SCORE and (colloquial_hits >= 1 or body_formal_hits >= 1 or kw_hits >= 1):
                return True, "body_match_pass"
            if score < RELAXED_SCORE:
                return False, "rejected_low_score"
            return False, "rejected_no_match"
        # All non-Reddit platforms: keep the current threshold unchanged.
        if score >= MIN_SCORE and (title_relevant or kw_hits >= 2):
            return True, "standard"
        if source == "indiehackers":
            if score >= RELAXED_SCORE and (body_formal_hits >= 1 or kw_hits >= 1):
                return True, "standard"
            if score < RELAXED_SCORE:
                return False, "rejected_low_score"
            return False, "rejected_no_match"
        return False, "rejected_no_match" if score >= MIN_SCORE else "rejected_low_score"

    primary_assessments = [_relevance_assessment(p) for p in posts]
    pre_filtered = [p for p, assessment in zip(posts, primary_assessments) if assessment[0]]
    primary_pre_filtered = list(pre_filtered)
    print(f"  [Filter] {len(pre_filtered)}/{len(posts)} posts passed the primary relevance gate", flush=True)
    fallback_threshold = depth_config.get("fallback_rescue_threshold", 10) if depth_config else 10
    if len(pre_filtered) < fallback_threshold:
        # Don't discard everything if filter is too aggressive — fall back to score+body-keyword only
        fallback_candidates = []
        for p in posts:
            source = _source_key(p)
            score = int(p.get("score", 0) or 0)
            matched_terms = len(_matched_terms(p))
            body = " ".join(
                str(p.get(key) or "").lower()
                for key in ("selftext", "body", "text", "full_text")
            )
            colloquial_hits = _match_count(body, colloquial_keywords) if source == "reddit" else 0
            body_formal_hits = _match_count(body, core_keywords)
            min_score = RELAXED_SCORE if source in buyer_language_sources else MIN_SCORE
            if score >= min_score and (
                matched_terms >= MIN_KW_HITS or body_formal_hits >= 1 or colloquial_hits >= 1
            ):
                fallback_candidates.append(p)
        pre_filtered = (
            primary_pre_filtered + [p for p in fallback_candidates if p not in primary_pre_filtered]
        ) or posts
        print(f"  [Filter] Fallback: {len(pre_filtered)} posts after score+body-keyword filter", flush=True)

    from collections import Counter

    filter_explanation = (
        "Primary filter now counts buyer-language body evidence earlier for Reddit/IndieHackers, "
        "so niche B2B complaint posts do not depend entirely on fallback rescue."
    )
    primary_source_counts = Counter(_source_key(p) for p in primary_pre_filtered)
    rescued_posts = [p for p in pre_filtered if p not in primary_pre_filtered]
    rescue_source_counts = Counter(_source_key(p) for p in rescued_posts)
    rescued_count = len(rescued_posts)
    fallback_mode = "not_needed" if not rescued_count else (
        "all_posts_emergency" if len(pre_filtered) == len(posts) and not primary_pre_filtered else "score+body-keyword"
    )
    print(f"  [Filter] {filter_explanation}", flush=True)
    if primary_source_counts:
        primary_breakdown = ", ".join(
            f"{source}={count}" for source, count in sorted(primary_source_counts.items())
        )
        print(f"  [Filter] Primary by source: {primary_breakdown}", flush=True)
    reddit_scraped_count = sum(1 for p in posts if _source_key(p) == "reddit")
    reddit_primary_count = sum(
        1
        for p, assessment in zip(posts, primary_assessments)
        if _source_key(p) == "reddit" and assessment[0]
    )
    reddit_detail_counts = Counter(
        assessment[1]
        for p, assessment in zip(posts, primary_assessments)
        if _source_key(p) == "reddit"
    )
    if reddit_scraped_count:
        print("  [Filter] Reddit pass detail:", flush=True)
        print(
            f"    forced_subreddit_pass = {reddit_detail_counts.get('forced_subreddit_pass', 0)}",
            flush=True,
        )
        print(
            f"    body_match_pass = {reddit_detail_counts.get('body_match_pass', 0)}",
            flush=True,
        )
        print(
            f"    rejected_low_score = {reddit_detail_counts.get('rejected_low_score', 0)}",
            flush=True,
        )
        print(
            f"    rejected_no_match = {reddit_detail_counts.get('rejected_no_match', 0)}",
            flush=True,
        )
        print(
            f"  [Filter] Reddit pass rate: {reddit_primary_count}/{reddit_scraped_count} scraped "
            f"({(reddit_primary_count / max(reddit_scraped_count, 1)) * 100:.0f}% - target 35-50%)",
            flush=True,
        )
    rescue_breakdown = ", ".join(
        f"{source}={count}" for source, count in sorted(rescue_source_counts.items())
    ) or "none"
    print(
        f"  [Filter] Observable summary: primary_pass={len(primary_pre_filtered)}, "
        f"fallback_rescued={rescued_count}, final_filtered={len(pre_filtered)} "
        f"({fallback_mode}; {rescue_breakdown})",
        flush=True,
    )

    filter_diagnostics = {
        "primary_pass_count": len(primary_pre_filtered),
        "fallback_rescued_count": rescued_count,
        "final_filtered_count": len(pre_filtered),
        "fallback_mode": fallback_mode,
        "primary_by_source": dict(primary_source_counts),
        "fallback_by_source": dict(rescue_source_counts),
        "reddit_pass_detail": {
            "scraped_count": reddit_scraped_count,
            "primary_pass_count": reddit_primary_count,
            "forced_subreddit_pass": reddit_detail_counts.get("forced_subreddit_pass", 0),
            "body_match_pass": reddit_detail_counts.get("body_match_pass", 0),
            "rejected_low_score": reddit_detail_counts.get("rejected_low_score", 0),
            "rejected_no_match": reddit_detail_counts.get("rejected_no_match", 0),
        },
        "rules": filter_explanation,
    }

    posts_filtered_count = len(pre_filtered)  # for pipeline UI display
    sampled_posts = _smart_sample(pre_filtered, budget=100)
    post_summaries = []
    for p in sampled_posts:
        summary = {
            "title": p.get("title", "")[:200],
            "source": p.get("source", p.get("subreddit", "unknown")),
            "subreddit": p.get("subreddit", ""),
            "score": p.get("score", 0),
            "comments": p.get("num_comments", 0),
            "text_snippet": (p.get("selftext", "") or "")[:300],
        }
        post_summaries.append(summary)

    platforms_used = len([k for k, v in source_counts.items() if v > 0])
    source_summary = ", ".join([f"{k}: {v} posts" for k, v in source_counts.items() if v > 0])

    # ── Batch summarization: run ALL filtered posts through AI in parallel batches ──
    # This replaces the naive approach of only telling the AI about 100 posts.
    # Every filtered post contributes to the verdict — coverage goes to 100%.
    def _batch_summarize_all(all_posts: list, keywords: list) -> dict:
        """
        Splits all_posts into batches of 50, runs each batch through the AI in
        parallel threads, and merges the results into a single signal block
        that replaces posts_block in Pass 1.
        Falls back to sampled posts_block if all batches fail.
        """
        import concurrent.futures as _cf

        BATCH_SIZE = 50
        batches = [all_posts[i:i + BATCH_SIZE] for i in range(0, len(all_posts), BATCH_SIZE)]
        kw_str = ", ".join(keywords[:10])
        print(f"  [BatchSummarize] {len(all_posts)} posts → {len(batches)} batches of ≤{BATCH_SIZE}", flush=True)

        BATCH_SYSTEM = "You are a market signal extractor. Return ONLY valid compact JSON."

        def _run_batch(batch_posts, batch_idx):
            lines = []
            for p in batch_posts:
                title = (p.get("title", "") or "")[:150]
                snippet = (p.get("selftext", "") or p.get("text", "") or "")[:200]
                score = p.get("score", 0)
                lines.append(f"[{score}pts] {title}\n{snippet}")
            posts_text = "\n---\n".join(lines)
            prompt = f"""Idea keywords: {kw_str}

Analyze these {len(batch_posts)} posts for startup market signals.
Return ONLY this JSON (no markdown, no explanation):
{{"pain_quotes":["exact quote 1","exact quote 2"],"wtp_signals":["signal or null"],"competitor_mentions":["name if explicitly mentioned"],"key_insight":"one specific sentence"}}

Posts:
{posts_text}"""
            try:
                raw = brain.single_call(prompt, BATCH_SYSTEM)
                data = extract_json(raw)
                print(f"  [Batch {batch_idx+1}/{len(batches)}] ✓ {len(batch_posts)} posts", flush=True)
                return {
                    "batch_size": len(batch_posts),
                    "batch_index": batch_idx,
                    "signals": data,
                }
            except Exception as ex:
                print(f"  [Batch {batch_idx+1}/{len(batches)}] ✗ {ex}", flush=True)
                return None

        # Run all batches in parallel threads
        with _cf.ThreadPoolExecutor(max_workers=6) as executor:
            futures = {executor.submit(_run_batch, batch, i): i for i, batch in enumerate(batches)}
            batch_results = []
            for future in _cf.as_completed(futures):
                result = future.result()
                if result is not None:
                    batch_results.append(result)

        if not batch_results:
            print("  [BatchSummarize] All batches failed — falling back to sampled block", flush=True)
            return None  # caller will use sampled posts_block instead

        # Merge all batch signals
        successful_posts = sum(r.get("batch_size", 0) for r in batch_results)
        partial_coverage = successful_posts < len(all_posts)
        all_pain_quotes, all_wtp, all_competitors, all_insights = [], [], [], []
        for r in batch_results:
            signal_block = r.get("signals", {}) or {}
            all_pain_quotes.extend(signal_block.get("pain_quotes", []) or [])
            all_wtp.extend([w for w in (signal_block.get("wtp_signals", []) or []) if w and w.lower() != "null"])
            all_competitors.extend(signal_block.get("competitor_mentions", []) or [])
            if signal_block.get("key_insight"):
                all_insights.append(signal_block["key_insight"])

        _pain_cap = depth_config.get("batch_pain_cap", 25) if depth_config else 25
        _wtp_cap = depth_config.get("batch_wtp_cap", 15) if depth_config else 15
        _comp_cap = depth_config.get("batch_comp_cap", 10) if depth_config else 10
        _insight_cap = depth_config.get("batch_insight_cap", 20) if depth_config else 20

        merged = {
            "posts_analyzed": successful_posts,
            "batches_succeeded": len(batch_results),
            "batches_total": len(batches),
            "partial_coverage": partial_coverage,
            "failed_batches": max(0, len(batches) - len(batch_results)),
            "coverage": f"{successful_posts}/{len(all_posts)} posts ({len(batch_results)}/{len(batches)} batches)",
            "pain_quotes": list(dict.fromkeys(all_pain_quotes))[:_pain_cap],
            "wtp_signals": list(dict.fromkeys(all_wtp))[:_wtp_cap],
            "competitor_mentions": list(dict.fromkeys(all_competitors))[:_comp_cap],
            "key_insights": [i for i in all_insights if i][:_insight_cap],
        }
        print(f"  [BatchSummarize] Merged: {len(merged['pain_quotes'])} pain quotes, {len(merged['wtp_signals'])} WTP signals, {len(merged['competitor_mentions'])} competitors", flush=True)
        return merged

    # Run batch analysis on ALL filtered posts
    update_validation(validation_id, {"status": "synthesizing (0/3 batch scan)"})
    batch_signals = _batch_summarize_all(pre_filtered, decomposition.get("keywords", []))

    # Build posts_block — prefer rich batch signals, fall back to sampled summaries
    if batch_signals:
        posts_block = f"""MARKET SIGNAL SCAN ({batch_signals['coverage']}):

PAIN QUOTES (exact from posts):
{json.dumps(batch_signals['pain_quotes'], indent=2)}

WILLINGNESS TO PAY SIGNALS:
{json.dumps(batch_signals['wtp_signals'], indent=2)}

COMPETITOR MENTIONS (from post discussions):
{json.dumps(batch_signals['competitor_mentions'], indent=2)}

KEY INSIGHTS (one per batch):
{json.dumps(batch_signals['key_insights'], indent=2)}

TOP {len(post_summaries)} REPRESENTATIVE POSTS (for title/score reference):
{json.dumps(post_summaries, indent=2)}"""
        posts_analyzed_count = batch_signals.get("posts_analyzed", len(sampled_posts))
    else:
        posts_block = f"TOP {len(post_summaries)} POSTS:\n{json.dumps(post_summaries, indent=2)}"
        posts_analyzed_count = len(sampled_posts)

    # ── Shared context block ──
    context_block = f"""IDEA: {idea_text}

TARGET AUDIENCE: {decomposition['audience']}
PAIN HYPOTHESIS: {decomposition['pain_hypothesis']}
COMPETITORS: {', '.join(decomposition['competitors'])}
KEYWORDS: {', '.join(decomposition['keywords'])}

DATA: {posts_filtered_count} filtered posts (from {len(posts)} total scraped) across {platforms_used} platforms ({source_summary})
"""
    if intel.get("trend_prompt"):
        context_block += intel["trend_prompt"] + "\n"
    if intel.get("comp_prompt"):
        context_block += intel["comp_prompt"] + "\n"

    # ═══════════════════════════════════════
    # PASS 1: MARKET ANALYSIS
    # ═══════════════════════════════════════
    print("\n  ── Pass 1/3: Market Analysis ──")
    update_validation(validation_id, {"status": "synthesizing (1/3 market analysis)"})
    pass1_prompt = f"""{context_block}

{posts_block}

Analyze the MARKET signal. Find pain validation, WTP signals, and cite specific evidence posts."""
    try:
        pass1_raw = brain.single_call(pass1_prompt, PASS1_SYSTEM)
        pass1 = extract_json(pass1_raw)
        evidence_count = len(pass1.get("evidence", []))
        print(f"  [✓] Pass 1 done: pain_validated={pass1.get('pain_validated')}, {evidence_count} evidence posts")
    except Exception as e:
        print(f"  [!] Pass 1 failed after routing all available models: {e}")
        pass1 = {"pain_validated": False, "pain_description": "Analysis failed", "evidence": []}

    # ═══════════════════════════════════════
    # PASS 2: STRATEGY
    # ═══════════════════════════════════════
    print("\n  ── Pass 2/3: Strategy & Competition ──")
    update_validation(validation_id, {"status": "synthesizing (2/3 strategy)"})
    pass2_prompt = f"""{context_block}

MARKET ANALYSIS (from Pass 1):
- Pain validated: {pass1.get('pain_validated')}
- Pain: {pass1.get('pain_description', 'N/A')}
- WTP: {pass1.get('willingness_to_pay', 'N/A')}
- Timing: {pass1.get('market_timing', 'N/A')}
- TAM: {pass1.get('tam_estimate', 'N/A')}
- Evidence posts cited: {len(pass1.get('evidence', []))}

Design the full strategy: ICP, competition landscape, pricing, and monetization.
(Do NOT re-analyze raw posts — reason from the market analysis above.)"""
    try:
        pass2_raw = brain.single_call(pass2_prompt, PASS2_SYSTEM)
        pass2 = extract_json(pass2_raw)
        competitors = pass2.get("competition_landscape", {}).get("direct_competitors", [])
        print(f"  [✓] Pass 2 done: {len(competitors)} competitors found, pricing model={pass2.get('pricing_strategy', {}).get('recommended_model', '?')}")
    except Exception as e:
        print(f"  [!] Pass 2 failed after routing all available models: {e}")
        pass2 = {"ideal_customer_profile": {}, "competition_landscape": {}, "pricing_strategy": {}}

    # ═══════════════════════════════════════
    # PASS 3: ACTION PLAN
    # ═══════════════════════════════════════
    print("\n  ── Pass 3/3: Action Plan ──")
    update_validation(validation_id, {"status": "synthesizing (3/3 action plan)"})
    pass3_raw = ""
    try:
        pricing_summary = json.dumps(pass2.get("pricing_strategy", {}))
        icp_summary = pass2.get("ideal_customer_profile", {}).get("primary_persona", "Unknown")
        comp_landscape = pass2.get("competition_landscape", {})
        direct_competitors = comp_landscape.get("direct_competitors", [])
        # Pass competitor names + prices to Pass 3 so risks are idea-specific not generic
        competitors_block = ""
        if direct_competitors:
            comp_lines = []
            _comp_depth = depth_config.get("pass3_competitor_depth", 5) if depth_config else 5
            for c in direct_competitors[:_comp_depth]:
                name = c.get("name", c.get("company", "Unknown"))
                price = c.get("price", c.get("pricing", c.get("price_point", "unknown price")))
                weakness = c.get("weakness", c.get("gap", ""))
                comp_lines.append(f"  - {name}: {price} | Gap: {weakness}")
            competitors_block = "NAMED COMPETITORS (use these in risks — do not invent others):\n" + "\n".join(comp_lines)
        else:
            competitors_block = "NAMED COMPETITORS: None identified in Pass 2 — use market saturation data for risks."

        pass3_prompt = f"""{context_block}

FROM MARKET ANALYSIS:
- Pain validated: {pass1.get('pain_validated')}
- Intensity: {pass1.get('pain_intensity', 'N/A')}
- WTP signals: {pass1.get('willingness_to_pay', 'N/A')}
- TAM: {pass1.get('tam_estimate', 'N/A')}
- Evidence posts count: {len(pass1.get('evidence', []))}

FROM STRATEGY:
- ICP: {icp_summary}
- Pricing: {pricing_summary[:500]}
- Market saturation: {comp_landscape.get('market_saturation', 'N/A')}
- Total products found: {comp_landscape.get('total_products_found', 'N/A')}
{competitors_block}

Create the ACTION PLAN. CRITICAL: risks must name specific competitors above, not generic categories.
Revenue assumptions must cite a specific comparable conversion rate or say 'no comparable found'.
Create the launch roadmap, revenue projections, risk matrix, and first 10 customers strategy."""

        # Pass 3 has a large JSON response — prefer second model (pinned_index=1) which avoids
        # re-using the same Groq Llama-4 Scout (configs[0]) that hits 8192 token limit mid-JSON
        # and truncates risk_matrix + first_10_customers. DeepSeek or other models handle this better.
        pass3_raw = brain.single_call(
            pass3_prompt,
            PASS3_SYSTEM,
            pinned_index=1,  # Use second configured model — avoids Groq 8K token truncation
        )
        pass3 = extract_json(pass3_raw)
        roadmap_steps = len(pass3.get("launch_roadmap", []))
        risk_count = len(pass3.get("risk_matrix", []))
        print(f"  [✓] Pass 3 done: {roadmap_steps} roadmap steps, {risk_count} risks, MVP features={pass3.get('mvp_features', [])}")
    except Exception as e:
        print(f"  [!] Pass 3 failed after routing all available models: {e}")
        print(f"  [!] Raw Pass 3 output (first 500 chars): {pass3_raw[:500] if pass3_raw else 'no output'}")
        pass3 = {"launch_roadmap": [], "revenue_projections": {}, "risk_matrix": [], "first_10_customers_strategy": {}}

    # ═══════════════════════════════════════
    # DATA QUALITY CHECK + CONTRADICTION DETECTION
    # ═══════════════════════════════════════
    data_quality = _check_data_quality(
        posts,
        source_counts,
        pass1,
        pass2,
        pass3,
        platform_warnings=kwargs.get("platform_warnings", []),
        idea_text=idea_text,
    )
    print(f"\n  ── Data Quality Check ──")
    print(f"  [Q] Post count: {len(posts)} (threshold: 20 for full confidence)")
    print(f"  [Q] Confidence cap: {data_quality['confidence_cap']}%")
    print(f"  [Q] Contradictions found: {len(data_quality['contradictions'])}")
    for c in data_quality["contradictions"]:
        print(f"      ⚠ {c}")
    for w in data_quality["warnings"]:
        print(f"      ℹ {w}")

    # ═══════════════════════════════════════
    # FINAL VERDICT: MULTI-MODEL DEBATE
    # ═══════════════════════════════════════
    print("\n  ── Final: Multi-Model Debate for Verdict ──")
    update_validation(validation_id, {"status": "debating (final verdict)"})

    def on_progress(status, msg):
        update_validation(validation_id, {"status": status})
        print(f"  [Brain] {msg}")

    # Inject quality context into verdict prompt so AI models know the data limitations
    quality_context = ""
    if data_quality["contradictions"]:
        quality_context += "\nDATA QUALITY WARNINGS (factor these into your confidence score):\n"
        for c in data_quality["contradictions"]:
            quality_context += f"  ⚠ CONTRADICTION: {c}\n"
    if data_quality["warnings"]:
        for w in data_quality["warnings"]:
            quality_context += f"  ℹ WARNING: {w}\n"
    if len(posts) < 20:
        quality_context += f"  ⚠ LOW DATA: Only {len(posts)} posts scraped (minimum 20 recommended for reliable analysis). Penalize confidence accordingly.\n"

    verdict_prompt = f"""{context_block}

MARKET ANALYSIS RESULTS:
- Pain validated: {pass1.get('pain_validated')}
- Pain description: {pass1.get('pain_description', 'N/A')}
- WTP signals: {pass1.get('willingness_to_pay', 'N/A')}
- Market timing: {pass1.get('market_timing', 'N/A')}
- TAM: {pass1.get('tam_estimate', 'N/A')}
- Evidence posts: {len(pass1.get('evidence', []))} cited

STRATEGY RESULTS:
- Competition: {pass2.get('competition_landscape', {}).get('market_saturation', 'N/A')}
- Direct competitors: {len(pass2.get('competition_landscape', {}).get('direct_competitors', []))}
- Pricing model: {pass2.get('pricing_strategy', {}).get('recommended_model', 'N/A')}

ACTION PLAN RESULTS:
- Roadmap steps: {len(pass3.get('launch_roadmap', []))}
- Month 6 MRR target: {pass3.get('revenue_projections', {}).get('month_6', {}).get('mrr', 'N/A')}
- Risks identified: {len(pass3.get('risk_matrix', []))}
{quality_context}
{posts_block}

Based on ALL analysis, deliver your FINAL VERDICT. Be honest and data-driven. If data is thin (<20 posts), your confidence MUST reflect that uncertainty."""

    try:
        verdict_report = brain.debate(verdict_prompt, VERDICT_SYSTEM, on_progress=on_progress)
        verdict_report["_source"] = "debate_engine"  # Fix A: mark as real computed result
    except Exception as e:
        # Fix A: log the full exception type + message so we can distinguish fallback from real verdict
        import traceback as _tb
        print(f"  [!!!] DEBATE ENGINE FAILED — {type(e).__name__}: {e}")
        print(f"  [!!!] This means RISKY/50% is the FALLBACK DEFAULT, not a computed verdict!")
        print(f"  [!!!] Traceback: {_tb.format_exc()[-1000:]}")
        verdict_report = {
            "verdict": "RISKY",
            "confidence": 50,
            "executive_summary": f"[FALLBACK] Verdict debate engine failed — this is NOT a real analysis result. Error: {type(e).__name__}: {str(e)}",
            "top_posts": [],
            "_source": "fallback_exception",  # Fix A: mark as fake/fallback
            "_error": str(e),
            "_error_type": type(e).__name__,
        }

    # ═══════════════════════════════════════
    # MERGE ALL PASSES INTO FINAL REPORT
    # ═══════════════════════════════════════
    report = {}
    report["verdict"] = verdict_report.get("verdict", "RISKY")
    raw_confidence = verdict_report.get("confidence", 50)

    # ── APPLY CONFIDENCE CAP based on data quality ──
    capped_confidence = min(raw_confidence, data_quality["confidence_cap"])
    if capped_confidence < raw_confidence:
        print(f"  [Q] Confidence capped: {raw_confidence}% → {capped_confidence}% (reason: {data_quality['cap_reason']})")
    report["confidence"] = capped_confidence

    # ── CONFIDENCE BOOST: counterbalance aggressive caps when real signals exist ──
    boost = 0
    _trends = intel.get("trends", {}) or {}
    _comp = intel.get("competition", {}) or {}
    _overall_trend = str(_trends.get("overall_trend", "")).upper()
    _comp_tier = str(_comp.get("overall_tier", "")).upper()
    _pain_ok = pass1.get("pain_validated", False)
    _ev_count = len(report.get("market_analysis", {}).get("evidence", []) or pass1.get("evidence", []))
    _wtp_raw = str(pass1.get("willingness_to_pay", "")).lower()
    _wtp_ok = bool(_wtp_raw) and not any(neg in _wtp_raw[:30] for neg in ["no ", "none", "not found", "no explicit"])

    if "GROWING" in _overall_trend:   boost += 5
    if "EXPLODING" in _overall_trend: boost += 10
    if _comp_tier in ("LOW", "MEDIUM"): boost += 5
    if _pain_ok and _ev_count >= 10:    boost += 5
    if _wtp_ok:                         boost += 5

    total_boost = min(15, boost)
    if total_boost > 0:
        boost_ceiling = min(85, data_quality["confidence_cap"] + 10)
        boosted = min(capped_confidence + total_boost, boost_ceiling)
        print(
            f"  [Confidence] Cap={capped_confidence}% + Boost={total_boost}% "
            f"→ {boosted}% (boost clamped to cap+10={boost_ceiling}) | "
            f"trends={_overall_trend or 'UNKNOWN'} "
            f"comp={_comp_tier or 'UNKNOWN'} pain={_pain_ok} "
            f"ev={_ev_count} wtp={_wtp_ok}"
        )
        report["confidence"] = boosted
        capped_confidence = boosted  # update for downstream verdict overrides
    else:
        print(f"  [Confidence] No boost applied. Final={capped_confidence}%")

    # Normalize verdict string — AI models return "DON'T BUILD" with apostrophe,
    # CALIBRATION_BLOCK says "DONT_BUILD" without. Handle both.
    raw_verdict = report["verdict"].upper().strip()
    if raw_verdict in ("DON'T BUILD", "DONT_BUILD", "DON'T_BUILD", "DONT BUILD"):
        report["verdict"] = "DON'T BUILD"  # canonical form

    # Override verdict if confidence was capped below thresholds
    if capped_confidence < 40 and report["verdict"] == "BUILD IT":
        report["verdict"] = "RISKY"
        print(f"  [Q] Verdict overridden: BUILD IT → RISKY (confidence too low after cap)")

    # Fix E: symmetric override — DON'T BUILD at high confidence + validated pain is contradictory
    # NOTE: Uses pass1 directly since report["market_analysis"] isn't built yet at this point
    if capped_confidence > 80 and report["verdict"] == "DON'T BUILD":
        if pass1.get("pain_validated"):
            report["verdict"] = "RISKY"
            print(f"  [Q] Verdict overridden: DON'T BUILD → RISKY (high confidence + validated pain contradicts negative verdict)")
            data_quality["warnings"].append(
                "DON'T BUILD overridden to RISKY — confidence >80% with validated pain contradicts a hard negative. Review evidence."
            )

    report["executive_summary"] = verdict_report.get("executive_summary") or verdict_report.get("summary", "")

    # Pass 1: Market
    report["market_analysis"] = {
        "pain_validated": pass1.get("pain_validated", False),
        "pain_description": pass1.get("pain_description", ""),
        "pain_frequency": pass1.get("pain_frequency", ""),
        "pain_intensity": pass1.get("pain_intensity", ""),
        "willingness_to_pay": pass1.get("willingness_to_pay", ""),
        "market_timing": pass1.get("market_timing", ""),
        "tam_estimate": pass1.get("tam_estimate", ""),
        "evidence": pass1.get("evidence", []),
    }

    # Pass 2: Strategy
    report["ideal_customer_profile"] = pass2.get("ideal_customer_profile", {})
    report["competition_landscape"] = pass2.get("competition_landscape", {})
    competition_data = dict(intel.get("competition") or {})
    report_competitors = []
    for comp in report["competition_landscape"].get("direct_competitors", []):
        name = comp.get("name", "") if isinstance(comp, dict) else str(comp)
        if str(name).strip():
            report_competitors.append(str(name).strip())
    if competition_data.get("overall_tier") == "BLUE_OCEAN" and (report_competitors or intel.get("competitor_complaints")):
        corrected_tier = "COMPETITIVE" if len(report_competitors) >= 2 or intel.get("competitor_complaints") else "EMERGING"
        correction_note = (
            f"Post-synthesis correction: BLUE_OCEAN -> {corrected_tier} because "
            f"the report named competitors ({', '.join(report_competitors[:5]) or 'n/a'}) "
            f"and complaint evidence was {'present' if intel.get('competitor_complaints') else 'not present'}."
        )
        competition_data["overall_tier"] = corrected_tier
        competition_data["corrections"] = list(competition_data.get("corrections", [])) + [correction_note]
        competition_data["reasoning"] = list(competition_data.get("reasoning", [])) + [correction_note]
        intel["competition"] = competition_data
        print(f"  [COMP] {correction_note}")
    report["pricing_strategy"] = pass2.get("pricing_strategy", {})
    report["monetization_channels"] = pass2.get("monetization_channels", [])

    # Pass 3: Action Plan
    report["launch_roadmap"] = pass3.get("launch_roadmap", [])
    report["revenue_projections"] = pass3.get("revenue_projections", {})
    report["financial_reality"] = pass3.get("financial_reality", {})

    # Signal summary (from batch analysis)
    report["signal_summary"] = {
        "posts_scraped": len(posts),
        "posts_filtered": posts_filtered_count if 'posts_filtered_count' in dir() else len(posts),
        "primary_filter_passed": (filter_diagnostics or {}).get("primary_pass_count", 0) if 'filter_diagnostics' in dir() else 0,
        "fallback_rescued": (filter_diagnostics or {}).get("fallback_rescued_count", 0) if 'filter_diagnostics' in dir() else 0,
        "posts_analyzed": posts_analyzed_count if 'posts_analyzed_count' in dir() else 0,
        "pain_quotes_found": len((batch_signals or {}).get("pain_quotes", [])) if 'batch_signals' in dir() else 0,
        "wtp_signals_found": len((batch_signals or {}).get("wtp_signals", [])) if 'batch_signals' in dir() else 0,
        "competitor_mentions": len((batch_signals or {}).get("competitor_mentions", [])) if 'batch_signals' in dir() else 0,
        "partial_coverage": bool((batch_signals or {}).get("partial_coverage", False)) if 'batch_signals' in dir() else False,
        "batches_succeeded": (batch_signals or {}).get("batches_succeeded", 0) if 'batch_signals' in dir() else 0,
        "batches_total": (batch_signals or {}).get("batches_total", 0) if 'batch_signals' in dir() else 0,
        "data_sources": source_counts if 'source_counts' in dir() else {},
    }

    # Risk fallback: Pass 3 often truncates on Groq 8K limit — use debate risks if empty
    pass3_risks = pass3.get("risk_matrix", [])
    if not pass3_risks:
        # Extract risks from debate output — they're always generated, even when Pass 3 fails
        debate_risks = verdict_report.get("risk_factors", [])
        if debate_risks:
            # Normalize to same structure as pass3 risk_matrix
            pass3_risks = [
                {"risk": r if isinstance(r, str) else r.get("risk", str(r)), "severity": "HIGH", "probability": "HIGH", "mitigation": ""}
                for r in debate_risks
            ]
            print(f"  [Risks] Pass 3 empty — using {len(pass3_risks)} risks from debate output")
    report["risk_matrix"] = pass3_risks

    report["first_10_customers_strategy"] = pass3.get("first_10_customers_strategy", {})
    report["mvp_features"] = pass3.get("mvp_features", [])
    report["cut_features"] = pass3.get("cut_features", [])

    # Verdict extras
    report["top_posts"] = verdict_report.get("top_posts", [])

    # FIX 1: Write debate evidence to report — _weighted_merge deduplicates across all models
    # Pass 1 evidence (market_analysis.evidence) has 6 posts from initial analysis
    # Debate evidence (verdict_report.evidence) has 21 deduplicated across all models
    # Both must be in the report so the frontend can show the full count
    debate_evidence = verdict_report.get("evidence", [])
    report["debate_evidence"] = debate_evidence
    # Also merge into market_analysis.evidence — deduplicate by post_title
    existing_titles = set()
    for e in report["market_analysis"].get("evidence", []):
        if isinstance(e, dict):
            existing_titles.add(e.get("post_title", "").lower().strip())
        else:
            existing_titles.add(str(e).lower().strip())
    for de in debate_evidence:
        title_key = (de.get("post_title", "") if isinstance(de, dict) else str(de)).lower().strip()
        if title_key and title_key not in existing_titles:
            report["market_analysis"]["evidence"].append(de)
            existing_titles.add(title_key)
    print(f"  [Evidence] Pass1={len(pass1.get('evidence', []))}, Debate={len(debate_evidence)}, Merged={len(report['market_analysis']['evidence'])}")
    report["evidence_count"] = verdict_report.get(
        "evidence_count",
        len(debate_evidence) if debate_evidence else len(report["market_analysis"]["evidence"]),
    )

    # ── Fix 1: Write full debate metadata to report so frontend displays it ──
    # debate() returns models_used, model_verdicts, debate_mode, consensus_type, dissent
    # but validate_idea.py was only extracting top_posts — debate counter showed 0.
    debate_models = verdict_report.get("models_used", [])
    model_verdicts_raw = verdict_report.get("model_verdicts", {})
    # model_verdicts from _weighted_merge is {model: {verdict, role}} — flatten to {model: verdict} for frontend
    model_verdicts_flat = {
        m: (v.get("verdict", v) if isinstance(v, dict) else str(v))
        for m, v in model_verdicts_raw.items()
    }
    report["debate_mode"] = verdict_report.get("debate_mode", len(debate_models) > 1)
    report["models_used"] = debate_models
    report["model_verdicts"] = model_verdicts_flat
    report["debate_rounds"] = verdict_report.get("debate_rounds", 2 if verdict_report.get("debate_mode") else 1)
    report["consensus_type"] = verdict_report.get("consensus_type", "")
    report["consensus_strength"] = verdict_report.get("consensus_strength", "")
    report["debate_log"] = verdict_report.get("debate_log", [])
    report["debate_transcript"] = verdict_report.get("debate_transcript")
    report["final_verdict"] = verdict_report.get("verdict", report.get("verdict", ""))
    report["verdict_source"] = verdict_report.get("_source", "unknown")

    # Metadata
    report["data_sources"] = source_counts
    report["platform_breakdown"] = source_counts
    report["platforms_used"] = platforms_used
    report["platform_warnings"] = kwargs.get("platform_warnings", []) + data_quality.get("platform_warnings", [])
    report["trends_data"] = intel.get("trends")
    report["competition_data"] = intel.get("competition")
    if intel.get("competitor_complaints"):
        report["competitor_complaints"] = intel.get("competitor_complaints", [])[:10]
    report["synthesis_method"] = "multi-pass-3"
    report["keywords"] = decomposition.get("keywords", [])
    # Pipeline counts for UI
    report["posts_scraped"] = len(posts)
    report["posts_filtered"] = posts_filtered_count
    report["posts_analyzed"] = posts_analyzed_count
    report["filter_diagnostics"] = filter_diagnostics if 'filter_diagnostics' in dir() else None
    if batch_signals and batch_signals.get("partial_coverage"):
        data_quality["warnings"].append(
            f"Batch summarization partially succeeded — {batch_signals.get('batches_succeeded', 0)}/{batch_signals.get('batches_total', 0)} batches completed."
        )
    model_count = len(getattr(brain, "configs", []))
    if model_count < 3:
        data_quality["warnings"].append(
            f"Only {model_count} model(s) — add more in Settings for richer debate. Min 3 recommended."
        )

    # ── DATA QUALITY METADATA (new) ──
    report["data_quality"] = {
        "total_posts_scraped": len(posts),
        "minimum_recommended": 20,
        "data_sufficient": len(posts) >= 20,
        "platforms_with_data": platforms_used,
        "platforms_total": 6,
        "partial_coverage": bool((batch_signals or {}).get("partial_coverage", False)) if 'batch_signals' in dir() else False,
        "batches_succeeded": (batch_signals or {}).get("batches_succeeded", 0) if 'batch_signals' in dir() else 0,
        "batches_total": (batch_signals or {}).get("batches_total", 0) if 'batch_signals' in dir() else 0,
        "confidence_was_capped": capped_confidence < raw_confidence,
        "original_confidence": raw_confidence,
        "cap_reason": data_quality["cap_reason"] if capped_confidence < raw_confidence else None,
        "contradictions": data_quality["contradictions"],
        "warnings": data_quality["warnings"],
        "platform_warnings": kwargs.get("platform_warnings", []) + data_quality.get("platform_warnings", []),
    }

    verdict = report["verdict"]
    confidence = report["confidence"]

    # Fix A: surface whether verdict came from real debate or fallback exception
    verdict_source = verdict_report.get("_source", "unknown")
    if verdict_source == "fallback_exception":
        data_quality["warnings"].append(
            f"DEBATE ENGINE FAILED — verdict '{verdict}' at {confidence}% is the FALLBACK DEFAULT, "
            f"not a computed result. Error: {verdict_report.get('_error', 'unknown')}. Fix your AI model config."
        )
        report["data_quality"]["warnings"] = data_quality["warnings"]  # refresh in report
        print(f"  [!!!] WARNING: verdict_source=fallback_exception — surfaced in data_quality.warnings")

    # Step 1: Write ESSENTIAL fields first — status=done must always land
    # so the frontend unblocks even if extra columns don't exist in schema yet.
    update_validation(validation_id, {
        "status": "done",
        "verdict": verdict,
        "confidence": confidence,
        "report": json.dumps(report),
        "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    print(f"  [DB] status=done written to Supabase", flush=True)

    # Step 2: Write extra columns separately — non-fatal if they don't exist
    # These columns now exist in Supabase and should match the schema exactly.
    try:
        url = f"{SUPABASE_URL}/rest/v1/idea_validations?id=eq.{validation_id}"
        r = requests.patch(url, json={
            "posts_analyzed": posts_analyzed_count,
            "posts_found": len(posts),
            "verdict_source": verdict_source,
            "synthesis_method": report["synthesis_method"],
            "debate_mode": "debate" if report["debate_mode"] else "single",
            "platform_breakdown": source_counts,
        }, headers=_supabase_headers(), timeout=10)
        if r.status_code >= 400:
            print(f"  [!] Extra columns update skipped (schema may not have them): {r.status_code}", flush=True)
        else:
            print(
                f"  [DB] Extra columns written: posts_found={len(posts)}, "
                f"posts_analyzed={posts_analyzed_count}, verdict_source={verdict_source}",
                flush=True,
            )
    except Exception as ex:
        print(f"  [!] Extra columns update failed (non-fatal): {ex}", flush=True)

    print(f"\n  ═══════════════════════════════")
    print(f"  VERDICT: {verdict} ({confidence}% confidence)")
    if capped_confidence < raw_confidence:
        print(f"  QUALITY: Confidence was capped from {raw_confidence}% → {confidence}% due to data quality issues")
    if data_quality["contradictions"]:
        print(f"  CONTRADICTIONS: {len(data_quality['contradictions'])} found in analysis")
    print(f"  DATA: {len(posts)} posts from {platforms_used} platforms")
    print(f"  REPORT SECTIONS: market_analysis, ICP, competition, pricing, roadmap, projections, risks, first_10, data_quality")
    if intel.get("trends"):
        print(f"  TRENDS: {intel['trends']}")
    if intel.get("competition"):
        print(f"  COMPETITION: {intel['competition']}")
    if verdict_report.get("debate_mode"):
        print(f"  MODE: Multi-Model Debate ({len(verdict_report.get('models_used', []))} models)")
        for model, v in verdict_report.get("model_verdicts", {}).items():
            print(f"    -> {model}: {v}")
    print(f"  ═══════════════════════════════")
    return report


# ═══════════════════════════════════════════════════════
# MAIN PIPELINE
# ═══════════════════════════════════════════════════════

def validate_idea(validation_id: str, idea_text: str, user_id: str = "", depth: str = "quick"):
    """Full 3-phase validation pipeline with multi-model debate."""
    depth_config = get_depth_config(depth)
    print(f"\n{'='*50}")
    print(f"  IDEA VALIDATION {validation_id}")
    print(f"  User: {user_id or 'CLI mode'}")
    print(f"  Idea: {idea_text[:100]}...")
    print(f"{'='*50}")
    log_depth_config(depth_config)
    print()

    try:
        # Load user's AI configs from Supabase
        configs = []
        if user_id:
            configs = get_user_ai_configs(user_id)
            print(f"  [>] Found {len(configs)} AI configs for user")

        if not configs:
            # Fallback: check env vars for backward compatibility
            print("  [!] No user AI configs found, checking env vars...")
            fallback_configs = []
            if os.environ.get("GEMINI_API_KEY"):
                fallback_configs.append({
                    "provider": "gemini",
                    "api_key": os.environ["GEMINI_API_KEY"],
                    "selected_model": "gemini-2.0-flash",
                    "is_active": True,
                    "priority": 1,
                })
            if os.environ.get("GROQ_API_KEY"):
                fallback_configs.append({
                    "provider": "groq",
                    "api_key": os.environ["GROQ_API_KEY"],
                    "selected_model": "llama-3.3-70b-versatile",
                    "is_active": True,
                    "priority": 2,
                })
            if os.environ.get("OPENAI_API_KEY"):
                fallback_configs.append({
                    "provider": "openai",
                    "api_key": os.environ["OPENAI_API_KEY"],
                    "selected_model": "gpt-4o",
                    "is_active": True,
                    "priority": 3,
                })
            if os.environ.get("OPENROUTER_API_KEY"):
                fallback_configs.append({
                    "provider": "openrouter",
                    "api_key": os.environ["OPENROUTER_API_KEY"],
                    "selected_model": "openrouter/deepseek/deepseek-r1",
                    "is_active": True,
                    "priority": 4,
                })
            configs = fallback_configs

        if not configs:
            diagnostics = []
            if not os.environ.get("SUPABASE_URL"):
                diagnostics.append("SUPABASE_URL missing")
            if not (os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")):
                diagnostics.append("SUPABASE service key missing")
            if not os.environ.get("AI_ENCRYPTION_KEY"):
                diagnostics.append("AI_ENCRYPTION_KEY missing")

            detail = f" Diagnostics: {', '.join(diagnostics)}." if diagnostics else ""
            raise Exception(
                "No AI models configured or the worker is using stale settings. "
                "Restart `npm run worker` after saving AI models." + detail
            )

        # Initialize the multi-model brain
        brain = AIBrain(configs)

        # Phase 1: Decompose idea
        decomposition = phase1_decompose(idea_text, brain, validation_id, depth_config=depth_config)

        # Dynamic subreddit expansion for future scraper coverage
        if user_id:
            try:
                new_subs = discover_subreddits(decomposition.get("keywords", [])[:5])
                if new_subs:
                    requests.post(
                        f"{SUPABASE_URL}/rest/v1/user_requested_subreddits",
                        headers={**_supabase_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
                        json=[
                            {"subreddit": s, "requested_by": user_id, "keywords": decomposition.get("keywords", [])[:5]}
                            for s in new_subs
                        ],
                        timeout=10,
                    )
                    print(f"  [Subs] Discovered {len(new_subs)} new subreddits: {new_subs}")
            except Exception as e:
                print(f"  [Subs] Discovery failed: {e}")

        # Phase 2: Scrape ALL platforms
        posts, source_counts, platform_warnings = phase2_scrape(
            decomposition["keywords"],
            decomposition.get("colloquial_keywords", []),
            decomposition.get("subreddits", []),
            validation_id,
            depth_config=depth_config,
        )

        early_competitor_names = []
        early_competitor_complaints = []
        if DEATHWATCH_AVAILABLE:
            try:
                early_competitor_names = sorted({
                    str(name).strip()
                    for name in decomposition.get("competitors", [])
                    if str(name).strip()
                })
                if early_competitor_names:
                    print(
                        f"  [Deathwatch] Early competition scan using "
                        f"{len(early_competitor_names)} competitor hint(s): {early_competitor_names[:5]}"
                    )
                    early_competitor_complaints = scan_for_complaints(posts, early_competitor_names)
            except Exception as e:
                print(f"  [Deathwatch] Early scan skipped: {e}")

        # Phase 2b: Intelligence analysis (Trends + Competition)
        complaint_competitors = sorted({
            comp
            for complaint in early_competitor_complaints
            for comp in complaint.get("competitors_mentioned", [])
        })
        intel = phase2b_intelligence(
            decomposition["keywords"],
            validation_id,
            idea_text=idea_text,
            known_competitors=early_competitor_names,
            complaint_count=len(early_competitor_complaints),
            complaint_competitors=complaint_competitors,
        )
        if early_competitor_complaints:
            intel["competitor_complaints"] = early_competitor_complaints[:10]

        if len(posts) == 0:
            update_validation(validation_id, {
                "status": "done",
                "verdict": "INSUFFICIENT DATA",
                "confidence": 0,
                "report": json.dumps({
                    "verdict": "INSUFFICIENT DATA",
                    "confidence": 0,
                    "summary": "No relevant posts found across any platform. Try rephrasing your idea or the market may be too niche.",
                    "evidence": [],
                    "suggestions": ["Try broader keywords", "Consider adjacent markets", "Validate through user interviews"],
                    "action_plan": [],
                    "top_posts": [],
                    "data_sources": source_counts,
                    "platform_warnings": platform_warnings,
                    "trends_data": intel.get("trends"),
                    "competition_data": intel.get("competition"),
                    "models_used": [f"{c['provider']}/{c['selected_model']}" for c in configs],
                    "debate_mode": len(configs) > 1,
                }),
                "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
            print("\n  [!] No posts found — insufficient data for validation")
            return

        # Phase 3: Synthesize via multi-model debate (with ALL intelligence)
        report = phase3_synthesize(idea_text, posts, decomposition, brain, validation_id,
                                   source_counts=source_counts, intel=intel,
                                   platform_warnings=platform_warnings,
                                   depth_config=depth_config)

        # ── Inject depth metadata into report ──
        report["depth_metadata"] = {
            "mode": depth_config["mode"],
            "label": depth_config["label"],
            "reddit_lookback": depth_config["reddit_duration"],
            "evidence_sample_budget": depth_config["evidence_sample_budget"],
            "sources_queried": list(source_counts.keys()),
            "posts_scraped": sum(source_counts.values()),
            "posts_analyzed": len(posts),
        }

        # ── Post-Phase: Pain Stream alert (auto-create for return visits) ──
        if PAIN_STREAM_AVAILABLE and user_id:
            try:
                kws = decomposition.get("keywords", [])[:5]
                if kws:
                    create_pain_alert(
                        user_id=user_id,
                        validation_id=validation_id,
                        keywords=kws,
                        subreddits=[p.get("subreddit", "") for p in posts[:20] if p.get("subreddit")],
                    )
            except Exception as e:
                print(f"  [PainStream] Alert creation skipped: {e}")

        # ── Post-Phase: Competitor Deathwatch scan ──
        if DEATHWATCH_AVAILABLE:
            try:
                comp_names = list(early_competitor_names)
                comp_landscape = report.get("competition_landscape", {})
                for comp in comp_landscape.get("direct_competitors", []):
                    name = comp.get("name", "") if isinstance(comp, dict) else str(comp)
                    if name:
                        comp_names.append(name)
                comp_names = sorted({str(name).strip() for name in comp_names if str(name).strip()})
                if comp_names:
                    complaints = scan_for_complaints(posts, comp_names)
                    if complaints:
                        save_complaints(complaints)
                        report["competitor_complaints"] = complaints[:10]
                elif early_competitor_complaints:
                    report["competitor_complaints"] = early_competitor_complaints[:10]
            except Exception as e:
                print(f"  [Deathwatch] Scan skipped: {e}")

        print("\n  [✓] Validation complete!")

    except Exception as e:
        print(f"\n  [✗] PIPELINE ERROR: {e}")
        traceback.print_exc()
        try:
            update_validation(validation_id, {
                "status": "failed",
                "error": str(e),
                "report": json.dumps({"error": str(e), "failure_stage": "validation"}),
                "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
        except Exception as persist_error:
            print(f"  [!] Failed to persist terminal validation error: {persist_error}")
            raise


# ═══════════════════════════════════════════════════════
# CLI USAGE
# ═══════════════════════════════════════════════════════
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate a startup idea")
    parser.add_argument("--idea", default="", help="The idea to validate")
    parser.add_argument("--validation-id", default="cli-test", help="Validation ID")
    parser.add_argument("--user-id", default="", help="User ID for loading AI configs")
    parser.add_argument("--config-file", default="", help="JSON config file (overrides other args)")
    args = parser.parse_args()

    # If config file provided, read from it (safe — no shell injection)
    if args.config_file:
        with open(args.config_file, "r") as f:
            config = json.load(f)
        validate_idea(
            config["validation_id"],
            config["idea"],
            config.get("user_id", ""),
            depth=config.get("depth", "quick"),
        )
    else:
        validate_idea(args.validation_id, args.idea, args.user_id)
