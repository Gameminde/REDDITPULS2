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
from collections import Counter
from datetime import datetime, timedelta, timezone
from html import unescape as html_unescape
from contextlib import contextmanager
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

# Add engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "engine"))

from env_loader import load_local_env

load_local_env(os.path.dirname(__file__))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from keyword_scraper import run_keyword_scan, discover_subreddits
from multi_brain import AIBrain, get_user_ai_configs, extract_json
from validation_depth import get_depth_config, log_depth_config
from evidence_taxonomy import apply_evidence_taxonomy, summarize_taxonomy
from occupation_router import infer_occupation_subreddits

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

try:
    from g2_scraper import G2Scraper, has_g2_api_token
    G2_AVAILABLE = True
except ImportError:
    G2_AVAILABLE = False

    def has_g2_api_token():
        return False

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
SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
)
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_KEY")
    or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("SUPABASE_SECRET_KEY")
    or os.environ.get("SUPABASE_KEY", "")
)
_VALIDATION_WRITE_SUPPRESSED = False


class ValidationPersistenceError(RuntimeError):
    """Raised when validation state cannot be persisted to Supabase."""


@contextmanager
def _validation_write_mode(suppress_writes=False):
    """Temporarily disable validation row writes for test-only runs."""
    global _VALIDATION_WRITE_SUPPRESSED
    previous = _VALIDATION_WRITE_SUPPRESSED
    if suppress_writes:
        _VALIDATION_WRITE_SUPPRESSED = True
    try:
        yield
    finally:
        _VALIDATION_WRITE_SUPPRESSED = previous


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
    if _VALIDATION_WRITE_SUPPRESSED:
        return True

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


def _supabase_rpc(function_name, payload, timeout=10):
    if _VALIDATION_WRITE_SUPPRESSED:
        return None

    if not SUPABASE_URL or not SUPABASE_KEY:
        return None

    url = f"{SUPABASE_URL}/rest/v1/rpc/{function_name}"
    response = requests.post(url, json=payload, headers=_supabase_headers(), timeout=timeout)
    if response.status_code >= 400:
        raise ValidationPersistenceError(
            f"Supabase RPC {function_name} failed with {response.status_code}: {response.text[:200]}"
        )
    return response


def _supabase_select_rows(table, params=None, timeout=15):
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []

    headers = dict(_supabase_headers())
    headers.pop("Prefer", None)
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    response = requests.get(url, params=params or {}, headers=headers, timeout=timeout)
    if response.status_code >= 400:
        raise ValidationPersistenceError(
            f"Supabase select {table} failed with {response.status_code}: {response.text[:200]}"
        )
    payload = response.json()
    return payload if isinstance(payload, list) else []


def _parse_isoish_timestamp(value):
    text = str(value or "").strip()
    if not text:
        return 0.0
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _estimate_pain_count(posts):
    if not posts:
        return 0
    pain_phrases = [
        "need help", "looking for", "recommendation", "problem", "broken", "slow", "expensive",
        "annoying", "manual", "tedious", "waste", "hours", "tired of", "hate", "frustrated",
        "struggling", "unpaid", "overdue", "chasing", "follow up", "follow-up",
    ]
    total = 0
    for post in posts:
        text = " ".join([
            str(post.get("title", "") or ""),
            str(post.get("selftext", "") or ""),
            str(post.get("body", "") or ""),
            str(post.get("what_it_proves", "") or ""),
        ]).lower()
        if any(phrase in text for phrase in pain_phrases):
            total += 1
    return total


def _normalize_db_history_post(row, matched_keywords):
    permalink = str(row.get("permalink") or row.get("url") or "").strip()
    url = str(row.get("url") or permalink).strip()
    source = str(row.get("source") or "unknown").strip().lower()
    external_id = str(row.get("id") or "").strip()
    return {
        "id": external_id,
        "external_id": external_id,
        "title": str(row.get("title") or "").strip(),
        "selftext": str(row.get("selftext") or "").strip(),
        "body": str(row.get("selftext") or "").strip(),
        "full_text": str(row.get("full_text") or "").strip(),
        "score": int(row.get("score", 0) or 0),
        "num_comments": int(row.get("num_comments", 0) or 0),
        "created_utc": str(row.get("created_utc") or row.get("scraped_at") or "").strip(),
        "source": source,
        "subreddit": str(row.get("subreddit") or "").strip(),
        "author": str(row.get("author") or "").strip(),
        "url": url,
        "permalink": permalink or url,
        "matched_keywords": matched_keywords,
        "history_origin": "db_recent_30d",
    }


def _fetch_recent_db_history_posts(keywords, required_subreddits=None, days_back=30, max_posts=120, max_scan_rows=2500):
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []

    from engine.keyword_scraper import _keyword_matches

    required_subs = {
        str(sub).strip().lower().replace("r/", "").replace("/r/", "")
        for sub in (required_subreddits or [])
        if str(sub).strip()
    }
    keyword_tokens = {
        token
        for keyword in (keywords or [])
        for token in re.findall(r"[a-z0-9]{4,}", str(keyword).lower())
        if token not in {"with", "from", "that", "this", "your", "have", "will", "just"}
    }
    source_filter = "in.(reddit,reddit_comment,reddit_connected,hackernews,producthunt,indiehackers,githubissues,g2_review,job_posting,stackoverflow,vendor_blog)"
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()

    rows = []
    batch_size = 500
    offset = 0
    while offset < max_scan_rows:
        batch = _supabase_select_rows(
            "posts",
            params={
                "select": "id,title,selftext,full_text,score,num_comments,created_utc,source,subreddit,url,permalink,author,scraped_at,matched_phrases",
                "scraped_at": f"gte.{cutoff_iso}",
                "source": source_filter,
                "order": "scraped_at.desc",
                "limit": min(batch_size, max_scan_rows - offset),
                "offset": offset,
            },
            timeout=20,
        )
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < batch_size:
            break
        offset += len(batch)

    candidates = []
    seen_ids = set()
    for row in rows:
        external_id = str(row.get("id") or "").strip()
        if not external_id or external_id in seen_ids:
            continue

        subreddit = str(row.get("subreddit") or "").strip().lower().replace("r/", "").replace("/r/", "")
        title = str(row.get("title") or "").strip()
        full_text = " ".join([
            title,
            str(row.get("selftext") or "").strip(),
            str(row.get("full_text") or "").strip(),
        ]).strip()
        haystack = full_text.lower()
        matched_keywords = [
            str(keyword).strip()
            for keyword in (keywords or [])
            if str(keyword).strip() and _keyword_matches(str(keyword).strip(), haystack)
        ]
        token_overlap = sorted({token for token in keyword_tokens if token in haystack})

        matched_phrases = [
            str(item).strip()
            for item in (row.get("matched_phrases") or [])
            if str(item).strip()
        ]
        phrase_overlap = [
            phrase for phrase in matched_phrases
            if any(_keyword_matches(str(keyword).strip(), phrase.lower()) for keyword in (keywords or []) if str(keyword).strip())
        ]

        if not matched_keywords and not phrase_overlap and len(token_overlap) < 2:
            continue

        seen_ids.add(external_id)
        relevance = len(matched_keywords) * 4 + len(phrase_overlap) * 2 + len(token_overlap) * 1.25
        relevance += 2 if subreddit and subreddit in required_subs else 0
        relevance += min(int(row.get("score", 0) or 0), 30) / 10
        relevance += min(int(row.get("num_comments", 0) or 0), 20) / 5
        if str(row.get("source") or "").strip().lower() in {"g2_review", "job_posting", "githubissues"}:
            relevance += 1
        if relevance < 2.5:
            continue

        normalized = _normalize_db_history_post(
            row,
            matched_keywords or phrase_overlap[:3] or token_overlap[:4],
        )
        normalized["_db_history_relevance"] = round(relevance, 2)
        normalized["_db_history_scraped_at"] = str(row.get("scraped_at") or "").strip()
        candidates.append(normalized)

    candidates.sort(
        key=lambda post: (
            float(post.get("_db_history_relevance", 0) or 0),
            int(post.get("score", 0) or 0),
            int(post.get("num_comments", 0) or 0),
            _parse_isoish_timestamp(post.get("_db_history_scraped_at") or post.get("created_utc")),
        ),
        reverse=True,
    )
    return candidates[:max_posts]


def log_progress(validation_id, event):
    """Append a structured progress event to idea_validations.progress_log.

    Progress logging must never crash a validation run.
    """
    if _VALIDATION_WRITE_SUPPRESSED or not validation_id:
        return False

    safe_event = dict(event or {})
    safe_event["ts"] = int(time.time())

    try:
        _supabase_rpc(
            "append_validation_progress_log",
            {
                "p_validation_id": validation_id,
                "p_event": safe_event,
            },
            timeout=8,
        )
        return True
    except Exception as exc:
        print(f"  [!] Progress log skipped: {exc}")
        return False


def _sanitize_reddit_lab_context(reddit_lab):
    if not isinstance(reddit_lab, dict):
        return None
    return {
        "enabled": bool(reddit_lab.get("enabled")),
        "connection_id": reddit_lab.get("connection_id"),
        "reddit_username": reddit_lab.get("reddit_username"),
        "account_mode": reddit_lab.get("account_mode"),
        "source_pack_id": reddit_lab.get("source_pack_id"),
        "source_pack_name": reddit_lab.get("source_pack_name"),
        "source_pack_subreddits": list(reddit_lab.get("source_pack_subreddits") or []),
        "use_connected_context": bool(reddit_lab.get("use_connected_context")),
    }


def _parse_reddit_listing_posts(payload, keywords, source_name):
    from keyword_scraper import _keyword_matches

    children = payload.get("data", {}).get("children", []) if isinstance(payload, dict) else []
    posts = []
    for child in children:
        if child.get("kind") != "t3":
            continue
        data = child.get("data", {}) or {}
        full_text = f"{data.get('title', '')} {data.get('selftext', '')[:3000]}".strip()
        if len(full_text) < 20:
            continue
        text_lower = full_text.lower()
        matched_kw = [kw for kw in keywords if _keyword_matches(kw, text_lower)]
        if not matched_kw:
            continue
        posts.append({
            "id": data.get("id", ""),
            "external_id": data.get("name", data.get("id", "")),
            "title": data.get("title", ""),
            "selftext": data.get("selftext", "")[:3000],
            "body": data.get("selftext", "")[:3000],
            "full_text": full_text,
            "score": data.get("score", 0),
            "upvote_ratio": data.get("upvote_ratio", 0.5),
            "num_comments": data.get("num_comments", 0),
            "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(data.get("created_utc", 0))),
            "subreddit": data.get("subreddit", ""),
            "permalink": f"https://reddit.com{data.get('permalink', '')}",
            "author": data.get("author", "[deleted]"),
            "url": data.get("url", ""),
            "matched_keywords": matched_kw,
            "source": source_name,
        })
    return posts


def _fetch_connected_reddit_posts(access_token, keywords, subreddits=None, max_posts=60):
    if not access_token or not keywords:
        return []

    headers = {
        "Authorization": f"Bearer {access_token}",
        "User-Agent": "RedditPulse/1.0 (validation connected reddit lane)",
    }

    queries = []
    if subreddits:
        for sub in list(dict.fromkeys(subreddits))[:8]:
            queries.append(("sub", sub))
    queries.append(("global", None))

    posts = []
    seen = set()
    query = " OR ".join([f'"{kw}"' if " " in kw else kw for kw in keywords[:6]])
    for mode, subreddit in queries:
        if len(posts) >= max_posts:
            break
        if mode == "sub" and subreddit:
            url = f"https://oauth.reddit.com/r/{subreddit}/search"
            params = {"q": query, "sort": "new", "restrict_sr": "true", "limit": 25, "raw_json": 1, "t": "month"}
        else:
            url = "https://oauth.reddit.com/search"
            params = {"q": query, "sort": "new", "limit": 25, "raw_json": 1, "t": "month"}
        try:
            response = requests.get(url, headers=headers, params=params, timeout=15)
            if response.status_code >= 400:
                continue
            batch = _parse_reddit_listing_posts(response.json(), keywords, "reddit_connected")
            for post in batch:
                key = post.get("external_id") or post.get("id")
                if key and key not in seen:
                    seen.add(key)
                    posts.append(post)
        except Exception as exc:
            print(f"  [Reddit Connected] fetch failed: {exc}")
    return posts[:max_posts]


def _fetch_proxy_reddit_posts(proxy_url, keywords, subreddits=None, max_posts=40):
    if not proxy_url or not keywords:
        return []

    proxies = {"http": proxy_url, "https": proxy_url}
    headers = {
        "User-Agent": "RedditPulse/1.0 (validation proxy reddit lane)",
        "Accept": "application/json",
    }
    query = " OR ".join([f'"{kw}"' if " " in kw else kw for kw in keywords[:6]])
    posts = []
    seen = set()
    from keyword_scraper import _keyword_matches

    targets = [(f"https://www.reddit.com/r/{sub}/search.json", {"q": query, "sort": "new", "restrict_sr": "true", "limit": 20, "raw_json": 1, "t": "month"}) for sub in list(dict.fromkeys(subreddits or []))[:6]]
    targets.append(("https://www.reddit.com/search.json", {"q": query, "sort": "new", "limit": 20, "raw_json": 1, "t": "month"}))

    for url, params in targets:
        if len(posts) >= max_posts:
            break
        try:
            response = requests.get(url, headers=headers, params=params, proxies=proxies, timeout=18)
            if response.status_code >= 400:
                continue
            children = response.json().get("data", {}).get("children", [])
            for child in children:
                if child.get("kind") != "t3":
                    continue
                data = child.get("data", {}) or {}
                full_text = f"{data.get('title', '')} {data.get('selftext', '')[:3000]}".strip()
                text_lower = full_text.lower()
                matched_kw = [kw for kw in keywords if _keyword_matches(kw, text_lower)]
                key = data.get("name") or data.get("id")
                if not key or key in seen or not matched_kw:
                    continue
                seen.add(key)
                posts.append({
                    "id": data.get("id", ""),
                    "external_id": key,
                    "title": data.get("title", ""),
                    "selftext": data.get("selftext", "")[:3000],
                    "body": data.get("selftext", "")[:3000],
                    "full_text": full_text,
                    "score": data.get("score", 0),
                    "upvote_ratio": data.get("upvote_ratio", 0.5),
                    "num_comments": data.get("num_comments", 0),
                    "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(data.get("created_utc", 0))),
                    "subreddit": data.get("subreddit", ""),
                    "permalink": f"https://reddit.com{data.get('permalink', '')}",
                    "author": data.get("author", "[deleted]"),
                    "url": data.get("url", ""),
                    "matched_keywords": matched_kw,
                    "source": "reddit_proxy",
                })
        except Exception as exc:
            print(f"  [Reddit Proxy] fetch failed: {exc}")
    return posts[:max_posts]


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
    
    # FIX 2: Depth-aware subreddit discovery budget
    if depth_config.get("mode") == "deep":
        sub_cap = 20
    elif depth_config.get("mode") == "investigation":
        sub_cap = 30
    else:
        # Quick or default
        sub_cap = 8
        
    depth_config["subreddit_cap"] = sub_cap # Ensure it propagates
    
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
    log_progress(validation_id, {
        "phase": "decomposing",
        "count": len(result["keywords"]),
        "message": (
            f"Decomposition complete: {len(result['keywords'])} keywords, "
            f"{len(result['competitors'])} competitors, audience mapped"
        ),
    })

    print(f"  [✓] Keywords: {result['keywords']}")
    print(f"  [✓] Colloquial Keywords: {result['colloquial_keywords']}")
    print(f"  [✓] Target Subreddits: {result['subreddits']}")
    print(f"  [✓] Competitors: {result['competitors']}")
    print(f"  [✓] Audience: {result['audience']}")
    return result


def _fallback_ai_configs():
    """Load AI configs from local env vars for CLI/test usage."""
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
    return fallback_configs


def _dummy_test_configs():
    """Deterministic in-memory configs for unit tests that patch AI calls."""
    return [
        {
            "id": "test-bull",
            "provider": "nvidia",
            "api_key": "test-key",
            "selected_model": "test-bull-model",
            "is_active": True,
            "priority": 1,
        },
        {
            "id": "test-skeptic",
            "provider": "nvidia",
            "api_key": "test-key",
            "selected_model": "test-skeptic-model",
            "is_active": True,
            "priority": 2,
        },
        {
            "id": "test-analyst",
            "provider": "openrouter",
            "api_key": "test-key",
            "selected_model": "test-analyst-model",
            "is_active": True,
            "priority": 3,
        },
    ]


def load_validation_configs(user_id="", test_mode=False):
    """Load AI configs for validation runs with a safe test fallback."""
    configs = []
    if user_id:
        configs = get_user_ai_configs(user_id)

    if not configs:
        configs = _fallback_ai_configs()

    if not configs and test_mode:
        configs = _dummy_test_configs()

    return configs


def run_phase1(
    idea_text,
    brain=None,
    validation_id="test-phase1",
    depth="quick",
    user_id="",
    test_mode=True,
    configs=None,
):
    """Test-friendly wrapper around Phase 1 decomposition."""
    depth_config = get_depth_config(depth)
    with _validation_write_mode(test_mode):
        brain = brain or AIBrain(configs or load_validation_configs(user_id=user_id, test_mode=test_mode))
        return phase1_decompose(idea_text, brain, validation_id, depth_config=depth_config)


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
    "g2_review": 1.25,     # Real buyer complaint language from competitor reviews
    "job_posting": 1.15,   # Employer-written process/pain language
    "vendor_blog": 0.9,    # Useful context, but vendor-authored not buyer-native
}

NON_DEV_ICP_KEYWORDS = [
    "accounting", "bookkeeping", "legal", "law firm", "medical", "healthcare",
    "restaurant", "retail", "small business", "firm", "agency", "clinic",
    "dentist", "real estate", "hr", "human resources", "finance",
    "construction", "contractor", "builder", "hospitality", "property",
    "landlord", "marketing", "campaign",
]

ICP_TRIGGER_MAP = {
    "B2B_HR": [
        "hr", "human resources", "recruiting", "onboarding",
        "payroll", "benefits", "people ops", "talent",
        "employee", "workforce", "hris", "ats",
    ],
    "B2B_CONSTRUCTION": [
        "construction", "contractor", "home builder", "general contractor",
        "subcontractor", "jobsite", "civil engineering", "foreman", "estimator",
    ],
    "B2B_FINANCE": [
        "accounting", "bookkeeping", "invoice", "payroll",
        "tax", "cfo", "finance team", "quickbooks",
    ],
    "B2B_LEGAL": [
        "legal", "lawyer", "attorney", "paralegal", "law firm",
        "litigation", "contract", "compliance", "legaltech",
    ],
    "B2B_MARKETING": [
        "marketing", "cmo", "attribution", "campaign",
        "martech", "lead generation", "content marketing",
        "seo", "social media manager", "ads", "lead gen",
    ],
    "B2B_SALES": [
        "sales", "crm", "pipeline", "outbound",
        "prospecting", "account executive", "revenue team", "quota",
    ],
    "B2B_OPS": [
        "operations", "ops", "workflow", "sop",
        "process management", "back office", "knowledge base", "documentation",
    ],
    "DEV_TOOL": [
        "api", "sdk", "developer", "code", "programming",
        "software engineer", "devops", "ci/cd", "machine learning model",
        "llm", "ai model", "open source", "engineering",
    ],
    "B2B_RESTAURANT": [
        "restaurant", "food service", "pos", "kitchen",
        "cafe", "hospitality", "menu", "dining",
    ],
    "B2B_REALESTATE": [
        "real estate", "property", "agent", "broker",
        "landlord", "tenant", "leasing", "reit",
    ],
    "CONSUMER": [
        "personal", "individual", "student", "habit",
        "lifestyle", "daily routine", "self improvement",
    ],
    "ECOMMERCE": [
        "ecommerce", "shopify", "etsy", "amazon seller",
        "dropshipping", "inventory", "fulfillment", "storefront",
    ],
}

ICP_SUBREDDITS = {
    "B2B_HR": [
        "humanresources", "AskHR", "recruiting",
        "hrtech", "peopleops", "smallbusiness",
        "Entrepreneur", "WorkAdvice",
    ],
    "B2B_CONSTRUCTION": [
        "ConstructionManagers", "ConstructionTech",
        "construction", "civilengineering",
        "projectmanagement", "Homebuilding",
        "smallbusiness",
    ],
    "B2B_FINANCE": [
        "Accounting", "bookkeeping", "smallbusiness",
        "tax", "FreshBooks", "QuickBooks", "Upwork", "freelance",
    ],
    "B2B_LEGAL": [
        "paralegal", "LawFirm", "legaladvice",
        "lawyers", "LegalTech", "law",
    ],
    "B2B_MARKETING": [
        "marketing", "B2Bmarketing", "marketingops",
        "SEO", "socialmedia", "PPC",
    ],
    "B2B_SALES": [
        "sales", "Entrepreneur", "smallbusiness",
        "B2BSales", "startups", "SaaS",
    ],
    "B2B_OPS": [
        "operations", "Notion", "smallbusiness",
        "Entrepreneur", "productivity", "sysadmin",
    ],
    "DEV_TOOL": [
        "programming", "webdev", "cscareerquestions",
        "MachineLearning", "LocalLLaMA", "devops",
        "learnprogramming", "softwareengineering",
    ],
    "B2B_RESTAURANT": [
        "restaurantowners", "kitchenconfidential",
        "Restaurant", "FoodService",
    ],
    "B2B_REALESTATE": [
        "RealEstateTechnology", "realestate",
        "RealEstateInvesting", "landlord",
    ],
    "CONSUMER": [
        "productivity", "getdisciplined", "selfimprovement",
        "LifeProTips", "personalfinance", "Frugal",
    ],
    "ECOMMERCE": [
        "shopify", "Etsy", "FulfillmentByAmazon",
        "ecommerce", "smallbusiness", "Entrepreneur",
    ],
    "B2B_GENERAL": [
        "smallbusiness", "Entrepreneur", "startups",
        "SaaS", "microsaas",
    ],
}

VENDOR_BLOGS = {
    "B2B_HR": [
        "https://www.shrm.org/topics-tools",
        "https://www.bamboohr.com/blog",
        "https://www.lattice.com/library",
    ],
    "B2B_FINANCE": [
        "https://www.billtrust.com/resources/blog",
        "https://quickbooks.intuit.com/r",
        "https://www.freshbooks.com/blog",
    ],
    "B2B_CONSTRUCTION": [
        "https://www.procore.com/jobsite",
        "https://www.buildertrend.com/blog",
        "https://www.constructconnect.com/blog",
    ],
    "B2B_LEGAL": [
        "https://www.clio.com/blog",
        "https://www.mycase.com/blog",
    ],
}

ADZUNA_API_TEMPLATE = "https://api.adzuna.com/v1/api/jobs/{country}/search/{page}"
LOW_VOLUME_ICPS = [
    "B2B_CONSTRUCTION", "B2B_LEGAL",
    "B2B_RESTAURANT", "B2B_REALESTATE",
]
ADZUNA_PAIN_TERMS = [
    "streamline", "manage", "track", "automate", "reduce",
    "improve", "solve", "handle", "process",
]
KNOWN_SOFTWARE_TERMS = [
    "quickbooks", "expensify", "concur", "ramp", "procore", "netsuite",
    "sage", "xero", "excel", "notion", "slack", "jira", "asana",
    "bill.com", "stripe", "adp", "bamboohr", "clio", "mycase",
]
_ROBOTS_CACHE = {}
_VENDOR_LAST_REQUEST_AT = {}

NOISE_SUBREDDITS_FOR_NON_DEV = {
    "machinelearning", "localllama", "openai",
    "chatgpt", "artificial", "datascience",
    "webdev", "programming", "learnprogramming",
    "adhd", "depression", "teenagers", "books",
    "3dprinting", "gaming", "languagetechnology",
}


def _normalized_subreddit_name(value):
    return str(value or "").strip().lower().replace("r/", "").replace("/r/", "")


def classify_icp(idea_text, audience, keywords):
    text_parts = [idea_text or "", audience or ""] + list(keywords or [])
    haystack = " ".join(str(part) for part in text_parts if part).lower()
    scores = {}
    for icp, triggers in ICP_TRIGGER_MAP.items():
        scores[icp] = sum(1 for trigger in triggers if trigger.lower() in haystack)

    vertical_priority = [
        "B2B_CONSTRUCTION",
        "B2B_LEGAL",
        "B2B_RESTAURANT",
        "B2B_REALESTATE",
        "B2B_HR",
    ]
    vertical_matches = [(icp, scores.get(icp, 0)) for icp in vertical_priority if scores.get(icp, 0) > 0]
    if vertical_matches:
        vertical_matches.sort(key=lambda item: (item[1], -vertical_priority.index(item[0])), reverse=True)
        return vertical_matches[0][0]

    icp_priority = {
        "DEV_TOOL": 9,
        "B2B_CONSTRUCTION": 8,
        "B2B_LEGAL": 7,
        "B2B_FINANCE": 6,
        "B2B_HR": 5,
        "B2B_RESTAURANT": 4,
        "B2B_REALESTATE": 3,
        "B2B_MARKETING": 2,
        "B2B_SALES": 1,
    }

    ranked = sorted(
        scores.items(),
        key=lambda item: (item[1], icp_priority.get(item[0], 0), item[0].startswith("B2B_")),
        reverse=True,
    )
    best_icp, best_score = ranked[0]
    return best_icp if best_score > 0 else "B2B_GENERAL"


def _route_forced_subreddits(icp, ai_suggested_subreddits):
    whitelist = list(ICP_SUBREDDITS.get(icp, ICP_SUBREDDITS["B2B_GENERAL"]))
    canonical = {_normalized_subreddit_name(sub): sub for sub in whitelist}
    routed = list(whitelist)
    seen = set(canonical.keys())

    for subreddit in ai_suggested_subreddits or []:
        normalized = _normalized_subreddit_name(subreddit)
        if not normalized:
            continue
        if icp != "DEV_TOOL" and normalized in NOISE_SUBREDDITS_FOR_NON_DEV:
            continue
        if normalized in canonical and normalized not in seen:
            routed.append(canonical[normalized])
            seen.add(normalized)

    return routed


def _augment_subreddits_with_occupation_map(idea_text, audience, current_subreddits, limit=6):
    routed = [
        str(sub).strip().replace("r/", "").replace("/r/", "")
        for sub in (current_subreddits or [])
        if str(sub).strip()
    ]
    occupation_match = infer_occupation_subreddits(audience or "", idea_text=idea_text or "", limit=limit)
    for subreddit in occupation_match.get("subreddits", []):
        clean = str(subreddit).strip().replace("r/", "").replace("/r/", "")
        if clean and clean.lower() not in {sub.lower() for sub in routed}:
            routed.append(clean)
    return routed, occupation_match


def _slugify_competitor_name(value):
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return slug[:80]


G2_SLUG_ALIASES = {
    "expensify": ["expensify-1"],
    "quickbooks": ["quickbooks-online"],
    "quickbooks-online": ["quickbooks"],
    "procore": ["procore-1"],
    "procore-1": ["procore"],
    "concur": ["sap-concur", "concur-1"],
    "ramp": ["ramp-1"],
}


def _candidate_g2_slugs(competitor_name):
    base = _slugify_competitor_name(competitor_name)
    if not base:
        return []

    candidates = [base]
    candidates.extend(G2_SLUG_ALIASES.get(base, []))
    if not base.endswith("-1"):
        candidates.append(f"{base}-1")

    deduped = []
    seen = set()
    for candidate in candidates:
        clean = str(candidate or "").strip().lower()
        if clean and clean not in seen:
            seen.add(clean)
            deduped.append(clean)
    return deduped


def _g2_reviews_to_posts(competitor_name, reviews, product_slug=None):
    posts = []
    competitor_slug = str(product_slug or _slugify_competitor_name(competitor_name) or "").strip()
    for idx, review in enumerate(reviews, start=1):
        rating = int(review.get("rating") or 0)
        if rating != 3:
            continue
        dislikes = str(review.get("dislikes") or "").strip()
        if not dislikes:
            continue
        title = str(review.get("title") or "").strip() or f"{competitor_name} 3-star review"
        full_text = f"{title}. {dislikes}".strip()
        posts.append({
            "id": f"g2-{competitor_slug}-{idx}",
            "external_id": f"g2-{competitor_slug}-{idx}",
            "title": title,
            "selftext": dislikes,
            "body": dislikes,
            "full_text": full_text,
            "score": 3,
            "num_comments": 0,
            "created_utc": review.get("date") or "",
            "source": "g2_review",
            "subreddit": f"g2/{competitor_slug}",
            "url": f"https://www.g2.com/products/{competitor_slug}/reviews",
            "permalink": f"https://www.g2.com/products/{competitor_slug}/reviews",
            "matched_keywords": [],
            "competitor": competitor_name,
            "rating": rating,
            "review_type": "3_star",
            "industry": review.get("industry") or "",
            "company_size": review.get("company_size") or "",
        })
    return posts


def _fetch_g2_review_posts(icp, known_competitors, timeout_seconds=60):
    if not G2_AVAILABLE:
        return []
    if not str(icp or "").startswith("B2B_"):
        return []

    start = time.time()
    posts = []
    scraper = G2Scraper()
    for competitor in list(known_competitors or [])[:3]:
        if time.time() - start >= timeout_seconds:
            print(f"  [G2] Timeout reached after {timeout_seconds}s - continuing without more reviews")
            break
        candidate_slugs = _candidate_g2_slugs(competitor)
        if not candidate_slugs:
            continue
        for slug in candidate_slugs:
            if time.time() - start >= timeout_seconds:
                print(f"  [G2] Timeout reached after {timeout_seconds}s while trying {competitor} - stopping")
                break
            url = f"https://www.g2.com/products/{slug}/reviews"
            print(f"  [G2] Trying {competitor} -> {url}")
            try:
                reviews = scraper.scrape_competitor_reviews(slug, max_reviews=50, competitor_name=competitor)
                if not reviews:
                    status = scraper.last_status_code or "unknown"
                    detail = f"status={status}"
                    if getattr(scraper, "last_method", ""):
                        detail += f", method={scraper.last_method}"
                    if scraper.last_error:
                        detail += f", error={scraper.last_error}"
                    print(f"  [G2] 0 reviews for {competitor} at {url} ({detail})")
                    continue

                matched_posts = _g2_reviews_to_posts(competitor, reviews, product_slug=slug)
                if matched_posts:
                    print(
                        f"  [G2] {competitor}: {len(reviews)} raw reviews, "
                        f"{len(matched_posts)} kept as 3-star signal posts via slug '{slug}' "
                        f"({getattr(scraper, 'last_method', 'unknown')})"
                    )
                    posts.extend(matched_posts)
                    break

                print(
                    f"  [G2] {competitor}: {len(reviews)} raw reviews but 0 matched 3-star filter at {url}"
                )
            except Exception as exc:
                print(f"  [G2] Failed for {competitor} at {url}: {str(exc)[:100]}")
    return posts


def _collect_meaningful_terms(idea_text="", audience="", keywords=None):
    raw_terms = []
    raw_terms.extend(re.findall(r"[a-zA-Z0-9][a-zA-Z0-9/+.-]{3,}", str(idea_text or "").lower()))
    raw_terms.extend(re.findall(r"[a-zA-Z0-9][a-zA-Z0-9/+.-]{3,}", str(audience or "").lower()))
    for keyword in keywords or []:
        raw_terms.extend(re.findall(r"[a-zA-Z0-9][a-zA-Z0-9/+.-]{3,}", str(keyword or "").lower()))
    stop = {"with", "from", "that", "this", "have", "your", "into", "their", "would", "there"}
    deduped = []
    seen = set()
    for term in raw_terms:
        clean = term.strip(".,!?()[]{}\"'").lower()
        if len(clean) < 4 or clean in stop or clean in seen:
            continue
        seen.add(clean)
        deduped.append(clean)
    return deduped


def _strip_html_to_text(value):
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", str(value or ""))
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html_unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _extract_pain_sentences(text, max_sentences=3):
    sentences = re.split(r"(?<=[.!?])\s+", str(text or ""))
    matches = [
        sentence.strip()
        for sentence in sentences
        if sentence.strip() and any(term in sentence.lower() for term in ADZUNA_PAIN_TERMS)
    ]
    return matches[:max_sentences]


def _extract_required_tools(text):
    haystack = str(text or "").lower()
    tools = [tool for tool in KNOWN_SOFTWARE_TERMS if tool in haystack]
    return list(dict.fromkeys(tools))[:10]


def _adzuna_job_to_post(job, keywords, icp):
    description = _strip_html_to_text(job.get("description") or "")[:500]
    pain_language = _extract_pain_sentences(description)
    title = str(job.get("title") or "").strip()
    if not title:
        return None
    combined = " ".join([title, description, " ".join(pain_language)]).strip()
    matched_keywords = [kw for kw in (keywords or []) if str(kw or "").lower() in combined.lower()]
    redirect_url = str(job.get("redirect_url") or "").strip()
    job_id = str(job.get("id") or redirect_url or title).strip()
    if not job_id:
        return None
    return {
        "id": f"job-{job_id}",
        "external_id": f"job-{job_id}",
        "title": title,
        "selftext": description,
        "body": description,
        "full_text": combined[:900],
        "score": 4 if pain_language else 3,
        "num_comments": 0,
        "created_utc": job.get("created") or "",
        "source": "job_posting",
        "subreddit": f"adzuna/{str(icp or 'general').lower()}",
        "url": redirect_url or job.get("adref") or "",
        "permalink": redirect_url or job.get("adref") or "",
        "matched_keywords": matched_keywords,
        "required_tools": _extract_required_tools(description),
        "pain_language": pain_language,
        "company": ((job.get("company") or {}).get("display_name") if isinstance(job.get("company"), dict) else ""),
    }


def _fetch_adzuna_job_posts(keywords, icp, timeout_seconds=30, max_posts=50):
    app_id = os.environ.get("ADZUNA_APP_ID", "").strip()
    app_key = os.environ.get("ADZUNA_APP_KEY", "").strip()
    country = os.environ.get("ADZUNA_COUNTRY", "us").strip().lower() or "us"
    if not app_id or not app_key:
        print("  [Jobs] Skipped - ADZUNA_APP_ID/ADZUNA_APP_KEY missing")
        print(f"  [Jobs] Endpoint: {ADZUNA_API_TEMPLATE.format(country=country, page=1)}?app_id=...&app_key=...&what=<query>&results_per_page=10&content-type=application/json")
        return []

    start = time.time()
    posts = []
    seen = set()
    queries = [str(kw).strip() for kw in (keywords or []) if str(kw).strip()][:5]
    session = requests.Session()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "close",
    }

    def _extend_posts_from_response(response, query):
        if response.status_code != 200:
            return False, f"status={response.status_code}"
        payload = response.json() or {}
        added = 0
        for job in payload.get("results", []) or []:
            post = _adzuna_job_to_post(job, keywords, icp)
            if not post:
                continue
            dedupe_key = post.get("external_id") or post.get("url") or post.get("title")
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            posts.append(post)
            added += 1
            if len(posts) >= max_posts:
                break
        return True, f"ok:{query}:{added}"

    for query in queries:
        if len(posts) >= max_posts or time.time() - start >= timeout_seconds:
            break
        endpoint = ADZUNA_API_TEMPLATE.format(country=country, page=1)
        params = {
            "app_id": app_id,
            "app_key": app_key,
            "what": query,
            "results_per_page": min(10, max_posts - len(posts)),
            "content-type": "application/json",
        }
        last_error = ""
        for attempt in range(3):
            try:
                response = session.get(endpoint, params=params, headers=headers, timeout=15)
                consumed, last_error = _extend_posts_from_response(response, query)
                if not consumed:
                    if response.status_code >= 500 and attempt < 2:
                        time.sleep(1.5 * (attempt + 1))
                        continue
                    print(f"  [Jobs] Query '{query}' failed: {last_error}")
                    break
                break
            except requests.exceptions.RequestException as exc:
                last_error = f"{type(exc).__name__}: {str(exc)[:120]}"
                try:
                    fallback_response = requests.get(endpoint, params=params, headers=headers, timeout=20)
                    consumed, fallback_detail = _extend_posts_from_response(fallback_response, query)
                    if consumed:
                        break
                    last_error = f"{last_error}; fallback={fallback_detail}"
                except requests.exceptions.RequestException as fallback_exc:
                    last_error = (
                        f"{last_error}; fallback={type(fallback_exc).__name__}: "
                        f"{str(fallback_exc)[:120]}"
                    )
                if attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                print(f"  [Jobs] Query '{query}' failed: {last_error}")
        time.sleep(0.4)
    print(f"  [Jobs] {len(posts)} job postings found across {len(queries)} queries")
    return posts


def _robots_parser_for(url):
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    if robots_url in _ROBOTS_CACHE:
        return _ROBOTS_CACHE[robots_url]
    parser = RobotFileParser()
    parser.set_url(robots_url)
    try:
        parser.read()
    except Exception:
        parser = None
    _ROBOTS_CACHE[robots_url] = parser
    return parser


def _vendor_can_fetch(url, user_agent="RedditPulseBot/1.0"):
    parser = _robots_parser_for(url)
    if parser is None:
        return False
    try:
        return parser.can_fetch(user_agent, url)
    except Exception:
        return False


def _rate_limited_get(url, user_agent="RedditPulseBot/1.0", timeout=15):
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    last_request = _VENDOR_LAST_REQUEST_AT.get(host, 0.0)
    wait = 2.0 - (time.time() - last_request)
    if wait > 0:
        time.sleep(wait)
    response = requests.get(
        url,
        headers={"User-Agent": user_agent, "Accept-Language": "en-US,en;q=0.9"},
        timeout=timeout,
    )
    _VENDOR_LAST_REQUEST_AT[host] = time.time()
    return response


def _extract_internal_links(html, base_url):
    base_host = urlparse(base_url).netloc.lower()
    links = []
    seen = set()
    for href in re.findall(r'href=["\\\']([^"\\\']+)["\\\']', str(html or ""), re.I):
        if href.startswith(("mailto:", "javascript:", "#")):
            continue
        absolute = urljoin(base_url, href)
        parsed = urlparse(absolute)
        if parsed.scheme not in {"http", "https"}:
            continue
        if parsed.netloc.lower() != base_host:
            continue
        normalized = absolute.split("#", 1)[0]
        if normalized in seen:
            continue
        seen.add(normalized)
        links.append(normalized)
    return links


def _extract_title_from_html(html, fallback=""):
    for pattern in [
        r'(?is)<meta[^>]+property=["\\\']og:title["\\\'][^>]+content=["\\\']([^"\\\']+)["\\\']',
        r'(?is)<title[^>]*>(.*?)</title>',
        r'(?is)<h1[^>]*>(.*?)</h1>',
    ]:
        match = re.search(pattern, str(html or ""))
        if match:
            return _strip_html_to_text(match.group(1))
    return fallback


def _fetch_vendor_blog_posts(icp, idea_text, keywords, max_posts=20):
    blog_roots = VENDOR_BLOGS.get(icp, [])
    if not blog_roots:
        return []

    keyword_terms = _collect_meaningful_terms(idea_text=idea_text, keywords=keywords)
    posts = []
    seen_urls = set()

    for root_url in blog_roots:
        if len(posts) >= max_posts:
            break
        if not _vendor_can_fetch(root_url):
            print(f"  [Blogs] Skipped by robots.txt: {root_url}")
            continue
        try:
            response = _rate_limited_get(root_url)
            if response.status_code != 200:
                print(f"  [Blogs] Failed index {root_url}: status={response.status_code}")
                continue
            links = _extract_internal_links(response.text, root_url)
        except Exception as exc:
            print(f"  [Blogs] Failed index {root_url}: {str(exc)[:100]}")
            continue

        ranked_links = sorted(
            links,
            key=lambda link: sum(1 for term in keyword_terms if term in link.lower()),
            reverse=True,
        )
        selected_links = [link for link in ranked_links if any(term in link.lower() for term in keyword_terms)][:5]

        for article_url in selected_links:
            if len(posts) >= max_posts or article_url in seen_urls:
                continue
            if not _vendor_can_fetch(article_url):
                continue
            try:
                article_response = _rate_limited_get(article_url)
                if article_response.status_code != 200:
                    continue
                article_html = article_response.text
                title = _extract_title_from_html(article_html, fallback=article_url.rstrip("/").split("/")[-1].replace("-", " "))
                excerpt = _strip_html_to_text(article_html)[:300]
                combined = f"{title}. {excerpt}".strip()
                if not any(term in combined.lower() for term in keyword_terms):
                    continue
                seen_urls.add(article_url)
                posts.append({
                    "id": f"vendor-{len(posts)+1}-{abs(hash(article_url))}",
                    "external_id": f"vendor-{abs(hash(article_url))}",
                    "title": title,
                    "selftext": excerpt,
                    "body": excerpt,
                    "full_text": combined[:700],
                    "score": 3,
                    "num_comments": 0,
                    "created_utc": "",
                    "source": "vendor_blog",
                    "subreddit": urlparse(article_url).netloc.lower(),
                    "url": article_url,
                    "permalink": article_url,
                    "matched_keywords": [kw for kw in (keywords or []) if str(kw or "").lower() in combined.lower()],
                })
            except Exception as exc:
                print(f"  [Blogs] Failed article {article_url}: {str(exc)[:100]}")

    print(f"  [Blogs] {len(posts)} vendor blog excerpts found")
    return posts[:max_posts]


def _fetch_reddit_comment_posts(subreddits, keywords, icp, timeout_seconds=30, max_posts=80, days_back=30, seed_posts=None):
    return _fetch_reddit_comment_posts_combined(
        subreddits,
        keywords,
        icp,
        timeout_seconds=timeout_seconds,
        max_posts=max_posts,
        days_back=days_back,
        seed_posts=seed_posts,
    )


def _fetch_live_reddit_comment_posts(seed_posts, keywords, timeout_seconds=12, max_posts=40):
    from engine.keyword_scraper import _keyword_matches

    start = time.time()
    results = []
    seen = set()
    comment_limit = max(3, min(8, max_posts // 4 or 3))
    candidate_posts = sorted(
        [
            post for post in (seed_posts or [])
            if str(post.get("source") or "").lower().startswith("reddit")
            and str(post.get("permalink") or "").strip()
            and int(post.get("num_comments", 0) or 0) > 0
        ],
        key=lambda post: (
            int(post.get("score", 0) or 0),
            int(post.get("num_comments", 0) or 0),
        ),
        reverse=True,
    )[:12]

    headers = {
        "User-Agent": "RedditPulse/1.0 (validation comment fetch)",
        "Accept": "application/json",
    }

    try:
        from engine.reddit_scrapecreators import is_available as provider_available, fetch_top_comments
    except Exception:
        provider_available = lambda: False
        fetch_top_comments = None

    if provider_available() and fetch_top_comments:
        try:
            provider_comments = fetch_top_comments(
                candidate_posts,
                keywords,
                max_posts=max_posts,
                per_post_limit=comment_limit,
            )
        except Exception:
            provider_comments = []

        for comment in provider_comments:
            external_id = str(comment.get("external_id") or comment.get("id") or "").strip()
            if not external_id or external_id in seen:
                continue
            seen.add(external_id)
            results.append(comment)

        if results and len(results) >= max_posts:
            print(f"  [Comments] {len(results)} provider Reddit comments found from seed posts")
            return results[:max_posts]

    for post in candidate_posts:
        if time.time() - start >= timeout_seconds or len(results) >= max_posts:
            break

        permalink = str(post.get("permalink") or "").strip()
        json_url = permalink.rstrip("/") + ".json"
        try:
            response = requests.get(
                json_url,
                headers=headers,
                params={"limit": comment_limit, "depth": 1, "sort": "top", "raw_json": 1},
                timeout=10,
            )
        except Exception:
            continue

        if response.status_code != 200:
            continue

        try:
            payload = response.json()
        except Exception:
            continue

        if not isinstance(payload, list) or len(payload) < 2:
            continue

        for child in (((payload[1] or {}).get("data") or {}).get("children") or []):
            if time.time() - start >= timeout_seconds or len(results) >= max_posts:
                break
            if child.get("kind") != "t1":
                continue
            data = child.get("data") or {}
            body = str(data.get("body") or "").strip()
            if len(body) < 40 or body in ("[removed]", "[deleted]"):
                continue
            external_id = str(data.get("id") or "").strip()
            if not external_id or external_id in seen:
                continue

            text_lower = f"{post.get('title', '')} {body}".lower()
            matched = [kw for kw in (keywords or []) if _keyword_matches(str(kw), text_lower)]
            if keywords and not matched:
                continue

            seen.add(external_id)
            comment_permalink = str(data.get("permalink") or "").strip()
            if comment_permalink and not comment_permalink.startswith("http"):
                comment_permalink = f"https://reddit.com{comment_permalink}"
            created_utc = data.get("created_utc", "")
            if created_utc:
                try:
                    created_utc = datetime.fromtimestamp(float(created_utc), tz=timezone.utc).isoformat()
                except Exception:
                    created_utc = str(created_utc)

            title = (body[:117] + "...") if len(body) > 120 else body
            results.append({
                "id": external_id,
                "external_id": external_id,
                "title": title,
                "body": body[:3000],
                "selftext": body[:3000],
                "full_text": f"{post.get('title', '')}. {body}".strip()[:3500],
                "score": int(data.get("score", 0) or 0),
                "num_comments": 0,
                "created_utc": created_utc,
                "source": "reddit_comment",
                "subreddit": post.get("subreddit", ""),
                "author": data.get("author") or "",
                "permalink": comment_permalink or permalink,
                "url": comment_permalink or permalink,
                "matched_keywords": matched,
                "parent_external_id": post.get("external_id") or post.get("id") or "",
            })

    if results:
        print(f"  [Comments] {len(results)} live Reddit comments found from fresh posts")
    return results[:max_posts]


def _fetch_reddit_comment_posts_combined(subreddits, keywords, icp, timeout_seconds=30, max_posts=80, days_back=30, seed_posts=None):
    try:
        from pullpush_scraper import scrape_historical_comments_multi
    except ImportError:
        scrape_historical_comments_multi = None

    start = time.time()
    query_terms = [str(kw).strip() for kw in (keywords or [])[:4] if str(kw).strip()]
    comments = []
    if scrape_historical_comments_multi:
        comments = scrape_historical_comments_multi(
            subreddits=subreddits or [],
            keyword=query_terms,
            days_back=days_back,
            size_per_sub=15 if icp == "DEV_TOOL" else 20,
            delay=0.3,
            max_total=max_posts,
        )
        if not comments:
            comments = scrape_historical_comments_multi(
                subreddits=subreddits or [],
                keyword="",
                days_back=max(days_back, 90),
                size_per_sub=20 if icp == "DEV_TOOL" else 25,
                delay=0.3,
                max_total=max_posts * 2,
            )
    live_comments = _fetch_live_reddit_comment_posts(
        seed_posts or [],
        keywords,
        timeout_seconds=min(timeout_seconds, 12),
        max_posts=max(20, min(50, max_posts // 2 or 20)),
    )
    comment_candidates = list(live_comments) + list(comments or [])
    posts = []
    seen = set()
    for comment in comment_candidates:
        if time.time() - start >= timeout_seconds:
            break
        post = dict(comment)
        if not post.get("title"):
            body = str(post.get("body") or post.get("full_text") or "").strip()
            post["title"] = (body[:117] + "...") if len(body) > 120 else body
        external_id = post.get("external_id") or post.get("id")
        if not external_id or external_id in seen:
            continue
        text_lower = f"{post.get('title', '')} {post.get('body', '')} {post.get('full_text', '')}".lower()
        matched = [kw for kw in (keywords or []) if _keyword_matches(str(kw), text_lower)]
        if keywords and not matched:
            continue
        seen.add(external_id)
        post["matched_keywords"] = matched
        posts.append(post)
    if posts:
        print(f"  [Comments] {len(posts)} Reddit comments found")
    return posts


def _normalize_posts_with_taxonomy(posts, icp, forced_subreddits):
    normalized = []
    for post in posts or []:
        merged = apply_evidence_taxonomy(
            post,
            icp_category=icp,
            forced_subreddits=forced_subreddits,
        )
        normalized.append(merged)
    return normalized


def _log_optional_source_config():
    adzuna_configured = bool(os.environ.get("ADZUNA_APP_ID", "").strip() and os.environ.get("ADZUNA_APP_KEY", "").strip())
    g2_configured = bool(G2_AVAILABLE and has_g2_api_token())
    print(f"  [CONFIG] Adzuna: {'✓ configured' if adzuna_configured else '✗ missing (job postings disabled)'}")
    print(f"  [CONFIG] G2: {'✓ configured' if g2_configured else '✗ missing/invalid token (competitor reviews degraded)'}")


def _pullpush_settings(icp, mode):
    settings = {
        "keyword_budget": 5 if mode == "deep" else 8,
        "days_back": 90,
        "timeout": 90,
    }
    if icp in LOW_VOLUME_ICPS:
        settings["days_back"] = 365
        settings["timeout"] = 180
    return settings


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

def phase2_scrape(
    formal_keywords,
    colloquial_keywords,
    required_subreddits,
    validation_id,
    depth_config=None,
    idea_text="",
    audience="",
    known_competitors=None,
    reddit_lab=None,
):
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
    reddit_lab_raw = dict(reddit_lab) if isinstance(reddit_lab, dict) else {}
    reddit_lab_context = _sanitize_reddit_lab_context(reddit_lab_raw)
    idea_icp = classify_icp(idea_text, audience, formal_keywords)
    required_subreddits = _route_forced_subreddits(idea_icp, required_subreddits)
    occupation_limit = 2 if depth_config.get("mode") == "quick" else 6
    required_subreddits, occupation_match = _augment_subreddits_with_occupation_map(
        idea_text,
        audience,
        required_subreddits,
        limit=occupation_limit,
    )
    required_subreddits = [
        str(sub).strip().replace("r/", "").replace("/r/", "")
        for sub in (required_subreddits or [])
        if str(sub).strip()
    ]
    lab_subreddits = [
        str(sub).strip().replace("r/", "").replace("/r/", "")
        for sub in ((reddit_lab_context or {}).get("source_pack_subreddits") or [])
        if str(sub).strip()
    ]
    if lab_subreddits:
        required_subreddits = list(dict.fromkeys(lab_subreddits + required_subreddits))
    source_counts = {}
    scrape_audit = {
        "idea_icp": idea_icp,
        "forced_subreddits": list(required_subreddits),
        "reddit_lab": reddit_lab_context or {},
        "occupation_matches": list((occupation_match or {}).get("occupations", [])),
        "occupation_routed_subreddits": list((occupation_match or {}).get("subreddits", [])),
        "discovered_subreddits": [],
        "subreddit_post_counts": {},
        "source_taxonomy": {},
    }
    platform_warnings = []  # Track platforms that returned 0 results or were unavailable

    print(f"  [ICP] {idea_icp} ✓")
    print(f"  [Forced subs] {', '.join(required_subreddits)} ✓")
    print(f"  [REDDIT]  colloquial_keywords: {reddit_keywords}")
    print(f"  [HN]      formal keywords: {scrape_keywords}")
    print(f"  [PH]      formal keywords: {scrape_keywords}")
    print(f"  [IH]      formal keywords: {scrape_keywords}")
    print(f"  [SO]      formal keywords: {scrape_keywords[:3]}")
    print(f"  [GH]      formal keywords: {scrape_keywords[:3]}")

    # ── Reddit ──
    print(f"  [>] Scraping Reddit for: {reddit_keywords} (lookback={reddit_duration})")
    
    # FIX 3: Run PullPush (historical) in parallel with Async Scraper
    import concurrent.futures
    reddit_posts = []
    
    # Only run PullPush for deep/investigation modes
    mode = depth_config.get("mode")
    if mode in ("deep", "investigation"):
        pullpush_settings = _pullpush_settings(idea_icp, mode)
        pullpush_kw_budget = pullpush_settings["keyword_budget"]
        pullpush_lookback_days = pullpush_settings["days_back"]
        pullpush_timeout = pullpush_settings["timeout"]
        if idea_icp in LOW_VOLUME_ICPS:
            print(f"  [PP] Using extended lookback for low-volume ICP: {idea_icp}")
        pullpush_subs = required_subreddits or []
        # Add a few core subs if forced list is too small
        if len(pullpush_subs) < 3:
            pullpush_subs.extend(["SaaS", "Entrepreneur", "startups"])
            pullpush_subs = list(set(pullpush_subs))[:10]
            
        print(f"  [PP] Launching background PullPush for {pullpush_subs} (timeout {pullpush_timeout}s, lookback {pullpush_lookback_days}d)")
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            # Task 1: Async Scraper (Fast recent data)
            async_future = executor.submit(
                run_keyword_scan,
                reddit_keywords,
                duration=reddit_duration,
                on_progress=on_progress,
                forced_subreddits=required_subreddits,
                min_keyword_matches=reddit_min_matches,
                idea_text=idea_text,
                icp_category=idea_icp,
                subreddit_cap=depth_config.get("subreddit_cap"),
                enable_historical_backfill=False,
                return_metadata=True,
            )
            
            # Task 2: PullPush (Historical data)
            from engine.pullpush_scraper import scrape_historical_multi
            pp_future = executor.submit(
                scrape_historical_multi,
                subreddits=pullpush_subs,
                keywords=reddit_keywords[:pullpush_kw_budget],
                days_back=pullpush_lookback_days,
                size_per_sub=50
            )
            
            # Collect Async Scraper (must complete)
            async_result = async_future.result()
            if isinstance(async_result, dict):
                reddit_posts.extend(async_result.get("posts", []))
                scrape_audit["discovered_subreddits"] = (
                    async_result.get("discovered_subreddits", [])
                    or async_result.get("selected_subreddits", [])
                    or []
                )
            else:
                reddit_posts.extend(async_result)
            
            # Collect PullPush (can timeout/fail)
            try:
                pp_posts = pp_future.result(timeout=pullpush_timeout)
                print(f"  [PP] ✓ Successfully retrieved {len(pp_posts)} historical posts")
                # Deduplicate manually against async posts to handle different ID formats
                seen_reddit_ids = {p.get("id") or p.get("external_id") for p in reddit_posts}
                for p in pp_posts:
                    pid = p.get("external_id")
                    if pid and pid not in seen_reddit_ids:
                        seen_reddit_ids.add(pid)
                        # Normalize format to match async scraper output expectations downstream
                        p["id"] = pid
                        p["selftext"] = p.get("body", "")
                        
                        # Apply keyword filters again just to be safe
                        text_lower = p.get("full_text", "").lower()
                        from engine.keyword_scraper import _keyword_matches
                        matched_kw = [kw for kw in reddit_keywords if _keyword_matches(kw, text_lower)]
                        if len(matched_kw) >= 1:
                            p["matched_keywords"] = matched_kw
                            reddit_posts.append(p)
            except concurrent.futures.TimeoutError:
                print(f"  [PP] ⚠ PullPush hit hard timeout of {pullpush_timeout}s - continuing without full historical data")
            except Exception as e:
                print(f"  [PP] ⚠ PullPush background task failed: {str(e)[:100]}")
    else:
        # Quick mode — no PullPush parallelization needed
        reddit_result = run_keyword_scan(
            reddit_keywords,
            duration=reddit_duration,
            on_progress=on_progress,
            forced_subreddits=required_subreddits,
            min_keyword_matches=reddit_min_matches,
            idea_text=idea_text,
            icp_category=idea_icp,
            subreddit_cap=depth_config.get("subreddit_cap"),
            enable_historical_backfill=False,
            return_metadata=True,
        )
        if isinstance(reddit_result, dict):
            reddit_posts = reddit_result.get("posts", [])
            scrape_audit["discovered_subreddits"] = (
                reddit_result.get("discovered_subreddits", [])
                or reddit_result.get("selected_subreddits", [])
                or []
            )
        else:
            reddit_posts = reddit_result
    if mode in ("deep", "investigation"):
        scrape_audit["discovered_subreddits"] = list(dict.fromkeys(
            list(scrape_audit.get("discovered_subreddits", [])) + list(pullpush_subs)
        ))
    from collections import Counter as _Counter
    scrape_audit["subreddit_post_counts"] = dict(
        sorted(
            _Counter(
                str(p.get("subreddit") or "").strip().lower().replace("r/", "").replace("/r/", "")
                for p in reddit_posts
                if str(p.get("subreddit") or "").strip()
            ).items()
        )
    )
    source_counts["reddit"] = len(reddit_posts)
    print(f"  [✓] Reddit: {len(reddit_posts)} posts")
    log_progress(validation_id, {
        "phase": "scraping",
        "source": "reddit",
        "count": len(reddit_posts),
        "pain_count": _estimate_pain_count(reddit_posts),
        "message": f"Reddit: {len(reddit_posts)} posts found ({_estimate_pain_count(reddit_posts)} with clear pain)",
    })
    if len(reddit_posts) == 0:
        platform_warnings.append({"platform": "reddit", "issue": "0 posts returned — Reddit scraping may have been rate-limited or keywords too niche"})

    connected_reddit_posts = []
    if reddit_lab_raw.get("use_connected_context") and reddit_lab_raw.get("connected_access_token"):
        print("  [>] Scraping connected Reddit lane...")
        connected_reddit_posts = _fetch_connected_reddit_posts(
            reddit_lab_raw.get("connected_access_token"),
            reddit_keywords,
            required_subreddits,
            max_posts=60 if mode in ("deep", "investigation") else 30,
        )
        source_counts["reddit_connected"] = len(connected_reddit_posts)
        log_progress(validation_id, {
            "phase": "scraping",
            "source": "reddit_connected",
            "count": len(connected_reddit_posts),
            "pain_count": _estimate_pain_count(connected_reddit_posts),
            "message": f"Connected Reddit: {len(connected_reddit_posts)} posts from user-authorized API",
        })

    comment_subreddits = list(dict.fromkeys(
        list(scrape_audit.get("discovered_subreddits", [])) + list(required_subreddits)
    ))[:12]
    if mode == "quick":
        reddit_comment_posts = _fetch_live_reddit_comment_posts(
            reddit_posts,
            reddit_keywords[:4],
            timeout_seconds=8,
            max_posts=12,
        )
    else:
        reddit_comment_posts = _fetch_reddit_comment_posts(
            comment_subreddits,
            reddit_keywords[:6],
            idea_icp,
            timeout_seconds=45 if mode in ("deep", "investigation") else 20,
            max_posts=80 if mode in ("deep", "investigation") else 40,
            days_back=90 if idea_icp in LOW_VOLUME_ICPS else 30,
            seed_posts=reddit_posts,
        )
    source_counts["reddit_comment"] = len(reddit_comment_posts)
    if reddit_comment_posts:
        print(f"  [✓] Reddit Comments: {len(reddit_comment_posts)} posts")
    log_progress(validation_id, {
        "phase": "scraping",
        "source": "reddit_comment",
        "count": len(reddit_comment_posts),
        "pain_count": _estimate_pain_count(reddit_comment_posts),
        "message": f"Reddit comments: {len(reddit_comment_posts)} matching discussions",
    })

    g2_timeout = 20 if mode == "quick" else 60
    g2_posts = _fetch_g2_review_posts(idea_icp, known_competitors or [], timeout_seconds=g2_timeout)
    source_counts["g2_review"] = len(g2_posts)
    if g2_posts:
        print(f"  [✓] G2 Reviews: {len(g2_posts)} posts")
    log_progress(validation_id, {
        "phase": "scraping",
        "source": "g2_review",
        "count": len(g2_posts),
        "pain_count": _estimate_pain_count(g2_posts),
        "message": f"G2: {len(g2_posts)} review complaints found",
    })

    job_posts = _fetch_adzuna_job_posts(
        scrape_keywords[:4] if mode == "quick" else scrape_keywords[:5],
        idea_icp,
        timeout_seconds=15 if mode == "quick" else 30,
        max_posts=20 if mode == "quick" else 50,
    )
    source_counts["job_posting"] = len(job_posts)
    log_progress(validation_id, {
        "phase": "scraping",
        "source": "job_posting",
        "count": len(job_posts),
        "message": f"Jobs: {len(job_posts)} relevant postings found",
    })

    vendor_blog_posts = _fetch_vendor_blog_posts(
        idea_icp,
        idea_text,
        scrape_keywords[:4] if mode == "quick" else scrape_keywords[:5],
        max_posts=8 if mode == "quick" else 20,
    )
    source_counts["vendor_blog"] = len(vendor_blog_posts)
    log_progress(validation_id, {
        "phase": "scraping",
        "source": "vendor_blog",
        "count": len(vendor_blog_posts),
        "message": f"Vendor blogs: {len(vendor_blog_posts)} supporting articles found",
    })

    # ── Hacker News ──
    hn_posts = []
    if HN_AVAILABLE:
        print("  [>] Scraping Hacker News...")
        try:
            hn_posts = run_hn_scrape(scrape_keywords[:hn_kw_budget], max_pages=depth_config.get("hn_max_pages", 2))
            source_counts["hackernews"] = len(hn_posts)
            print(f"  [✓] HN: {len(hn_posts)} posts")
            log_progress(validation_id, {
                "phase": "scraping",
                "source": "hackernews",
                "count": len(hn_posts),
                "pain_count": _estimate_pain_count(hn_posts),
                "message": f"Hacker News: {len(hn_posts)} matching threads",
            })
            if len(hn_posts) == 0:
                platform_warnings.append({"platform": "hackernews", "issue": "0 posts returned — keywords may not match HN discourse"})
        except Exception as e:
            print(f"  [!] HN scrape failed: {e}")
            log_progress(validation_id, {
                "phase": "scraping",
                "source": "hackernews",
                "count": 0,
                "message": f"Hacker News failed: {str(e)[:80]}",
            })
            platform_warnings.append({"platform": "hackernews", "issue": f"Scrape failed: {str(e)[:100]}"})
    else:
        log_progress(validation_id, {
            "phase": "scraping",
            "source": "hackernews",
            "count": 0,
            "message": "Hacker News scraper unavailable",
        })
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
            log_progress(validation_id, {
                "phase": "scraping",
                "source": "producthunt",
                "count": len(ph_posts),
                "message": f"Product Hunt: {len(ph_posts)} launches/discussions found",
            })
            warning = _platform_warning("producthunt", ph_result, len(ph_posts))
            if warning:
                platform_warnings.append(warning)
        except Exception as e:
            print(f"  [!] ProductHunt scrape failed: {e}")
            log_progress(validation_id, {
                "phase": "scraping",
                "source": "producthunt",
                "count": 0,
                "message": f"Product Hunt failed: {str(e)[:80]}",
            })
            platform_warnings.append({
                "platform": "producthunt",
                "status": "failed",
                "error_code": "scraper_exception",
                "error_detail": str(e)[:100],
                "posts": 0,
                "issue": f"ProductHunt: scrape error ({str(e)[:100]}) - data from Reddit + HN only",
            })
    else:
        log_progress(validation_id, {
            "phase": "scraping",
            "source": "producthunt",
            "count": 0,
            "message": "Product Hunt scraper unavailable",
        })
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
            log_progress(validation_id, {
                "phase": "scraping",
                "source": "indiehackers",
                "count": len(ih_posts),
                "pain_count": _estimate_pain_count(ih_posts),
                "message": f"Indie Hackers: {len(ih_posts)} founder discussions found",
            })
            warning = _platform_warning("indiehackers", ih_result, len(ih_posts))
            if warning:
                platform_warnings.append(warning)
        except Exception as e:
            print(f"  [!] IndieHackers scrape failed: {e}")
            log_progress(validation_id, {
                "phase": "scraping",
                "source": "indiehackers",
                "count": 0,
                "message": f"Indie Hackers failed: {str(e)[:80]}",
            })
            platform_warnings.append({
                "platform": "indiehackers",
                "status": "failed",
                "error_code": "scraper_exception",
                "error_detail": str(e)[:100],
                "posts": 0,
                "issue": f"IndieHackers: scrape error ({str(e)[:100]}) - data from Reddit + HN only",
            })
    else:
        log_progress(validation_id, {
            "phase": "scraping",
            "source": "indiehackers",
            "count": 0,
            "message": "Indie Hackers scraper unavailable",
        })
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
    if idea_icp != "DEV_TOOL":
        print("  [SO] Skipped — not a developer tool idea")
        source_counts["stackoverflow"] = 0
    elif SO_AVAILABLE:
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

    history_keywords = list(dict.fromkeys(
        [str(keyword).strip() for keyword in (reddit_keywords + scrape_keywords[:6]) if str(keyword).strip()]
    ))[:10]
    db_history_posts = _fetch_recent_db_history_posts(
        history_keywords,
        required_subreddits=required_subreddits,
        days_back=30,
        max_posts=120 if mode in ("deep", "investigation") else 24,
    )
    scrape_audit["db_history_posts"] = len(db_history_posts)
    print(f"  [DB] Recent history: {len(db_history_posts)} posts from the last 30 days")
    log_progress(validation_id, {
        "phase": "scraping",
        "count": len(db_history_posts),
        "message": f"Recent DB history: {len(db_history_posts)} posts from the last 30 days",
    })

    all_posts = (
        reddit_posts
        + connected_reddit_posts
        + reddit_comment_posts
        + g2_posts
        + job_posts
        + vendor_blog_posts
        + hn_posts
        + ph_posts
        + ih_posts
        + so_posts
        + gh_posts
        + db_history_posts
    )

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
    unique_posts = _normalize_posts_with_taxonomy(unique_posts, idea_icp, required_subreddits)
    source_counts = dict(
        sorted(
            Counter(
                str(post.get("source") or "unknown").lower().strip()
                for post in unique_posts
                if str(post.get("source") or "").strip()
            ).items()
        )
    )
    scrape_audit["source_taxonomy"] = summarize_taxonomy(unique_posts)
    log_progress(validation_id, {
        "phase": "dedup",
        "before": len(all_posts),
        "after": len(unique_posts),
        "message": f"Deduplicated evidence: {len(all_posts)} raw matches → {len(unique_posts)} unique items",
    })

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
    return unique_posts, source_counts, platform_warnings, scrape_audit


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

    # ── Google Trends (with timeout guard) ──
    if TRENDS_AVAILABLE:
        print("\n  ══ PHASE 2b: Google Trends Analysis ══")
        update_validation(validation_id, {"status": "analyzing_trends"})
        try:
            trend_keywords = keywords[:5]  # Top 5 keywords for trends
            # Fix 2: Wrap in ThreadPoolExecutor with 45s timeout — pytrends can hang indefinitely
            from concurrent.futures import ThreadPoolExecutor as _TrendsPool, TimeoutError as _TrendsTimeout
            _trends_pool = _TrendsPool(max_workers=1)
            _trends_future = _trends_pool.submit(analyze_keywords, trend_keywords)
            try:
                trend_results = _trends_future.result(timeout=45)
            except _TrendsTimeout:
                print("  [!] Trends analysis timed out after 45s — continuing without trends")
                trend_results = {}
            finally:
                _trends_pool.shutdown(wait=False, cancel_futures=True)

            if trend_results:
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
                log_progress(validation_id, {
                    "phase": "analysis",
                    "source": "trends",
                    "count": len(trend_results),
                    "message": f"Google Trends: {len(trend_results)} keywords analyzed ({trend_report.get('overall_trend', 'UNKNOWN')})",
                })
            else:
                print("  [!] Trends: no data returned (timeout or empty)")
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
            log_progress(validation_id, {
                "phase": "analysis",
                "source": "competition",
                "count": len(comp_report.get("direct_competitors", []) or []),
                "message": (
                    f"Competition mapped: {len(comp_report.get('direct_competitors', []) or [])} "
                    f"direct competitors ({comp_report.get('market_saturation', 'unknown')})"
                ),
            })
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
    {"post_title": "Exact post title from the data", "source": "reddit/hn/ph/ih", "score": 123, "what_it_proves": "Specific insight this post provides", "relevance_tier": "DIRECT"},
    {"post_title": "Another exact title", "source": "reddit/hn/ph/ih", "score": 456, "what_it_proves": "Another insight", "relevance_tier": "ADJACENT"}
  ]
}

RULES:
- For each evidence item, add relevance_tier = DIRECT, ADJACENT, or IRRELEVANT.
- DIRECT = exact buyer/problem/competitor/WTP match for this idea.
- ADJACENT = related market context, but a different buyer, workflow, or pain.
- IRRELEVANT = wrong audience, generic technology chatter, or a weak "space interest" signal.
- Evidence arrays should be dominated by DIRECT posts. Include ADJACENT only for context. IRRELEVANT posts should normally be excluded entirely.
- Include ONLY posts that are DIRECTLY relevant to the specific idea. If a post requires interpretation or stretching to connect to the idea, DO NOT include it.
- Quality over quantity. 3 directly relevant posts are worth more than 15 tangentially related ones.
- If you cannot find 5 directly relevant posts, state explicitly: "INSUFFICIENT DIRECT EVIDENCE — only X posts directly address this specific idea."
- NEVER invent post titles. Only cite what appears in the data.
- For WTP, search for dollar amounts, "I'd pay", "take my money", "shut up and take", pricing discussions.
- Be specific with TAM — reference subreddit subscriber counts, post frequency, industry size.

CRITICAL REJECTION RULE:
A post is ONLY relevant if it directly mentions:
- The specific problem this idea solves, OR
- The specific buyer type (by name/role), OR
- A competitor or alternative being used/complained about
- An explicit willingness to pay for this type of solution

Do NOT use a post as evidence if:
- It mentions a related technology but not the problem
- It's from a wrong audience (developer posts for non-dev ideas)
- It requires 2+ logical steps to connect to the idea
- The connection is "this shows general interest in the space"

If you cite a post, the connection must be DIRECT and OBVIOUS.
If you find yourself writing "this could indicate..." or "this suggests general interest in..." — DO NOT include it.
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

CRITICAL REJECTION RULE:
A post is ONLY relevant if it directly mentions:
- The specific problem this idea solves, OR
- The specific buyer type (by name/role), OR
- A competitor or alternative being used/complained about
- An explicit willingness to pay for this type of solution

Do NOT use a post as evidence if:
- It mentions a related technology but not the problem
- It's from a wrong audience (developer posts for non-dev ideas)
- It requires 2+ logical steps to connect to the idea
- The connection is "this shows general interest in the space"

If you cite a post, the connection must be DIRECT and OBVIOUS.
If you find yourself writing "this could indicate..." or "this suggests general interest in..." — DO NOT include it.
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
  "verdict": "BUILD IT" or "RISKY" or "DON'T BUILD" or "INSUFFICIENT DATA",
  "confidence": 0-100,
  "executive_summary": "4-5 sentence summary. Include: post count, platforms analyzed, trend direction, competition level, key WTP signals, and your honest recommendation. Be direct and data-driven.",
  "evidence": [
    {"post_title": "Exact post title from the scraped data", "source": "reddit/hn/ph/ih", "score": 123, "what_it_proves": "Specific market signal this post reveals", "relevance_tier": "DIRECT"},
    {"post_title": "Another exact title", "source": "reddit/hn/ph/ih", "score": 456, "what_it_proves": "Another insight from this post", "relevance_tier": "ADJACENT"}
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
- evidence: Include ONLY directly relevant posts. Quote EXACT titles from the posts you were given. NEVER invent titles.
- When prior evidence includes relevance_tier labels, treat DIRECT items as validation-grade proof and ADJACENT items as context only.
- If fewer than 5 directly relevant evidence posts exist, say so explicitly instead of stretching adjacent posts into evidence.
- risk_factors: MINIMUM 3 risks — at least one market risk, one technical risk, one execution risk.
- top_posts: Pick the most impactful directly relevant posts from the data. Quality over quantity.
- SCORING:
  "BUILD IT" = strong signal (20+ DIRECTLY RELEVANT posts, multi-platform, explicit WTP mentions, growing trends)
  "RISKY" = moderate signal (10-20 directly relevant posts, some WTP signals, unclear differentiation)
  "DON'T BUILD" = weak signal (<10 directly relevant posts, no explicit WTP, saturated or declining trends)
  "INSUFFICIENT DATA" = fewer than 5 directly relevant posts
- Be BRUTALLY honest. The founder wants truth that makes money, not encouragement that wastes time.

CRITICAL REJECTION RULE:
A post is ONLY relevant if it directly mentions:
- The specific problem this idea solves, OR
- The specific buyer type (by name/role), OR
- A competitor or alternative being used/complained about
- An explicit willingness to pay for this type of solution

Do NOT use a post as evidence if:
- It mentions a related technology but not the problem
- It's from a wrong audience (developer posts for non-dev ideas)
- It requires 2+ logical steps to connect to the idea
- The connection is "this shows general interest in the space"

If you cite a post, the connection must be DIRECT and OBVIOUS.
If you find yourself writing "this could indicate..." or "this suggests general interest in..." — DO NOT include it.

EVIDENCE RELEVANCE GATE:
Before scoring, count how many evidence posts are DIRECTLY relevant (see rejection rule above).

If directly relevant posts < 5:
  - Set pain_validated = false
  - Set confidence below 40
  - State explicitly: "THIN DIRECT EVIDENCE: Only X posts directly address this specific idea. The remaining evidence is from adjacent topics and should not be used to validate buyer demand."

If directly relevant posts < 10:
  - Cap confidence at 55
  - Note: "MODERATE EVIDENCE: X directly relevant posts found. Broader post pool contains adjacent signal only."
"""


# ═══════════════════════════════════════════════════════
# DATA QUALITY & CONTRADICTION DETECTION
# ═══════════════════════════════════════════════════════

def _meaningful_terms(value, min_len=4):
    return [
        word.lower().strip(".,!?")
        for word in re.findall(r"[A-Za-z0-9_+-]+", str(value or ""))
        if len(word) >= min_len
    ]


def _normalize_forced_subreddits(forced_subreddits):
    return [
        str(sub or "").strip().lower().replace("r/", "").replace("/r/", "")
        for sub in (forced_subreddits or [])
        if str(sub or "").strip()
    ]


SEMANTIC_GROUPS = {
    "construction_domain": ["construction", "contractor", "contractors", "builder", "builders", "building", "jobsite", "civilengineering", "homebuilding"],
    "finance_function": ["expense", "expenses", "receipt", "receipts", "report", "reports", "invoice", "invoices", "cost", "costs", "payment", "payments", "budget", "budgets", "reimbursement", "reimbursements"],
    "automation_method": ["automation", "automate", "automated", "tracking", "track", "management", "manage", "software", "app", "apps", "tool", "tools"],
    "hr_domain": ["hr", "human resources", "recruiting", "onboarding", "employee", "workforce", "people ops"],
    "legal_domain": ["legal", "lawyer", "law firm", "attorney", "paralegal", "litigation", "compliance"],
    "freelance_domain": ["freelance", "freelancer", "freelancers", "client", "clients", "agency"],
    "restaurant_domain": ["restaurant", "restaurants", "kitchen", "cafe", "hospitality", "menu", "dining", "food service"],
    "realestate_domain": ["real estate", "property", "landlord", "tenant", "leasing", "broker", "agent"],
    "saas_domain": ["saas", "subscription", "subscriptions", "customer success", "renewal", "renewals", "b2b saas", "arr", "mrr"],
    "retention_function": ["churn", "retention", "retained", "renewal risk", "usage drop", "usage drops", "cancellation", "cancellations", "customer health", "health score", "health scores"],
}

GENERIC_SPECIFICITY_STOPWORDS = {
    "about", "after", "again", "against", "along", "already", "also", "because", "before",
    "being", "between", "build", "built", "could", "does", "doing", "from", "into", "just",
    "make", "many", "more", "most", "need", "only", "other", "over", "really", "should",
    "some", "such", "than", "that", "them", "then", "there", "these", "they", "this",
    "tool", "tools", "under", "using", "with", "without", "would", "your", "ours", "ourselves",
    "software", "platform", "system", "solution", "solutions", "analytics", "analysis",
}


def _generic_specificity_terms(idea_text, keywords):
    combined_terms = []
    for value in [idea_text, *(keywords or [])]:
        combined_terms.extend(_meaningful_terms(value, min_len=4))

    deduped = []
    seen = set()
    for term in combined_terms:
        clean = term.lower().strip()
        if not clean or clean in GENERIC_SPECIFICITY_STOPWORDS:
            continue
        if clean not in seen:
            seen.add(clean)
            deduped.append(clean)
    return deduped


def _active_semantic_groups(idea_text, keywords):
    haystack = " ".join([str(idea_text or "")] + [str(kw or "") for kw in (keywords or [])]).lower()
    active = {}
    for group_name, terms in SEMANTIC_GROUPS.items():
        if any(term in haystack for term in terms):
            active[group_name] = list(terms)
    return active


def _matched_semantic_groups(text, idea_text, keywords):
    text_lower = str(text or "").lower()
    active = _active_semantic_groups(idea_text, keywords)
    matched = {}
    for group_name, terms in active.items():
        hits = [term for term in terms if term in text_lower]
        if hits:
            matched[group_name] = hits
    return matched


def has_idea_specificity(title, idea_text, keywords):
    """
    Returns True only if the text contains idea-specific signal from
    at least two different semantic groups, or a generic fallback of
    matched terms from distinct parts of the idea when no semantic map
    exists for that ICP yet.
    """
    title_lower = str(title or "").lower()
    matched_groups = _matched_semantic_groups(title_lower, idea_text, keywords)
    if len(matched_groups) >= 2:
        active = _active_semantic_groups(idea_text, keywords)

        construction_active = "construction_domain" in active
        finance_active = "finance_function" in active
        if construction_active and finance_active:
            has_construction = any(term in title_lower for term in active["construction_domain"])
            has_finance = any(term in title_lower for term in active["finance_function"])
            if not (has_construction and has_finance):
                return False

        return True

    generic_terms = _generic_specificity_terms(idea_text, keywords)
    if len(generic_terms) < 2:
        return False

    matches = [term for term in generic_terms if term in title_lower]
    if len(matches) < 2:
        return False

    split_index = max(1, len(generic_terms) // 2)
    first_half = generic_terms[:split_index]
    second_half = generic_terms[split_index:]
    if not second_half:
        second_half = generic_terms[-1:]

    has_first = any(term in title_lower for term in first_half)
    has_second = any(term in title_lower for term in second_half)
    return has_first and has_second


def _corpus_text(evidence_item):
    evidence_item = evidence_item or {}
    parts = [
        evidence_item.get("post_title"),
        evidence_item.get("title"),
        evidence_item.get("selftext"),
        evidence_item.get("body"),
        evidence_item.get("text"),
        evidence_item.get("full_text"),
        evidence_item.get("what_it_proves"),
    ]
    return " ".join(str(part or "") for part in parts).lower()


def _has_first_person_buyer_pain(corpus):
    corpus = str(corpus or "").lower()
    first_person_markers = [
        " i ", " i'm ", " i’m ", " i am ", " my ", " we ", " we're ", " we’re ", " we are ", " our ",
    ]
    pain_experience_markers = [
        "lost customer", "lost customers", "losing customer", "losing customers",
        "churn hit", "customer churn", "retention is killing", "renewal risk",
        "usage dropped", "usage has been dropping", "went cold", "going cold",
        "expired cards", "cancellation", "cancelled", "canceled", "freaking out",
        "felt so down", "struggling", "frustrated", "hate", "manual", "tedious",
        "clients keep paying late", "late payments", "unpaid invoice", "overdue invoice",
    ]
    return any(marker in corpus for marker in first_person_markers) and any(
        marker in corpus for marker in pain_experience_markers
    )


def _is_launch_or_builder_meta_post(title, corpus, source):
    title = str(title or "").lower()
    corpus = str(corpus or "").lower()
    source = str(source or "").lower()
    launch_markers = [
        "show hn", "show ph", "launching", "launched", "introducing", "just launched",
        "validating ", "we built", "i built", "our startup", "startup idea", "roast my",
        "feedback on", "product launch",
    ]
    return (
        any(marker in title for marker in launch_markers)
        or ((source in {"hackernews", "producthunt"} or "show hn" in title) and "validat" in corpus)
    )


def _is_generic_tooling_post(title, corpus):
    title = str(title or "").lower()
    corpus = str(corpus or "").lower()
    tooling_markers = [
        "automation stack", "tool stack", "stack for a", "our stack", "my stack",
        "tools for a", "what tools do you use", "what's in your stack", "whats in your stack",
    ]
    return any(marker in title for marker in tooling_markers) or (
        "stack" in title and "tool" in corpus
    )


def _is_meta_tool_critique_post(title, corpus):
    title = str(title or "").lower()
    corpus = str(corpus or "").lower()
    critique_markers = [
        "why most ", "are meaningless", "is meaningless", "best tools", "tool comparison",
        "alternatives to", "vs ", "review of ", "top tools", "comparison of",
    ]
    return any(marker in title for marker in critique_markers) and not _has_first_person_buyer_pain(corpus)


def compute_relevance_tier(evidence_item, idea_text, keywords, target_audience, forced_subreddits):
    """
    Deterministic relevance scoring.
    Never trust the AI's own relevance_tier label.
    """
    evidence_item = evidence_item or {}
    title = str(evidence_item.get("post_title") or evidence_item.get("title") or "").lower()
    proves = str(evidence_item.get("what_it_proves") or "").lower()
    corpus = _corpus_text(evidence_item)
    source = str(evidence_item.get("source") or "").lower()
    subreddit = str(evidence_item.get("subreddit") or "").lower()
    source_context = f"{source} {subreddit}".strip()

    idea_words = _meaningful_terms(idea_text, min_len=4)
    keyword_words = []
    for kw in keywords or []:
        keyword_words.extend(_meaningful_terms(kw, min_len=4))
    core_terms = list(dict.fromkeys(idea_words + keyword_words))

    title_matches = sum(1 for term in core_terms if term and term in title)
    proves_matches = sum(1 for term in core_terms if term and term in proves)
    body_matches = sum(1 for term in core_terms if term and term in corpus)
    total_matches = title_matches + proves_matches
    title_group_matches = _matched_semantic_groups(title, idea_text, keywords or [])
    proves_group_matches = _matched_semantic_groups(proves, idea_text, keywords or [])
    corpus_group_matches = _matched_semantic_groups(corpus, idea_text, keywords or [])
    title_specific = has_idea_specificity(title, idea_text, keywords or [])
    proves_specific = has_idea_specificity(proves, idea_text, keywords or [])
    corpus_specific = has_idea_specificity(corpus, idea_text, keywords or [])
    first_person_buyer_pain = _has_first_person_buyer_pain(corpus)
    launch_meta_post = _is_launch_or_builder_meta_post(title, corpus, source)
    generic_tooling_post = _is_generic_tooling_post(title, corpus)
    meta_tool_critique_post = _is_meta_tool_critique_post(title, corpus)

    buyer_native = any(
        sub in source_context
        for sub in _normalize_forced_subreddits(forced_subreddits)
    )
    buyer_source = source in {
        "reddit",
        "reddit_comment",
        "indiehackers",
        "g2_review",
        "trustradius_review",
        "capterra_review",
        "getapp_review",
        "marketplace_review",
        "feedback_board",
    }
    direct_review_source = source in {
        "g2_review",
        "trustradius_review",
        "capterra_review",
        "getapp_review",
        "marketplace_review",
        "feedback_board",
    }

    hard_noise_signals = [
        "adhd", "depression", "anxiety",
        "mental health", "relationship",
        "teenagers", "books", "gaming",
        "3d printing", "3d printed", "language technology",
        "kubernetes", "java", "python tutorial",
        "machine learning model", "llm",
        "git", "c++", "agents.md",
    ]
    adjacent_category_signals = [
        "i made $", "passive income",
        "side hustle", "gumroad seller",
        "digital products business",
        "selling a business",
    ]
    if any(signal in title for signal in hard_noise_signals) or any(signal in source_context for signal in hard_noise_signals):
        return "IRRELEVANT"

    audience_lower = str(target_audience or "").lower()
    audience_words = [
        word
        for word in re.findall(r"[A-Za-z0-9_+-]+", audience_lower)
        if len(word) >= 5
    ]
    proves_has_buyer = any(word in proves for word in audience_words)
    corpus_has_buyer = any(word in corpus for word in audience_words)

    direct_pain_signals = [
        "need help", "looking for", "recommendation", "recommendations",
        "issue", "problem", "broken", "slow", "expensive", "annoying",
        "late", "unpaid", "overdue", "chasing", "reminder", "reminders",
        "follow up", "follow-up", "manual", "tedious", "waste", "hours",
        "tired of", "sick of", "hate", "frustrated", "struggling",
    ]
    domain_pain_signals = [
        "churn", "retention", "renewal", "cancel", "cancellation", "usage drop", "customer health",
        "late payment", "invoice reminder", "unpaid invoice", "expense report", "receipt management",
        "compliance burden", "manual onboarding", "candidate screening", "dispatch", "scheduling chaos",
    ]
    has_direct_pain_signal = any(signal in corpus for signal in direct_pain_signals + domain_pain_signals)
    has_adjacent_category_signal = any(signal in title or signal in proves or signal in corpus for signal in adjacent_category_signals)
    buyer_context_strong = buyer_native or buyer_source or proves_has_buyer or corpus_has_buyer
    direct_context_strong = buyer_native or direct_review_source or first_person_buyer_pain

    if has_adjacent_category_signal and not buyer_native:
        return "ADJACENT"
    if launch_meta_post:
        return "ADJACENT"
    if generic_tooling_post and not first_person_buyer_pain:
        return "ADJACENT"
    if meta_tool_critique_post and not direct_review_source:
        return "ADJACENT"

    if title_specific and buyer_native and has_direct_pain_signal:
        return "DIRECT"
    if title_specific and buyer_source and has_direct_pain_signal:
        return "DIRECT"
    if proves_has_buyer and title_specific and has_direct_pain_signal and direct_context_strong:
        return "DIRECT"
    if proves_specific and has_direct_pain_signal and direct_context_strong:
        return "DIRECT"
    if corpus_specific and buyer_context_strong and has_direct_pain_signal and direct_context_strong:
        return "DIRECT"
    if corpus_specific and buyer_native and body_matches >= 2 and (has_direct_pain_signal or first_person_buyer_pain):
        return "DIRECT"

    if title_matches >= 1 or proves_matches >= 1 or body_matches >= 1 or title_group_matches or proves_group_matches or corpus_group_matches:
        return "ADJACENT"

    return "IRRELEVANT"


def _is_direct_evidence(evidence_item, idea_text, keywords, target_audience="", forced_subreddits=None):
    return compute_relevance_tier(
        evidence_item,
        idea_text,
        keywords or [],
        target_audience or "",
        forced_subreddits or [],
    ) == "DIRECT"


def _compute_corpus_relevance_stats(posts, idea_text, keywords, target_audience="", forced_subreddits=None):
    direct_count = 0
    adjacent_count = 0
    direct_evidence_breakdown = []

    for evidence_item in posts or []:
        code_tier = compute_relevance_tier(
            evidence_item,
            idea_text,
            keywords or [],
            target_audience or "",
            forced_subreddits or [],
        )
        direct_evidence_breakdown.append({
            "title": evidence_item.get("post_title") or evidence_item.get("title", ""),
            "code_tier": code_tier,
            "ai_tier": str(evidence_item.get("ai_relevance_tier") or evidence_item.get("relevance_tier") or "unknown"),
            "source": str(evidence_item.get("source") or evidence_item.get("subreddit") or "unknown"),
        })
        if code_tier == "DIRECT":
            direct_count += 1
        elif code_tier == "ADJACENT":
            adjacent_count += 1

    return {
        "direct_evidence_count": direct_count,
        "adjacent_evidence_count": adjacent_count,
        "direct_evidence_breakdown": direct_evidence_breakdown,
    }


def _check_data_quality(posts, source_counts, pass1, pass2, pass3,
                        platform_warnings=None, idea_text="", keywords=None,
                        target_audience="", forced_subreddits=None,
                        filtered_posts=None, idea_icp=""):
    """
    Cross-check data quality and detect contradictions between passes.
    Returns a dict with confidence_cap, contradictions list, and warnings list.
    """
    platform_warnings = platform_warnings or []
    contradictions = []
    warnings = []
    confidence_cap = 100  # Start at max, reduce based on issues
    cap_reason = "No issues detected"
    low_volume_context = _is_low_volume_context(idea_text, target_audience, idea_icp)

    total_posts = len(posts)
    platforms_with_data = len([k for k, v in source_counts.items() if v > 0])

    # ── FIX 1: Minimum post threshold ──
    moderate_posts_threshold = 15 if low_volume_context else 20
    low_posts_threshold = 8 if low_volume_context else 10
    critical_posts_threshold = 4 if low_volume_context else 5
    if total_posts < critical_posts_threshold:
        confidence_cap = min(confidence_cap, 30)
        cap_reason = f"Only {total_posts} posts scraped (need {moderate_posts_threshold}+ for reliable analysis)"
        warnings.append(f"CRITICAL: Only {total_posts} posts found — analysis is based on extremely thin data")
    elif total_posts < low_posts_threshold:
        confidence_cap = min(confidence_cap, 45)
        cap_reason = f"Only {total_posts} posts scraped (need {moderate_posts_threshold}+ for reliable analysis)"
        warnings.append(f"LOW DATA: Only {total_posts} posts found — confidence should be significantly penalized")
    elif total_posts < moderate_posts_threshold:
        confidence_cap = min(confidence_cap, 65)
        cap_reason = f"Only {total_posts} posts scraped (need {moderate_posts_threshold}+ for full confidence)"
        warnings.append(f"MODERATE DATA: {total_posts} posts found — below recommended minimum of {moderate_posts_threshold}")

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
    evidence_items = pass1.get("evidence", []) or []
    evidence_count = len(evidence_items)
    canonical_corpus = filtered_posts if filtered_posts is not None else posts
    corpus_relevance = _compute_corpus_relevance_stats(
        canonical_corpus,
        idea_text,
        keywords or [],
        target_audience or "",
        forced_subreddits or [],
    )
    direct_evidence_count = corpus_relevance["direct_evidence_count"]
    adjacent_evidence_count = corpus_relevance["adjacent_evidence_count"]
    direct_evidence_breakdown = corpus_relevance["direct_evidence_breakdown"]
    direct_floor = 4 if low_volume_context else 5
    direct_strong_floor = 7 if low_volume_context else 10
    direct_critical_floor = 2 if low_volume_context else 3
    if direct_evidence_count == 0:
        confidence_cap = min(confidence_cap, 25)
        cap_reason = (
            "ZERO directly relevant posts found. Report is based entirely on adjacent "
            "signal. Not validation-grade."
        )
        warnings.append(
            "CRITICAL: ZERO directly relevant posts found. Report should be treated as "
            "hypothesis, not validation."
        )
    elif direct_evidence_count < direct_critical_floor:
        confidence_cap = min(confidence_cap, 35)
        cap_reason = (
            f"Only {direct_evidence_count} directly relevant posts. "
            "Insufficient for reliable verdict."
        )
        warnings.append(
            f"CRITICAL: Only {direct_evidence_count} posts directly address this idea. "
            "Report should be treated as hypothesis, not validation."
        )
    elif direct_evidence_count < direct_floor:
        confidence_cap = min(confidence_cap, 50)
        warnings.append(
            f"THIN DIRECT EVIDENCE: Only {direct_evidence_count} posts directly relevant. "
            "Broader evidence is adjacent signal only."
        )
    elif direct_evidence_count < direct_strong_floor:
        confidence_cap = min(confidence_cap, 60)
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
        "low_volume_context": low_volume_context,
        "direct_evidence_count": direct_evidence_count,
        "adjacent_evidence_count": adjacent_evidence_count,
        "direct_evidence_breakdown": direct_evidence_breakdown,
    }


def _build_filter_decomposition(keyword_context, decomposition=None):
    if decomposition:
        return decomposition

    if isinstance(keyword_context, dict):
        return keyword_context

    raw_text = str(keyword_context or "")
    keyword_candidates = []
    for chunk in re.split(r"[\n,]+", raw_text):
        clean = chunk.strip()
        if clean:
            keyword_candidates.extend([part.strip() for part in clean.split() if part.strip()])

    deduped = []
    seen = set()
    for item in keyword_candidates:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    if not deduped:
        deduped = ["startup", "pain", "workflow"]

    return {
        "keywords": deduped[:10],
        "colloquial_keywords": deduped[:5],
        "subreddits": [],
        "competitors": [],
        "audience": "",
        "pain_hypothesis": raw_text,
    }


def _apply_primary_filter_impl(posts, decomposition, idea_text="", depth_config=None, verbose=True):
    """Apply the same primary relevance gate used by Phase 3."""
    from collections import Counter

    MIN_SCORE = 3
    RELAXED_SCORE = 2
    core_keywords = [kw.lower() for kw in decomposition.get("keywords", [])]
    colloquial_keywords = [kw.lower() for kw in decomposition.get("colloquial_keywords", [])]
    buyer_language_sources = {"reddit", "reddit_comment", "indiehackers", "g2_review", "job_posting"}
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
        "construction": {
            "triggers": ["construction", "contractor", "builder", "project manager", "jobsite", "field service"],
            "subs": ["constructionmanagers", "constructiontech", "construction", "civilengineering", "projectmanagement", "homebuilding"],
        },
        "legal": {
            "triggers": ["legal", "law firm", "lawyer", "attorney", "paralegal", "contract"],
            "subs": ["lawfirm", "lawyers", "paralegal", "legaltech", "law", "legaladvice"],
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
            "subs": ["realestatetechnology", "realestate", "propertymanagement", "realestateinvesting", "landlord"],
        },
        "hr": {
            "triggers": ["hr", "human resources", "recruiting", "recruiter", "talent acquisition"],
            "subs": ["humanresources", "recruiting", "recruiters", "askhr"],
        },
        "restaurant": {
            "triggers": ["restaurant", "hospitality", "cafe", "bar", "food service", "kitchen", "menu", "dining", "pos"],
            "subs": ["restaurantowners", "kitchenconfidential", "restaurant", "foodservice"],
        },
        "marketing": {
            "triggers": ["marketing", "cmo", "attribution", "campaign", "martech", "lead generation", "content marketing"],
            "subs": ["marketing", "b2bmarketing", "marketingops", "seo", "socialmedia", "ppc"],
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
        title = (p.get("title", "") or "").lower()
        return any(re.search(r"\b" + re.escape(kw) + r"\b", title) for kw in core_keywords)

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
                if score < RELAXED_SCORE:
                    return False, "rejected_low_score"
                if title_relevant or body_formal_hits >= 1 or colloquial_hits >= 1:
                    return True, "forced_subreddit_match_pass"
                return False, "rejected_no_match"
            if subreddit in topic_native_subreddits:
                if score < RELAXED_SCORE:
                    return False, "rejected_low_score"
                if colloquial_hits >= 1 or body_formal_hits >= 1 or kw_hits >= 1:
                    return True, "body_match_pass"
                return False, "rejected_no_match"
            if score >= MIN_SCORE and (title_relevant or kw_hits >= 2):
                return True, "standard"
            relaxed_keyword_hits = max(kw_hits, body_formal_hits + colloquial_hits)
            if score >= RELAXED_SCORE and (
                relaxed_keyword_hits >= 2 or (relaxed_keyword_hits >= 1 and score >= 10)
            ):
                return True, "body_match_pass"
            if score < RELAXED_SCORE:
                return False, "rejected_low_score"
            return False, "rejected_no_match"
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
    primary_pre_filtered = [p for p, assessment in zip(posts, primary_assessments) if assessment[0]]
    pre_filtered = list(primary_pre_filtered)
    fallback_threshold = depth_config.get("fallback_rescue_threshold", 10) if depth_config else 10

    if len(pre_filtered) < fallback_threshold:
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
                matched_terms >= 1 or body_formal_hits >= 1 or colloquial_hits >= 1
            ):
                fallback_candidates.append(p)
        pre_filtered = primary_pre_filtered + [
            p for p in fallback_candidates if p not in primary_pre_filtered
        ]

    filter_explanation = (
        "Primary filter now counts buyer-language body evidence earlier for Reddit/IndieHackers, "
        "so niche B2B complaint posts do not depend entirely on fallback rescue. "
        "When nothing relevant passes, the run stays thin instead of auto-promoting unrelated posts."
    )
    primary_source_counts = Counter(_source_key(p) for p in primary_pre_filtered)
    rescued_posts = [p for p in pre_filtered if p not in primary_pre_filtered]
    rescue_source_counts = Counter(_source_key(p) for p in rescued_posts)
    rescued_count = len(rescued_posts)
    if not pre_filtered:
        fallback_mode = "no_relevant_posts"
    elif not rescued_count:
        fallback_mode = "not_needed"
    else:
        fallback_mode = "score+body-keyword"
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
    rejected_titles_sample = [
        (p.get("title", "") or "").strip()
        for p, assessment in sorted(
            zip(posts, primary_assessments),
            key=lambda item: int(item[0].get("score", 0) or 0),
            reverse=True,
        )
        if not assessment[0] and (p.get("title", "") or "").strip()
    ][:10]

    if verbose:
        print(f"  [Filter] {len(pre_filtered)}/{len(posts)} posts passed the primary relevance gate", flush=True)
        print(f"  [Filter] {filter_explanation}", flush=True)
        if primary_source_counts:
            primary_breakdown = ", ".join(
                f"{source}={count}" for source, count in sorted(primary_source_counts.items())
            )
            print(f"  [Filter] Primary by source: {primary_breakdown}", flush=True)
        if reddit_scraped_count:
            print("  [Filter] Reddit pass detail:", flush=True)
            print(
                f"    forced_subreddit_match_pass = {reddit_detail_counts.get('forced_subreddit_match_pass', 0)}",
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
            "forced_subreddit_match_pass": reddit_detail_counts.get("forced_subreddit_match_pass", 0),
            "body_match_pass": reddit_detail_counts.get("body_match_pass", 0),
            "rejected_low_score": reddit_detail_counts.get("rejected_low_score", 0),
            "rejected_no_match": reddit_detail_counts.get("rejected_no_match", 0),
        },
        "rejected_titles_sample": rejected_titles_sample,
        "rules": filter_explanation,
    }

    return pre_filtered, filter_diagnostics


def apply_primary_filter(posts, keyword_context, decomposition=None, depth="quick", return_diagnostics=False):
    """Public wrapper for unit tests and diagnostics."""
    built_decomposition = _build_filter_decomposition(keyword_context, decomposition=decomposition)
    filtered, diagnostics = _apply_primary_filter_impl(
        posts,
        built_decomposition,
        idea_text=str(keyword_context or ""),
        depth_config=get_depth_config(depth),
        verbose=False,
    )
    if return_diagnostics:
        return filtered, diagnostics
    return filtered


def _normalize_pass1_evidence(pass1, idea_text, keywords, target_audience, forced_subreddits):
    evidence_items = list((pass1 or {}).get("evidence", []) or [])
    normalized = []
    breakdown = []
    for evidence_item in evidence_items:
        item = dict(evidence_item or {})
        ai_tier = str(item.get("relevance_tier") or "unknown").upper().strip() or "UNKNOWN"
        code_tier = compute_relevance_tier(
            item,
            idea_text,
            keywords or [],
            target_audience or "",
            forced_subreddits or [],
        )
        item["ai_relevance_tier"] = ai_tier
        item["relevance_tier"] = code_tier
        breakdown.append({
            "title": item.get("post_title", ""),
            "code_tier": code_tier,
            "ai_tier": ai_tier,
        })
        if code_tier != "IRRELEVANT":
            taxonomy_directness = "direct" if code_tier == "DIRECT" else "adjacent"
            item = apply_evidence_taxonomy(
                item,
                icp_category=classify_icp(idea_text, target_audience, keywords or []),
                forced_subreddits=forced_subreddits or [],
                override_directness=taxonomy_directness,
            )
            normalized.append(item)
    return normalized, breakdown


def _validity_label(score):
    if score >= 75:
        return "HIGH"
    if score >= 55:
        return "MODERATE"
    if score >= 35:
        return "LOW"
    return "INSUFFICIENT"


def _is_low_volume_context(idea_text="", target_audience="", idea_icp=""):
    haystack = " ".join(
        [
            str(idea_text or ""),
            str(target_audience or ""),
            str(idea_icp or ""),
        ]
    ).lower()
    low_volume_hints = (
        "microsaas",
        "micro saas",
        "under $1m arr",
        "sub-$1m",
        "sub $1m",
        "small saas",
        "tiny saas",
    )
    return str(idea_icp or "").upper() in LOW_VOLUME_ICPS or any(hint in haystack for hint in low_volume_hints)


def _adjacent_heavy_signal(data_quality, source_counts=None, batch_signals=None):
    direct_count = int((data_quality or {}).get("direct_evidence_count", 0) or 0)
    adjacent_count = int((data_quality or {}).get("adjacent_evidence_count", 0) or 0)
    pain_quotes = len(((batch_signals or {}).get("pain_quotes", []) or []))
    buyer_problem_sources = 0
    for source_name, count in (source_counts or {}).items():
        if not count:
            continue
        if str(source_name).lower() in {
            "reddit",
            "reddit_comment",
            "g2_review",
            "trustradius_review",
            "capterra_review",
            "getapp_review",
            "marketplace_review",
            "feedback_board",
            "indiehackers",
        }:
            buyer_problem_sources += 1
    adjacent_floor = 6 if direct_count == 0 else max(6, direct_count * 3)
    return adjacent_count >= adjacent_floor and (pain_quotes >= 3 or buyer_problem_sources >= 2)


def _direct_evidence_quality_message(direct_count, adjacent_heavy=False):
    if direct_count == 0 and adjacent_heavy:
        return (
            "Only 0 posts directly address this idea. Adjacent buyer conversations suggest the pain may be real, "
            "but this exact framing is still unvalidated. Strategy sections should be treated as speculative until "
            "you gather direct buyer proof."
        )
    if direct_count == 0:
        return (
            "Only 0 posts directly address this idea. Strategy sections (ICP, pricing, GTM) are based on adjacent "
            "data and should not be trusted. Validate with direct buyer interviews first."
        )
    if direct_count < 3 and adjacent_heavy:
        return (
            f"Only {direct_count} posts directly address this idea. Adjacent buyer pain is strong, which suggests the "
            "problem may be real, but this exact product framing is still too thin to trust. Validate with direct "
            "buyer interviews first."
        )
    return (
        f"Only {direct_count} posts directly address this idea. Strategy sections (ICP, pricing, GTM) "
        f"are based on adjacent data and should not be trusted. Validate with direct buyer interviews first."
    )


def _quality_verdict_rules(total_posts, data_quality):
    direct_count = int((data_quality or {}).get("direct_evidence_count", 0) or 0)
    adjacent_count = int((data_quality or {}).get("adjacent_evidence_count", 0) or 0)
    rules = [
        f"CANONICAL DIRECT EVIDENCE COUNT: {direct_count}",
        f"CANONICAL ADJACENT EVIDENCE COUNT: {adjacent_count}",
    ]
    if direct_count == 0:
        rules.append("If direct evidence count is 0, your only allowed final verdict is INSUFFICIENT_DATA.")
    elif direct_count < 3:
        rules.append("If direct evidence count is below 3, you may NOT return BUILD_IT. Confidence must stay low.")
    elif direct_count < 5:
        rules.append("If direct evidence count is below 5, BUILD_IT is disallowed. Choose RISKY or INSUFFICIENT_DATA.")
    if total_posts < 20:
        rules.append("If total scraped posts are below 20, confidence must be 40 or lower.")
    if adjacent_count >= max(6, direct_count * 3 if direct_count else 6):
        rules.append(
            "If adjacent pain is strong but direct evidence is thin, say the problem may be real but the current framing is weak."
        )
    return "\n".join(f"  - {rule}" for rule in rules)


def _apply_quality_verdict_guardrails(verdict, confidence, data_quality, total_posts,
                                      pain_validated=False, adjacent_heavy=False,
                                      test_mode=False):
    canonical_verdict = str(verdict or "RISKY").upper().strip()
    if canonical_verdict in ("DON'T BUILD", "DONT_BUILD", "DON'T_BUILD", "DONT BUILD"):
        canonical_verdict = "DON'T BUILD"
    notes = []

    direct_count = int((data_quality or {}).get("direct_evidence_count", 0) or 0)
    contradictions = list((data_quality or {}).get("contradictions", []) or [])
    guarded_confidence = int(confidence or 0)

    if direct_count == 0 and not test_mode:
        if canonical_verdict != "INSUFFICIENT DATA":
            notes.append("Zero direct evidence triggered a canonical override to INSUFFICIENT DATA.")
        canonical_verdict = "INSUFFICIENT DATA"
        guarded_confidence = min(guarded_confidence, 25)
    elif direct_count < 3 and not test_mode:
        if canonical_verdict != "INSUFFICIENT DATA":
            notes.append("Thin direct evidence triggered a canonical override to INSUFFICIENT DATA.")
        canonical_verdict = "INSUFFICIENT DATA"
        guarded_confidence = min(guarded_confidence, 35)
    else:
        if direct_count < 5 and canonical_verdict == "BUILD IT":
            canonical_verdict = "RISKY"
            guarded_confidence = min(guarded_confidence, 45)
            notes.append("BUILD IT is disallowed with fewer than 5 direct signals, so the verdict was downgraded to RISKY.")
        if total_posts < 20 and canonical_verdict == "BUILD IT":
            canonical_verdict = "RISKY"
            guarded_confidence = min(guarded_confidence, 40)
            notes.append("BUILD IT is disallowed when fewer than 20 posts were scraped, so the verdict was downgraded to RISKY.")
        if adjacent_heavy and direct_count > 0 and direct_count < 5 and canonical_verdict == "DON'T BUILD" and pain_validated:
            canonical_verdict = "RISKY"
            guarded_confidence = min(guarded_confidence, 45)
            notes.append("Adjacent buyer pain is strong relative to direct proof, so the verdict was softened from DON'T BUILD to RISKY.")

    if contradictions and guarded_confidence > 70:
        guarded_confidence = 70
        notes.append("Confidence was capped at 70 because contradictions remain in the evidence.")

    return canonical_verdict, guarded_confidence, notes


def _build_problem_validity(pass1, data_quality, source_counts, source_taxonomy, batch_signals):
    direct_count = int(data_quality.get("direct_evidence_count", 0) or 0)
    adjacent_count = int(data_quality.get("adjacent_evidence_count", 0) or 0)
    pain_quotes = len((batch_signals or {}).get("pain_quotes", []) or [])
    buyer_problem_sources = 0
    for source_name, count in (source_counts or {}).items():
        if not count:
            continue
        if str(source_name).lower() in {"reddit", "reddit_comment", "g2_review", "trustradius_review", "capterra_review", "getapp_review", "marketplace_review", "feedback_board"}:
            buyer_problem_sources += 1

    adjacent_heavy = _adjacent_heavy_signal(data_quality, source_counts, batch_signals)
    low_volume_context = bool(data_quality.get("low_volume_context"))
    score = min(100, direct_count * 8 + min(pain_quotes, 5) * 4 + buyer_problem_sources * 6)
    if pass1.get("pain_validated"):
        score += 10
    if low_volume_context and direct_count >= 3:
        score += 5
    if direct_count == 0:
        score = min(score, 20)
    elif direct_count < 3:
        score = min(score, 40)

    score = max(0, min(100, score))
    label = _validity_label(score)

    if direct_count == 0:
        if adjacent_heavy:
            summary = (
                "No buyer-native direct evidence was found for this exact framing, but adjacent buyer conversations "
                "suggest the pain may be real. Treat positioning as unvalidated, not disproven."
            )
        else:
            summary = "No buyer-native direct evidence found. Pain is still a hypothesis."
    elif direct_count < 5:
        if adjacent_heavy:
            summary = (
                f"Thin direct pain proof: only {direct_count} directly relevant buyer signals found, but adjacent buyer "
                "pain is stronger than the exact product framing. The problem may be real while positioning is still weak."
            )
        elif low_volume_context:
            summary = (
                f"Thin but usable direct pain proof for a low-volume niche: {direct_count} directly relevant buyer signals found."
            )
        else:
            summary = f"Thin direct pain proof: only {direct_count} directly relevant buyer signals found."
    else:
        summary = f"Repeated buyer pain is visible across {buyer_problem_sources} source types with {direct_count} direct signals."

    return {
        "score": score,
        "label": label,
        "direct_evidence_count": direct_count,
        "adjacent_evidence_count": adjacent_count,
        "adjacent_heavy": adjacent_heavy,
        "buyer_source_count": buyer_problem_sources,
        "pain_quotes_found": pain_quotes,
        "summary": summary,
        "source_taxonomy": source_taxonomy or {},
    }


def _build_business_validity(pass1, pass2, intel, source_counts, batch_signals, data_quality):
    wtp_signals = len((batch_signals or {}).get("wtp_signals", []) or [])
    jobs_count = int((source_counts or {}).get("job_posting", 0) or 0)
    review_count = sum(
        int((source_counts or {}).get(name, 0) or 0)
        for name in ("g2_review", "trustradius_review", "capterra_review", "getapp_review", "marketplace_review")
    )
    platforms_used = len([k for k, v in (source_counts or {}).items() if v > 0])
    competition = pass2.get("competition_landscape", {}) or {}
    trend_data = intel.get("trends", {}) or {}
    competitors = len(competition.get("direct_competitors", []) or [])
    growing = str(trend_data.get("overall_trend", "")).upper() in {"GROWING", "EXPLODING"}

    score = min(100, min(wtp_signals, 5) * 8 + min(jobs_count, 20) * 1 + min(review_count, 20) * 1 + min(platforms_used, 5) * 6)
    if growing:
        score += 10
    if competitors:
        score += min(10, competitors * 2)
    if data_quality.get("direct_evidence_count", 0) == 0:
        score = min(score, 65)

    score = max(0, min(100, score))
    label = _validity_label(score)

    if score < 35:
        summary = "Business proof is weak: limited WTP, hiring, or replacement-market evidence."
    elif score < 60:
        summary = "Some business signal exists, but monetization or category proof is still incomplete."
    else:
        summary = "Business context is credible: supporting demand, spending, or replacement evidence is present."

    return {
        "score": score,
        "label": label,
        "wtp_signals_found": wtp_signals,
        "job_signals_found": jobs_count,
        "review_signals_found": review_count,
        "platform_count": platforms_used,
        "competitor_count": competitors,
        "summary": summary,
    }


def _claim_contract_entry(
    claim_id,
    label,
    value,
    trust_tier,
    support_level,
    summary="",
    source_basis=None,
    allowed_for_problem_validity=False,
    allowed_for_business_validity=False,
    buyer_native=False,
):
    return {
        "claim_id": str(claim_id or "").strip(),
        "label": str(label or "").strip(),
        "value": str(value or "").strip(),
        "trust_tier": str(trust_tier or "T3").upper(),
        "support_level": str(support_level or "hypothesis").lower(),
        "summary": str(summary or "").strip(),
        "source_basis": [str(item).strip() for item in (source_basis or []) if str(item or "").strip()],
        "allowed_for_problem_validity": bool(allowed_for_problem_validity),
        "allowed_for_business_validity": bool(allowed_for_business_validity),
        "buyer_native": bool(buyer_native),
    }


def _build_claim_contract(report, pass1, pass2, intel, data_quality, source_counts, batch_signals):
    report = report or {}
    pass1 = pass1 or {}
    pass2 = pass2 or {}
    intel = intel or {}
    data_quality = data_quality or {}
    source_counts = source_counts or {}
    batch_signals = batch_signals or {}

    problem_validity = dict(report.get("problem_validity") or {})
    business_validity = dict(report.get("business_validity") or {})
    pricing = dict(report.get("pricing_strategy") or pass2.get("pricing_strategy") or {})
    icp = dict(report.get("ideal_customer_profile") or pass2.get("ideal_customer_profile") or {})
    competition = dict(report.get("competition_landscape") or pass2.get("competition_landscape") or {})
    trends = dict(report.get("trends_data") or intel.get("trends") or {})

    direct_count = int(data_quality.get("direct_evidence_count", 0) or 0)
    adjacent_count = int(data_quality.get("adjacent_evidence_count", 0) or 0)
    explicit_pain_quotes = len(batch_signals.get("pain_quotes", []) or [])
    wtp_signals = int(business_validity.get("wtp_signals_found", len(batch_signals.get("wtp_signals", []) or [])) or 0)
    jobs_count = int(business_validity.get("job_signals_found", source_counts.get("job_posting", 0)) or 0)
    review_count = int(business_validity.get("review_signals_found", 0) or 0)
    competitor_count = int(business_validity.get("competitor_count", len(competition.get("direct_competitors", []) or [])) or 0)
    complaint_count = len(intel.get("competitor_complaints", []) or [])
    adjacent_heavy = bool(problem_validity.get("adjacent_heavy") or _adjacent_heavy_signal(data_quality, source_counts, batch_signals))
    buyer_source_count = int(problem_validity.get("buyer_source_count", 0) or 0)
    overall_trend = str(trends.get("overall_trend", "") or "").upper()

    # FIX: explicit_wtp MUST require actual signal count > 0.
    # The AI may hallucinate icp.willingness_to_pay_evidence even when
    # zero real WTP signals exist, causing pricing to show "evidence_backed"
    # while the same report says "0 WTP signals" — a trust-breaking contradiction.
    explicit_wtp = wtp_signals > 0
    pricing_value = str(pricing.get("recommended_price") or pricing.get("price_range") or pricing.get("recommended_model") or "")
    budget_value = str(icp.get("budget_range") or icp.get("budget") or "")
    tam_value = str(pass1.get("tam_estimate") or "")
    persona_value = str(icp.get("primary_persona") or "")
    competition_value = str(competition.get("market_saturation") or "")
    business_score = int(business_validity.get("score", 0) or 0)
    problem_score = int(problem_validity.get("score", 0) or 0)

    if direct_count >= 5:
        problem_support = "evidence_backed"
    elif direct_count > 0 or adjacent_heavy:
        problem_support = "supporting_context"
    else:
        problem_support = "hypothesis"

    if explicit_wtp or (business_score >= 60 and (review_count > 0 or jobs_count > 0)):
        business_support = "evidence_backed"
    elif business_score >= 35 or review_count > 0 or jobs_count > 0 or competitor_count > 0 or overall_trend in {"GROWING", "EXPLODING"}:
        business_support = "supporting_context"
    else:
        business_support = "hypothesis"

    if persona_value and direct_count >= 3:
        persona_support = "supporting_context"
    else:
        persona_support = "hypothesis"

    if pricing_value and explicit_wtp:
        pricing_support = "evidence_backed"
    elif pricing_value:
        pricing_support = "hypothesis"
    else:
        pricing_support = "hypothesis"

    if not explicit_wtp:
        budget_value = "Unknown — no willingness-to-pay evidence found"

    if budget_value and explicit_wtp:
        budget_support = "supporting_context"
    elif budget_value:
        budget_support = "hypothesis"
    else:
        budget_support = "hypothesis"

    entries = [
        _claim_contract_entry(
            "problem_validity",
            "Problem Validity",
            f"{problem_validity.get('label', 'UNKNOWN')} ({problem_score}%)",
            "T5",
            problem_support,
            summary=str(problem_validity.get("summary") or ""),
            source_basis=[
                f"{direct_count} DIRECT posts",
                f"{adjacent_count} ADJACENT posts",
                f"{explicit_pain_quotes} explicit pain quotes",
                f"{buyer_source_count} buyer-native source types",
            ],
            allowed_for_problem_validity=True,
            allowed_for_business_validity=True,
            buyer_native=direct_count > 0,
        ),
        _claim_contract_entry(
            "business_validity",
            "Business Validity",
            f"{business_validity.get('label', 'UNKNOWN')} ({business_score}%)",
            "T5",
            business_support,
            summary=str(business_validity.get("summary") or ""),
            source_basis=[
                f"{wtp_signals} WTP signals",
                f"{jobs_count} job signals",
                f"{review_count} review signals",
                f"{competitor_count} named competitors",
            ],
            allowed_for_problem_validity=False,
            allowed_for_business_validity=True,
            buyer_native=explicit_wtp or review_count > 0,
        ),
        _claim_contract_entry(
            "market_timing",
            "Market Timing",
            overall_trend or "UNKNOWN",
            "T4",
            "supporting_context" if overall_trend else "hypothesis",
            summary="Trend direction helps with timing, but it does not prove buyer pain by itself.",
            source_basis=[
                f"overall trend: {overall_trend or 'UNKNOWN'}",
                f"avg change: {trends.get('avg_change_percent', 0)}%",
            ],
            allowed_for_problem_validity=False,
            allowed_for_business_validity=True,
            buyer_native=False,
        ),
        _claim_contract_entry(
            "ideal_customer_profile",
            "Ideal Customer Profile",
            persona_value if direct_count >= 3 else (persona_value + " (speculative — thin evidence)" if persona_value else "Not clearly grounded"),
            "T3",
            persona_support,
            summary=(
                "Persona fit is model-inferred from the evidence corpus and should guide interviews, not replace them."
                if direct_count >= 3 else
                "Persona is speculative — fewer than 3 direct buyer signals exist. Do not trust specific ranges (experience years, MRR, campaign counts)."
            ),
            source_basis=[
                f"{direct_count} direct buyer signals",
                f"{adjacent_count} adjacent signals",
            ],
            allowed_for_problem_validity=False,
            allowed_for_business_validity=False,
            buyer_native=direct_count > 0,
        ),
        _claim_contract_entry(
            "competition_landscape",
            "Competition Landscape",
            competition_value or "UNKNOWN",
            "T4",
            "supporting_context" if competitor_count > 0 or complaint_count > 0 else "hypothesis",
            summary="Competition helps frame wedge and market shape, but competitor presence is not demand proof.",
            source_basis=[
                f"{competitor_count} named competitors",
                f"{complaint_count} competitor complaints",
            ],
            allowed_for_problem_validity=False,
            allowed_for_business_validity=True,
            buyer_native=False,
        ),
        _claim_contract_entry(
            "pricing_strategy",
            "Pricing Strategy",
            pricing_value or "Not proposed",
            "T3" if not explicit_wtp else "T4",
            pricing_support,
            summary=(
                "Pricing is grounded by willingness-to-pay evidence."
                if explicit_wtp else
                "Pricing is still a hypothesis because explicit willingness-to-pay evidence is limited or absent."
            ),
            source_basis=[
                f"{wtp_signals} WTP signals",
                f"recommended model: {pricing.get('recommended_model', 'n/a')}",
            ],
            allowed_for_problem_validity=False,
            allowed_for_business_validity=explicit_wtp,
            buyer_native=explicit_wtp,
        ),
        _claim_contract_entry(
            "budget_range",
            "Budget Range",
            budget_value or "Unknown",
            "T3" if not explicit_wtp else "T4",
            budget_support,
            summary=(
                "Budget range is partially anchored by willingness-to-pay signals."
                if explicit_wtp else
                "Budget range is a targeting hypothesis, not a validated buying signal yet."
            ),
            source_basis=[
                f"{wtp_signals} WTP signals",
                f"persona budget: {budget_value or 'unknown'}",
            ],
            allowed_for_problem_validity=False,
            allowed_for_business_validity=explicit_wtp,
            buyer_native=explicit_wtp,
        ),
        _claim_contract_entry(
            "tam_estimate",
            "TAM Estimate",
            tam_value or "Not estimated",
            "T3",
            "hypothesis" if tam_value else "hypothesis",
            summary="TAM is directional only and should never be treated as validated demand on its own.",
            source_basis=[
                f"{jobs_count} job signals",
                f"{review_count} review signals",
                f"trend: {overall_trend or 'UNKNOWN'}",
            ],
            allowed_for_problem_validity=False,
            allowed_for_business_validity=False,
            buyer_native=False,
        ),
    ]

    return {
        "version": "v1",
        "entries": entries,
    }


def _rank_posts_for_recon(posts: list[dict], limit: int = 30) -> list[dict]:
    ranked = sorted(
        posts or [],
        key=lambda p: (
            int(p.get("weighted_score", 0) or 0),
            int(p.get("score", 0) or 0),
            int(p.get("num_comments", 0) or 0),
        ),
        reverse=True,
    )
    return ranked[:limit]


def _run_recon_pass(idea_text: str, decomposition: dict, posts: list[dict], brain, validation_id: str) -> dict:
    if not posts:
        return {}

    condensed = []
    for post in _rank_posts_for_recon(posts, limit=30):
        condensed.append({
            "title": str(post.get("title", ""))[:160],
            "body": str(post.get("selftext", "") or post.get("body", "") or post.get("text", "") or "")[:220],
            "source": str(post.get("source", post.get("subreddit", "unknown"))),
            "subreddit": str(post.get("subreddit", "")),
            "score": int(post.get("score", 0) or 0),
            "comments": int(post.get("num_comments", 0) or 0),
        })

    prompt = f"""Idea: {idea_text}
Audience: {decomposition.get('audience', 'unknown')}
Pain hypothesis: {decomposition.get('pain_hypothesis', 'unknown')}
Keywords: {', '.join(decomposition.get('keywords', [])[:10])}

Analyze these posts and return JSON with:
{{
  "pain_clusters": [{{"problem": "...", "post_count": 3, "subreddits": ["r/x"], "summary": "..."}}],
  "buyer_signals": [{{"quote": "...", "post_title": "...", "source_ref": "...", "why_it_matters": "..."}}],
  "competitor_mentions": [{{"product": "...", "complaint": "...", "post_title": "..."}}],
  "timing_markers": [{{"text": "...", "post_title": "...", "summary": "..."}}],
  "price_anchors": [{{"text": "...", "post_title": "...", "summary": "..."}}]
}}

Rules:
- Keep only concrete signals from the posts.
- Buyer signals should reflect active need, urgency, or willingness to pay.
- If a category has no grounded evidence, return an empty array.

Posts:
{json.dumps(condensed, ensure_ascii=False)}"""

    try:
        log_progress(validation_id, {
            "phase": "synthesis",
            "message": "Recon pass is clustering pain, buyer signals, and competitor gaps",
        })
        raw = brain.single_call(
            prompt,
            "You are a market recon analyst. Cluster evidence before the startup debate begins.",
            task_type="recon",
            stage="recon_pass",
            expect_json=True,
            max_retries=1,
        )
        return extract_json(raw)
    except Exception as exc:
        print(f"  [!] Recon pass failed (non-fatal): {exc}")
        return {}


def _format_recon_summary_for_prompt(recon_summary: dict) -> str:
    if not isinstance(recon_summary, dict) or not recon_summary:
        return ""

    def _lines(items: list[dict], formatter):
        output = []
        for item in items:
            try:
                text = formatter(item)
            except Exception:
                text = ""
            if text:
                output.append(f"- {text}")
        return output

    sections = []
    buyer_lines = _lines(
        recon_summary.get("buyer_signals", [])[:3],
        lambda item: f"{item.get('quote', '')} ({item.get('post_title', 'recon')})",
    )
    if buyer_lines:
        sections.append("RECON BUYER SIGNALS:\n" + "\n".join(buyer_lines))

    pain_lines = _lines(
        recon_summary.get("pain_clusters", [])[:3],
        lambda item: f"{item.get('problem', '')} ({item.get('post_count', 'n/a')} posts)",
    )
    if pain_lines:
        sections.append("RECON PAIN CLUSTERS:\n" + "\n".join(pain_lines))

    competitor_lines = _lines(
        recon_summary.get("competitor_mentions", [])[:2],
        lambda item: f"{item.get('product', '')}: {item.get('complaint', '')}",
    )
    if competitor_lines:
        sections.append("RECON COMPETITOR GAPS:\n" + "\n".join(competitor_lines))

    timing_lines = _lines(
        recon_summary.get("timing_markers", [])[:2],
        lambda item: item.get("text", "") or item.get("summary", ""),
    )
    if timing_lines:
        sections.append("RECON TIMING MARKERS:\n" + "\n".join(timing_lines))

    price_lines = _lines(
        recon_summary.get("price_anchors", [])[:2],
        lambda item: item.get("text", "") or item.get("summary", ""),
    )
    if price_lines:
        sections.append("RECON PRICE ANCHORS:\n" + "\n".join(price_lines))

    return "\n\n".join(section for section in sections if section).strip()


def _run_claim_verification_pass(report: dict, claim_contract: dict, brain, validation_id: str) -> dict:
    debate_transcript = dict(report.get("debate_transcript") or {})
    evidence_board = debate_transcript.get("evidence_board") or []
    if not evidence_board:
        return {"verified": [], "unverified": [], "contradicted": [], "speculative": []}

    claim_entries = list((claim_contract or {}).get("entries") or [])[:6]
    claim_payload = [
        {
            "claim_id": entry.get("claim_id"),
            "label": entry.get("label"),
            "value": entry.get("value"),
            "summary": entry.get("summary"),
            "trust_tier": entry.get("trust_tier"),
        }
        for entry in claim_entries
        if entry.get("value")
    ]

    if report.get("executive_summary"):
        claim_payload.insert(0, {
            "claim_id": "executive_summary",
            "label": "Executive Summary",
            "value": str(report.get("executive_summary", ""))[:260],
            "summary": "Top-line verdict framing",
            "trust_tier": "T5",
        })

    if report.get("first_move"):
        claim_payload.append({
            "claim_id": "first_move",
            "label": "First Move",
            "value": str(report.get("first_move", ""))[:220],
            "summary": "Recommended immediate action",
            "trust_tier": "T4",
        })

    prompt = f"""You are a claim verifier for a startup validation report.

EVIDENCE BOARD:
{json.dumps(evidence_board, ensure_ascii=False)}

CLAIMS TO CHECK:
{json.dumps(claim_payload, ensure_ascii=False)}

Return JSON:
{{
  "verified": [{{"claim_id": "...", "claim": "...", "evidence_ids": ["E1"], "reason": "..."}}],
  "unverified": [{{"claim_id": "...", "claim": "...", "reason": "..."}}],
  "contradicted": [{{"claim_id": "...", "claim": "...", "reason": "..."}}],
  "speculative": [{{"claim_id": "...", "claim": "...", "reason": "..."}}]
}}

Rules:
- Use only the evidence board, not outside knowledge.
- "verified" requires a specific evidence-board match.
- "contradicted" means the claim clashes with the evidence board.
- "speculative" means the claim may be directionally useful but is not grounded strongly enough.
- Keep the reasoning concise."""

    try:
        log_progress(validation_id, {
            "phase": "synthesis",
            "message": "Verifying which report claims are proven versus speculative",
        })
        raw = brain.single_call(
            prompt,
            "You are a strict verifier. Mark unsupported startup claims as unverified or speculative.",
            task_type="verification",
            stage="claim_verification",
            expect_json=True,
            max_retries=1,
        )
        result = extract_json(raw)
        return {
            "verified": list(result.get("verified", []) or []),
            "unverified": list(result.get("unverified", []) or []),
            "contradicted": list(result.get("contradicted", []) or []),
            "speculative": list(result.get("speculative", []) or []),
        }
    except Exception as exc:
        print(f"  [!] Claim verification failed (non-fatal): {exc}")
        return {"verified": [], "unverified": [], "contradicted": [], "speculative": []}


def _build_evidence_quality_summary(report: dict, claim_verification: dict) -> dict:
    evidence = list(report.get("debate_evidence") or report.get("evidence") or report.get("market_analysis", {}).get("evidence", []) or [])
    strongest_evidence = ""
    if evidence:
        first = evidence[0]
        if isinstance(first, dict):
            strongest_evidence = str(first.get("what_it_proves") or first.get("post_title") or first.get("title") or "").strip()
        else:
            strongest_evidence = str(first).strip()

    weakest_point = ""
    for bucket in ("contradicted", "unverified", "speculative"):
        items = list((claim_verification or {}).get(bucket) or [])
        if items:
            weakest_point = str(items[0].get("reason") or items[0].get("claim") or "").strip()
            break

    return {
        "verified_claims": len((claim_verification or {}).get("verified", []) or []),
        "unverified_claims": len((claim_verification or {}).get("unverified", []) or []),
        "contradicted_claims": len((claim_verification or {}).get("contradicted", []) or []),
        "speculative_claims": len((claim_verification or {}).get("speculative", []) or []),
        "strongest_evidence": strongest_evidence,
        "weakest_point": weakest_point,
    }


def phase3_synthesize(idea_text, posts, decomposition, brain, validation_id,
                      source_counts=None, intel=None, depth_config=None, **kwargs):
    """Phase 3: Multi-pass synthesis — 3 focused AI passes + debate verdict."""
    print("\n  ══ PHASE 3: Multi-Pass AI Synthesis ══")
    update_validation(validation_id, {"status": "synthesizing"})

    source_counts = source_counts or {}
    intel = intel or {}
    synthesis_icp = classify_icp(idea_text, decomposition.get("audience", ""), decomposition.get("keywords", []))

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
    pre_filtered, filter_diagnostics = _apply_primary_filter_impl(
        posts,
        decomposition,
        idea_text=idea_text,
        depth_config=depth_config,
        verbose=True,
    )

    posts_filtered_count = len(pre_filtered)  # for pipeline UI display
    recon_summary = _run_recon_pass(idea_text, decomposition, pre_filtered, brain, validation_id)
    recon_block = _format_recon_summary_for_prompt(recon_summary)
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

        BATCH_SYSTEM = """You are a market signal extractor. Return ONLY valid compact JSON.

CRITICAL REJECTION RULE:
A post is ONLY relevant if it directly mentions:
- The specific problem this idea solves, OR
- The specific buyer type (by name/role), OR
- A competitor or alternative being used/complained about
- An explicit willingness to pay for this type of solution

Do NOT use a post as evidence if:
- It mentions a related technology but not the problem
- It's from a wrong audience (developer posts for non-dev ideas)
- It requires 2+ logical steps to connect to the idea
- The connection is "this shows general interest in the space"

If you find yourself writing "this could indicate..." or "this suggests general interest in..." — DO NOT include it.
If no directly relevant pain quotes, WTP signals, or competitor mentions exist in this batch, return empty arrays for those fields.

CRITICAL: Each post now includes [source/subreddit] context.
Use this to assess audience relevance.

REJECT a post for pain_quotes/wtp_signals if:
- The poster is clearly NOT the target buyer (developer post for non-dev idea, etc.)
- The pain is generic and not specific to the exact problem this idea solves
- The WTP signal is for a different product category

Only extract signals where the poster is plausibly the target buyer AND the signal is specifically about the exact problem, not an adjacent topic.
"""

        def _run_batch(batch_posts, batch_idx):
            lines = []
            for p in batch_posts:
                title = (p.get("title", "") or "")[:150]
                snippet = (p.get("selftext", "") or p.get("body", "") or p.get("text", "") or p.get("full_text", "") or "")[:200]
                score = p.get("score", 0)
                source = str(p.get("source") or "").strip().lower() or "unknown"
                subreddit = str(p.get("subreddit") or "").strip().replace("r/", "").replace("/r/", "")
                if source.startswith("reddit") or subreddit:
                    context_label = f"reddit/r/{subreddit or 'na'}"
                else:
                    context_label = f"{source}/na"
                lines.append(f"[{score}] [{context_label}] {title}: {snippet}")
            posts_text = "\n---\n".join(lines)
            prompt = f"""Idea keywords: {kw_str}

Analyze these {len(batch_posts)} posts for startup market signals.
Return ONLY this JSON (no markdown, no explanation):
{{"pain_quotes":["exact quote 1","exact quote 2"],"wtp_signals":["signal or null"],"competitor_mentions":["name if explicitly mentioned"],"key_insight":"one specific sentence"}}

Posts:
{posts_text}"""
            try:
                raw = brain.single_call(
                    prompt,
                    BATCH_SYSTEM,
                    task_type="batch_signal_scan",
                    stage="batch_signal_scan",
                    expect_json=True,
                    max_retries=1,
                )
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
    log_progress(validation_id, {
        "phase": "synthesis",
        "message": f"Signal scan starting: batching {posts_filtered_count} filtered posts for evidence extraction",
    })
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

    if recon_block:
        posts_block = f"{recon_block}\n\n{posts_block}"

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
    log_progress(validation_id, {
        "phase": "synthesis",
        "message": "Pass 1 of 3: Market analysis is extracting pain, WTP, and evidence quality",
    })
    pass1_prompt = f"""{context_block}

{posts_block}

Analyze the MARKET signal. Find pain validation, WTP signals, and cite specific evidence posts."""
    try:
        pass1_raw = brain.single_call(
            pass1_prompt,
            PASS1_SYSTEM,
            task_type="synthesis",
            stage="pass1_market_analysis",
            expect_json=True,
            max_retries=2,
        )
        pass1 = extract_json(pass1_raw)
        normalized_evidence, code_breakdown = _normalize_pass1_evidence(
            pass1,
            idea_text,
            decomposition.get("keywords", []),
            decomposition.get("audience", ""),
            decomposition.get("subreddits", []),
        )
        dropped_irrelevant = max(0, len(pass1.get("evidence", []) or []) - len(normalized_evidence))
        pass1["evidence"] = normalized_evidence
        pass1["_code_evidence_breakdown"] = code_breakdown
        evidence_count = len(pass1.get("evidence", []))
        print(f"  [✓] Pass 1 done: pain_validated={pass1.get('pain_validated')}, {evidence_count} evidence posts")
        if dropped_irrelevant:
            print(f"  [Evidence] Dropped {dropped_irrelevant} IRRELEVANT Pass 1 evidence items via code scoring")
    except Exception as e:
        print(f"  [!] Pass 1 failed after routing all available models: {e}")
        pass1 = {"pain_validated": False, "pain_description": "Analysis failed", "evidence": []}

    # ═══════════════════════════════════════
    # PASS 2: STRATEGY
    # ═══════════════════════════════════════
    print("\n  ── Pass 2/3: Strategy & Competition ──")
    update_validation(validation_id, {"status": "synthesizing (2/3 strategy)"})
    log_progress(validation_id, {
        "phase": "synthesis",
        "message": "Pass 2 of 3: Strategy is mapping ICP, competition, and pricing",
    })
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
        pass2_raw = brain.single_call(
            pass2_prompt,
            PASS2_SYSTEM,
            task_type="synthesis",
            stage="pass2_strategy",
            expect_json=True,
            max_retries=2,
        )
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
    log_progress(validation_id, {
        "phase": "synthesis",
        "message": "Pass 3 of 3: Action plan is building roadmap, launch steps, and risks",
    })
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
            task_type="synthesis",
            stage="pass3_action_plan",
            expect_json=True,
            max_retries=2,
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
        keywords=decomposition.get("keywords", []),
        target_audience=decomposition.get("audience", ""),
        forced_subreddits=decomposition.get("subreddits", []),
        filtered_posts=pre_filtered,
        idea_icp=synthesis_icp,
    )
    full_confidence_threshold = 15 if data_quality.get("low_volume_context") else 20
    print(f"\n  ── Data Quality Check ──")
    print(f"  [Q] Post count: {len(posts)} (threshold: {full_confidence_threshold} for full confidence)")
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
    log_progress(validation_id, {
        "phase": "debate",
        "message": "AI Debate: final verdict process starting",
    })

    def on_progress(status, msg):
        update_validation(validation_id, {"status": status})
        event = {"phase": "debate", "message": msg}
        round_match = re.search(r"round\s+(\d+)", str(msg), re.IGNORECASE)
        if round_match:
            event["round"] = int(round_match.group(1))
            event["total_rounds"] = 2
        log_progress(validation_id, event)
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
    if len(posts) < full_confidence_threshold:
        quality_context += (
            f"  ⚠ LOW DATA: Only {len(posts)} posts scraped "
            f"(minimum {full_confidence_threshold} recommended for reliable analysis). "
            "Penalize confidence accordingly.\n"
        )
    quality_context += "\nCANONICAL VERDICT RULES:\n"
    quality_context += _quality_verdict_rules(len(posts), data_quality) + "\n"

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
        verdict_report = brain.debate(
            verdict_prompt,
            VERDICT_SYSTEM,
            on_progress=on_progress,
            metadata={
                "posts": pre_filtered,
                "trends_data": intel.get("trends", {}),
                "competition_data": intel.get("competition", {}),
                "recon_summary": recon_summary,
                "source_counts": source_counts,
                "total_scraped": len(posts),
                "date_range": kwargs.get("date_range", "recent window"),
                "platforms": ", ".join(sorted(source_counts.keys())) if source_counts else "unknown",
            },
        )
        verdict_report["_source"] = "debate_engine"  # Fix A: mark as real computed result
        changed_roles = []
        for entry in verdict_report.get("debate_log", []) or []:
            if entry.get("round") == 2 and entry.get("changed"):
                role = entry.get("role") or entry.get("model") or "Model"
                changed_roles.append(str(role))
                log_progress(validation_id, {
                    "phase": "debate",
                    "round": 2,
                    "changed": True,
                    "role": role,
                    "message": f"{role} updated position in Round 2",
                })
        if not changed_roles:
            log_progress(validation_id, {
                "phase": "debate",
                "round": 2,
                "changed": False,
                "message": "Debate complete: no model changed position in Round 2",
            })
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
        if data_quality.get("direct_evidence_count", 0) < 5:
            boost_ceiling = data_quality["confidence_cap"]
        else:
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

    adjacent_heavy = _adjacent_heavy_signal(data_quality, source_counts, batch_signals)
    guarded_verdict, guarded_confidence, guardrail_notes = _apply_quality_verdict_guardrails(
        report["verdict"],
        report["confidence"],
        data_quality,
        len(posts),
        pain_validated=pass1.get("pain_validated", False),
        adjacent_heavy=adjacent_heavy,
        test_mode=kwargs.get("test_mode", False),
    )
    if guarded_verdict != report["verdict"] or guarded_confidence != report["confidence"]:
        print(
            f"  [Q] Canonical quality guardrails adjusted verdict/confidence: "
            f"{report['verdict']} {report['confidence']}% → {guarded_verdict} {guarded_confidence}%"
        )
    report["verdict"] = guarded_verdict
    report["confidence"] = guarded_confidence
    capped_confidence = guarded_confidence
    if guardrail_notes:
        data_quality["warnings"].extend(guardrail_notes)

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
    report_direct_count = int(data_quality.get("direct_evidence_count", 0) or 0)
    report_wtp_signals = len((batch_signals or {}).get("wtp_signals", [])) if 'batch_signals' in dir() else 0
    if report_direct_count < 3:
        icp_sanitized = dict(report.get("ideal_customer_profile") or {})
        if report_wtp_signals == 0:
            icp_sanitized["budget_range"] = "Unknown — no willingness-to-pay evidence found"
        report["ideal_customer_profile"] = icp_sanitized
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
        "db_history_posts": int((kwargs.get("scrape_audit", {}) or {}).get("db_history_posts", 0) or 0),
        "pain_quotes_found": len((batch_signals or {}).get("pain_quotes", [])) if 'batch_signals' in dir() else 0,
        "wtp_signals_found": len((batch_signals or {}).get("wtp_signals", [])) if 'batch_signals' in dir() else 0,
        "competitor_mentions": len((batch_signals or {}).get("competitor_mentions", [])) if 'batch_signals' in dir() else 0,
        "partial_coverage": bool((batch_signals or {}).get("partial_coverage", False)) if 'batch_signals' in dir() else False,
        "batches_succeeded": (batch_signals or {}).get("batches_succeeded", 0) if 'batch_signals' in dir() else 0,
        "batches_total": (batch_signals or {}).get("batches_total", 0) if 'batch_signals' in dir() else 0,
        "data_sources": source_counts if 'source_counts' in dir() else {},
        "direct_evidence_count": data_quality.get("direct_evidence_count", 0),
        "adjacent_evidence_count": data_quality.get("adjacent_evidence_count", 0),
        "adjacent_heavy": adjacent_heavy,
        "source_taxonomy": dict((kwargs.get("scrape_audit", {}) or {}).get("source_taxonomy", {})),
    }

    report["problem_validity"] = _build_problem_validity(
        pass1,
        data_quality,
        source_counts,
        dict((kwargs.get("scrape_audit", {}) or {}).get("source_taxonomy", {})),
        batch_signals,
    )
    report["business_validity"] = _build_business_validity(
        pass1,
        pass2,
        intel,
        source_counts,
        batch_signals,
        data_quality,
    )
    report["claim_contract"] = _build_claim_contract(
        report,
        pass1,
        pass2,
        intel,
        data_quality,
        source_counts,
        batch_signals,
    )

    # Risk fallback: Pass 3 often truncates on Groq 8K limit — use debate risks if empty
    report["recon_summary"] = recon_summary or {}
    report["moderator_synthesis"] = verdict_report.get("moderator_synthesis", {}) or {}
    report["first_move"] = verdict_report.get("first_move", "") or ""
    report["timing_analysis"] = verdict_report.get("timing_analysis", {}) or {}
    report["confidence_reasoning"] = verdict_report.get("confidence_reasoning", "") or ""
    # Surface the clean interview question from moderator synthesis
    _mod_synth = verdict_report.get("moderator_synthesis", {}) or {}
    report["interview_question"] = (
        _mod_synth.get("interview_question", "")
        or verdict_report.get("interview_question", "")
        or ""
    )
    usage_summary = {}
    get_usage_summary = getattr(brain, "get_usage_summary", None)
    if callable(get_usage_summary):
        usage_summary = get_usage_summary() or {}
    report["ai_usage"] = verdict_report.get("ai_usage", {}) or usage_summary
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
    debate_evidence = []
    for item in verdict_report.get("evidence", []) or []:
        candidate = dict(item or {})
        code_tier = compute_relevance_tier(
            candidate,
            idea_text,
            decomposition.get("keywords", []),
            decomposition.get("audience", ""),
            decomposition.get("subreddits", []),
        )
        if code_tier == "IRRELEVANT":
            continue
        candidate["relevance_tier"] = code_tier
        debate_evidence.append(
            apply_evidence_taxonomy(
                candidate,
                icp_category=synthesis_icp,
                forced_subreddits=decomposition.get("subreddits", []),
                override_directness="direct" if code_tier == "DIRECT" else "adjacent",
            )
        )
    if not debate_evidence:
        debate_evidence = list(report["market_analysis"].get("evidence", []))
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
    report["claim_verification"] = _run_claim_verification_pass(
        report,
        report["claim_contract"],
        brain,
        validation_id,
    )
    report["evidence_quality"] = _build_evidence_quality_summary(
        report,
        report["claim_verification"],
    )

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
        "minimum_recommended": full_confidence_threshold,
        "data_sufficient": len(posts) >= full_confidence_threshold,
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
        "low_volume_context": data_quality.get("low_volume_context", False),
        "direct_evidence_count": data_quality.get("direct_evidence_count", 0),
        "adjacent_evidence_count": data_quality.get("adjacent_evidence_count", 0),
        "adjacent_heavy": adjacent_heavy,
    }

    report["_audit"] = {
        "idea_icp": str((kwargs.get("scrape_audit", {}) or {}).get("idea_icp", "")),
        "forced_subreddits": list((kwargs.get("scrape_audit", {}) or {}).get("forced_subreddits", [])),
        "occupation_matches": list((kwargs.get("scrape_audit", {}) or {}).get("occupation_matches", [])),
        "occupation_routed_subreddits": list((kwargs.get("scrape_audit", {}) or {}).get("occupation_routed_subreddits", [])),
        "discovered_subreddits": list((kwargs.get("scrape_audit", {}) or {}).get("discovered_subreddits", [])),
        "subreddit_post_counts": dict((kwargs.get("scrape_audit", {}) or {}).get("subreddit_post_counts", {})),
        "source_taxonomy": dict((kwargs.get("scrape_audit", {}) or {}).get("source_taxonomy", {})),
        "db_history_posts": int((kwargs.get("scrape_audit", {}) or {}).get("db_history_posts", 0) or 0),
        "raw_collected_posts": len(posts),
        "filtered_posts_for_synthesis": posts_filtered_count if 'posts_filtered_count' in dir() else len(posts),
        "filtered_posts_analyzed": posts_analyzed_count if 'posts_analyzed_count' in dir() else 0,
        "raw_pain_quotes": list((batch_signals or {}).get("pain_quotes", [])) if 'batch_signals' in dir() else [],
        "raw_wtp_signals": list((batch_signals or {}).get("wtp_signals", [])) if 'batch_signals' in dir() else [],
        "filter_rejected_sample": list((filter_diagnostics or {}).get("rejected_titles_sample", [])) if 'filter_diagnostics' in dir() else [],
        "low_volume_context": data_quality.get("low_volume_context", False),
        "direct_evidence_count": data_quality.get("direct_evidence_count", 0),
        "adjacent_evidence_count": data_quality.get("adjacent_evidence_count", 0),
        "direct_evidence_breakdown": list(pass1.get("_code_evidence_breakdown", data_quality.get("direct_evidence_breakdown", []))),
    }

    report["evidence_funnel"] = {
        "raw_collected_posts": len(posts),
        "filtered_posts_for_synthesis": posts_filtered_count if 'posts_filtered_count' in dir() else len(posts),
        "filtered_posts_analyzed": posts_analyzed_count if 'posts_analyzed_count' in dir() else 0,
        "db_history_posts": int((kwargs.get("scrape_audit", {}) or {}).get("db_history_posts", 0) or 0),
        "canonical_direct_evidence": data_quality.get("direct_evidence_count", 0),
        "canonical_adjacent_evidence": data_quality.get("adjacent_evidence_count", 0),
    }

    direct_count = int(data_quality.get("direct_evidence_count", 0) or 0)
    insufficient_direct_message = _direct_evidence_quality_message(direct_count, adjacent_heavy=adjacent_heavy)
    force_insufficient_direct = direct_count < 3 and not kwargs.get("test_mode", False)
    thin_business_signal = direct_count < 5 and not _wtp_ok
    report["_quality_flags"] = {
        "insufficient_direct_evidence": direct_count < 3,
        "direct_evidence_count": direct_count,
        "adjacent_heavy": adjacent_heavy,
        "suppress_strategy_sections": force_insufficient_direct,
        "message": insufficient_direct_message,
    }
    if force_insufficient_direct:
        report["verdict"] = "INSUFFICIENT DATA"
        hard_cap = 25 if direct_count == 0 else 35
        report["confidence"] = min(int(report.get("confidence", 0) or 0), hard_cap)
        report["executive_summary"] = insufficient_direct_message
        report["market_analysis"]["pain_validated"] = False
        report["market_analysis"]["pain_description"] = insufficient_direct_message
        report["ideal_customer_profile"] = {"speculative": True, "message": insufficient_direct_message}
        report["competition_landscape"] = {
            "speculative": True,
            "message": insufficient_direct_message,
            "market_saturation": report.get("competition_landscape", {}).get("market_saturation", ""),
            "direct_competitors": report.get("competition_landscape", {}).get("direct_competitors", []),
        }
        report["first_move"] = "Talk to 5 potential buyers before writing code."
        report["interview_question"] = "What is the most frustrating part of how you handle this problem today, and how much time or money does it cost you each week?"
        report["timing_analysis"] = {"speculative": True, "message": insufficient_direct_message}
        report["confidence_reasoning"] = insufficient_direct_message
        report["pricing_strategy"] = {"speculative": True, "message": insufficient_direct_message}
        report["monetization_channels"] = []
        report["launch_roadmap"] = []
        report["revenue_projections"] = {}
        report["financial_reality"] = {"speculative": True, "message": insufficient_direct_message}
        report["risk_matrix"] = []
        report["first_10_customers_strategy"] = {"speculative": True, "message": insufficient_direct_message}
        report["mvp_features"] = []
        report["cut_features"] = []
        report["data_quality"]["confidence_was_capped"] = True
        report["data_quality"]["cap_reason"] = insufficient_direct_message
        report["data_quality"]["warnings"] = list(report["data_quality"].get("warnings", [])) + [insufficient_direct_message]
        print(f"  [Q] Forcing verdict to INSUFFICIENT DATA (direct evidence={direct_count})")
    elif thin_business_signal:
        thin_business_message = (
            "Business sections stay directional only here because direct buyer proof is still thin and no willingness-to-pay signals survived the evidence contract."
        )
        pricing_strategy = dict(report.get("pricing_strategy", {}) or {})
        pricing_strategy["speculative"] = True
        pricing_strategy["message"] = thin_business_message
        report["pricing_strategy"] = pricing_strategy

        financial_reality = dict(report.get("financial_reality", {}) or {})
        financial_reality["speculative"] = True
        financial_reality["message"] = thin_business_message
        report["financial_reality"] = financial_reality

        business_validity = dict(report.get("business_validity", {}) or {})
        business_validity["summary"] = thin_business_message
        report["business_validity"] = business_validity

        report["data_quality"]["warnings"] = list(report["data_quality"].get("warnings", [])) + [thin_business_message]

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


def run_synthesis_pass1(
    brain,
    posts,
    idea,
    decomposition=None,
    validation_id="test-pass1",
    depth="quick",
    source_counts=None,
    intel=None,
    test_mode=True,
):
    """Run the first synthesis pass only, using the same prompt contract as Phase 3."""
    depth_config = get_depth_config(depth)
    decomposition = _build_filter_decomposition(idea, decomposition=decomposition)
    source_counts = source_counts or {}
    intel = intel or {}

    with _validation_write_mode(test_mode):
        filtered_posts, _ = _apply_primary_filter_impl(
            posts,
            decomposition,
            idea_text=idea,
            depth_config=depth_config,
            verbose=False,
        )
        candidate_posts = list(filtered_posts)
        sampled_posts = candidate_posts[: min(20, len(candidate_posts))]
        post_summaries = []
        for post in sampled_posts:
            post_summaries.append({
                "title": post.get("title", "")[:200],
                "source": post.get("source", post.get("subreddit", "unknown")),
                "subreddit": post.get("subreddit", ""),
                "score": post.get("score", 0),
                "comments": post.get("num_comments", 0),
                "text_snippet": (post.get("selftext", "") or post.get("text", "") or "")[:300],
            })

        derived_sources = dict(source_counts)
        if not derived_sources:
            for post in candidate_posts:
                source = str(post.get("source") or post.get("subreddit") or "unknown").lower()
                derived_sources[source] = derived_sources.get(source, 0) + 1

        platforms_used = len([name for name, count in derived_sources.items() if count > 0])
        source_summary = ", ".join(
            f"{name}: {count} posts" for name, count in derived_sources.items() if count > 0
        ) or "unknown sources"
        posts_block = f"TOP {len(post_summaries)} POSTS:\n{json.dumps(post_summaries, indent=2)}"
        context_block = f"""IDEA: {idea}

TARGET AUDIENCE: {decomposition.get('audience', '')}
PAIN HYPOTHESIS: {decomposition.get('pain_hypothesis', '')}
COMPETITORS: {', '.join(decomposition.get('competitors', []))}
KEYWORDS: {', '.join(decomposition.get('keywords', []))}

DATA: {len(candidate_posts)} filtered posts (from {len(posts)} total supplied) across {platforms_used} platforms ({source_summary})
"""
        if intel.get("trend_prompt"):
            context_block += intel["trend_prompt"] + "\n"
        if intel.get("comp_prompt"):
            context_block += intel["comp_prompt"] + "\n"

        pass1_prompt = f"""{context_block}

{posts_block}

Analyze the MARKET signal. Find pain validation, WTP signals, and cite specific evidence posts."""
        pass1_raw = brain.single_call(pass1_prompt, PASS1_SYSTEM)
        return extract_json(pass1_raw)


# ═══════════════════════════════════════════════════════
# MAIN PIPELINE
# ═══════════════════════════════════════════════════════

def validate_idea(
    validation_id: str = "",
    idea_text: str = "",
    user_id: str = "",
    depth: str = "quick",
    test_mode: bool = False,
    brain=None,
    configs=None,
    **kwargs,
):
    """Full 3-phase validation pipeline with multi-model debate."""
    idea_text = kwargs.pop("idea", idea_text)
    validation_id = kwargs.pop("validation_id", validation_id) or ("test-validation" if test_mode else "cli-test")
    reddit_lab_input = kwargs.pop("reddit_lab", None)
    reddit_lab = _sanitize_reddit_lab_context(reddit_lab_input)
    depth_config = get_depth_config(depth)
    print(f"\n{'='*50}")
    print(f"  IDEA VALIDATION {validation_id}")
    print(f"  User: {user_id or 'CLI mode'}")
    print(f"  Idea: {idea_text[:100]}...")
    print(f"{'='*50}")
    log_depth_config(depth_config)
    _log_optional_source_config()
    print()

    with _validation_write_mode(test_mode):
        try:
            resolved_configs = list(configs or [])
            if not brain:
                if user_id:
                    print(f"  [>] Loading AI configs for user {user_id}")
                resolved_configs = load_validation_configs(user_id=user_id, test_mode=test_mode)
                if user_id:
                    print(f"  [>] Found {len(resolved_configs)} AI configs for user")
                elif not resolved_configs:
                    print("  [!] No user AI configs found, checking env vars...")

                if not resolved_configs:
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

                brain = AIBrain(resolved_configs)
            else:
                resolved_configs = list(getattr(brain, "configs", resolved_configs) or resolved_configs)

            # Phase 1: Decompose idea
            decomposition = phase1_decompose(idea_text, brain, validation_id, depth_config=depth_config)

            # Dynamic subreddit expansion for future scraper coverage
            if user_id and not test_mode:
                try:
                    new_subs = discover_subreddits(
                        decomposition.get("keywords", [])[:5],
                        forced_subreddits=decomposition.get("subreddits", []),
                        idea_text=idea_text,
                    )
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
            phase2_result = phase2_scrape(
                decomposition["keywords"],
                decomposition.get("colloquial_keywords", []),
                decomposition.get("subreddits", []),
                validation_id,
                depth_config=depth_config,
                idea_text=idea_text,
                audience=decomposition.get("audience", ""),
                known_competitors=decomposition.get("competitors", []),
                reddit_lab=reddit_lab_input,
            )
            if len(phase2_result) == 4:
                posts, source_counts, platform_warnings, scrape_audit = phase2_result
            else:
                posts, source_counts, platform_warnings = phase2_result
                scrape_audit = {"discovered_subreddits": [], "subreddit_post_counts": {}}

            early_competitor_names = []
            early_competitor_complaints = []
            if DEATHWATCH_AVAILABLE and not test_mode:
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
                insufficient_report = {
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
                    "models_used": [f"{c['provider']}/{c['selected_model']}" for c in resolved_configs],
                    "debate_mode": len(resolved_configs) > 1,
                    "reddit_lab_context": reddit_lab,
                }
                update_validation(validation_id, {
                    "status": "done",
                    "verdict": "INSUFFICIENT DATA",
                    "confidence": 0,
                    "report": json.dumps(insufficient_report),
                    "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
                print("\n  [!] No posts found — insufficient data for validation")
                return insufficient_report

            # Phase 3: Synthesize via multi-model debate (with ALL intelligence)
            report = phase3_synthesize(idea_text, posts, decomposition, brain, validation_id,
                                       source_counts=source_counts, intel=intel,
                                       platform_warnings=platform_warnings,
                                       scrape_audit=scrape_audit,
                                       depth_config=depth_config,
                                       test_mode=test_mode)

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
            if reddit_lab:
                report["reddit_lab_context"] = reddit_lab

            # ── Post-Phase: Pain Stream alert (auto-create for return visits) ──
            if PAIN_STREAM_AVAILABLE and user_id and not test_mode:
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
            if DEATHWATCH_AVAILABLE and not test_mode:
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
            return report

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
            reddit_lab=config.get("reddit_lab"),
        )
    else:
        validate_idea(args.validation_id, args.idea, args.user_id)
