"""
Opportunity Engine — Scraper Job (run from your PC)
Master background script that:
  1. Scrapes Reddit + HN + PH + IH + GitHub Issues (+ optional G2 / Jobs)
  2. Clusters posts into idea topics
  3. Calculates the "stock price" for each idea
  4. Stores results in Supabase (ideas + idea_history)
  5. Logs the run in scraper_runs

Usage:
  python scraper_job.py                    # full scan, all sources
  python scraper_job.py --sources reddit   # reddit only
  python scraper_job.py --topics "invoice,crm"  # specific topics only
"""

import os
import sys
import json
import time
import re
import asyncio
import math
import hashlib
import argparse
import traceback
import atexit
import signal
import requests
from datetime import datetime, timezone, timedelta
from collections import Counter, defaultdict
from urllib.parse import quote

# Add engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "engine"))

from env_loader import load_local_env

load_local_env(os.path.dirname(__file__))

from config import TARGET_SUBREDDITS, PAIN_PHRASES, USER_AGENTS, SPAM_PATTERNS, HUMOR_INDICATORS
from pain_stream import check_alerts_against_posts
from competitor_deathwatch import scan_for_complaints, save_complaints
from competition import KNOWN_COMPETITORS
from trends_aggregator import aggregate_trends
from evidence_taxonomy import apply_evidence_taxonomy, summarize_taxonomy
from market_editorial.orchestrator import run_market_editorial_pass
import random

# ── Supabase config ──
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_KEY")
    or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("SUPABASE_KEY", "")
)

# ── Spam/humor compiled patterns ──
_spam_re = [re.compile(p, re.IGNORECASE) for p in SPAM_PATTERNS]
_humor_re = [re.compile(p, re.IGNORECASE) for p in HUMOR_INDICATORS]
BASE_SUBREDDITS = list(TARGET_SUBREDDITS)
_SCHEMA_CACHE = {}
_ACTIVE_SCRAPER_CONTEXT = {}
SCRAPER_RUN_SOURCE_ALIASES = {
    "reddit": "reddit",
    "hackernews": "hn",
    "producthunt": "ph",
    "indiehackers": "ih",
    "githubissues": "github",
    "g2_review": "g2",
    "job_posting": "jobs",
}


# ═══════════════════════════════════════════════════════
# SUPABASE HELPERS
# ═══════════════════════════════════════════════════════

def _headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _error_response(status_code, message, url=""):
    resp = requests.Response()
    resp.status_code = status_code
    resp._content = str(message).encode("utf-8", errors="ignore")
    resp.encoding = "utf-8"
    resp.url = url
    return resp


def _supabase_request(method, url, *, timeout=30, max_attempts=3, retry_backoff=2.0, **kwargs):
    last_error = None
    for attempt in range(max_attempts):
        try:
            resp = requests.request(method, url, timeout=timeout, **kwargs)
            if resp.status_code in {408, 425, 429, 500, 502, 503, 504} and attempt < max_attempts - 1:
                wait_seconds = retry_backoff * (attempt + 1)
                print(f"    [Supabase] {method.upper()} retry {attempt + 1}/{max_attempts - 1} after HTTP {resp.status_code} ({wait_seconds:.1f}s)")
                time.sleep(wait_seconds)
                continue
            return resp
        except requests.exceptions.RequestException as e:
            last_error = e
            if attempt < max_attempts - 1:
                wait_seconds = retry_backoff * (attempt + 1)
                print(f"    [Supabase] {method.upper()} retry {attempt + 1}/{max_attempts - 1} after {type(e).__name__}: {e} ({wait_seconds:.1f}s)")
                time.sleep(wait_seconds)
                continue
    return _error_response(599, f"{type(last_error).__name__}: {last_error}", url=url)


def sb_upsert(table, rows, on_conflict=""):
    """Upsert rows to Supabase. Returns response."""
    h = _headers()
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if on_conflict:
        h["Prefer"] = "resolution=merge-duplicates,return=representation"
        url = f"{url}?on_conflict={quote(on_conflict, safe=',')}"
    r = _supabase_request("post", url, json=rows, headers=h, timeout=45)
    if r.status_code >= 400:
        print(f"    [!] Supabase {table} error {r.status_code}: {r.text[:200]}")
    return r


def sb_select(table, query=""):
    """Select from Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{table}?{query}"
    r = _supabase_request("get", url, headers=_headers(), timeout=20)
    if r.status_code == 200:
        return r.json()
    if r.status_code >= 400:
        print(f"    [!] Supabase {table} select error {r.status_code}: {r.text[:200]}")
    return []


def sb_patch(table, match_query, data):
    """Patch rows in Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{table}?{match_query}"
    h = _headers()
    h["Prefer"] = "return=minimal"
    r = _supabase_request("patch", url, json=data, headers=h, timeout=20)
    if r.status_code >= 400:
        print(f"    [!] Supabase {table} patch error {r.status_code}: {r.text[:200]}")
    return r


def sb_rpc(fn_name, params=None):
    """Invoke a Supabase RPC function."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/{fn_name}"
    r = _supabase_request("post", url, json=params or {}, headers=_headers(), timeout=45)
    if r.status_code >= 400:
        print(f"    [!] Supabase RPC {fn_name} error {r.status_code}: {r.text[:200]}")
    return r


def _chunk_rows(rows, chunk_size):
    for index in range(0, len(rows), chunk_size):
        yield rows[index:index + chunk_size]


def _bulk_upsert_rows(table, rows, *, on_conflict="", chunk_size=25, id_fn=None):
    if not rows:
        return 0, []

    success_count = 0
    failure_ids = []
    identify = id_fn or (lambda row: str(row.get("slug") or row.get("id") or "unknown"))
    all_keys = []
    seen_keys = set()
    for row in rows:
        for key in row.keys():
            if key in seen_keys:
                continue
            seen_keys.add(key)
            all_keys.append(key)
    normalized_rows = [{key: row.get(key) for key in all_keys} for row in rows]

    for chunk in _chunk_rows(normalized_rows, chunk_size):
        response = sb_upsert(table, chunk, on_conflict=on_conflict)
        if response.status_code < 400:
            success_count += len(chunk)
            continue

        # Fall back to row-by-row writes so one bad write or transient timeout
        # does not throw away a whole scan batch.
        for row in chunk:
            single = sb_upsert(table, [row], on_conflict=on_conflict)
            if single.status_code < 400:
                success_count += 1
            else:
                failure_ids.append(identify(row))

    return success_count, failure_ids


def _format_scraper_run_source_value(sources):
    full_value = ",".join(str(source or "").strip() for source in (sources or []) if str(source or "").strip())
    if len(full_value) <= 50:
        return full_value

    compact_value = ",".join(
        SCRAPER_RUN_SOURCE_ALIASES.get(str(source or "").strip(), str(source or "").strip())
        for source in (sources or [])
        if str(source or "").strip()
    )
    if len(compact_value) <= 50:
        return compact_value

    return compact_value[:50]


def _finalize_active_scraper_context(status="failed", note="Process exited before finalizing scraper run"):
    run_id = _ACTIVE_SCRAPER_CONTEXT.get("run_id")
    if not run_id:
        return

    start_time = _ACTIVE_SCRAPER_CONTEXT.get("start_time", time.time())
    posts_collected = int(_ACTIVE_SCRAPER_CONTEXT.get("posts_collected", 0) or 0)
    ideas_updated = int(_ACTIVE_SCRAPER_CONTEXT.get("ideas_updated", 0) or 0)
    finalize_scraper_run_record(
        run_id,
        status,
        start_time,
        posts_collected=posts_collected,
        ideas_updated=ideas_updated,
        notes=[note],
    )
    _ACTIVE_SCRAPER_CONTEXT.clear()


def _handle_scraper_signal(signum, _frame):
    signal_name = getattr(signal, "Signals", lambda value: value)(signum)
    if hasattr(signal_name, "name"):
        signal_name = signal_name.name
    _finalize_active_scraper_context(
        "failed",
        f"Received signal {signal_name}",
    )
    raise SystemExit(128 + int(signum))


atexit.register(_finalize_active_scraper_context)
for _sig in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
    if _sig is None:
        continue
    try:
        signal.signal(_sig, _handle_scraper_signal)
    except Exception:
        pass


def table_has_column(table, column):
    """Best-effort schema check so scraper upgrades don't break older DBs."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return True

    cache_key = (table, column)
    if cache_key in _SCHEMA_CACHE:
        return _SCHEMA_CACHE[cache_key]

    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=_headers(),
            params={"select": column, "limit": 1},
            timeout=10,
        )
        exists = resp.status_code == 200
    except Exception:
        exists = False

    _SCHEMA_CACHE[cache_key] = exists
    return exists


def load_user_requested_subreddits():
    """Merge user-discovered subreddits with the base scraper coverage."""
    if not SUPABASE_URL:
        return BASE_SUBREDDITS
    rows = sb_select("user_requested_subreddits", "select=subreddit")
    extra_subs = [row["subreddit"] for row in rows if row.get("subreddit")]
    all_subs = list(dict.fromkeys(BASE_SUBREDDITS + extra_subs))
    print(f"  [Scraper] Covering {len(all_subs)} subreddits ({len(extra_subs)} user-discovered)")
    return all_subs


def _has_market_g2_credentials():
    return bool(
        os.environ.get("G2_API_TOKEN", "").strip()
        or os.environ.get("G2_ACCESS_TOKEN", "").strip()
        or os.environ.get("G2_TOKEN", "").strip()
    )


def _has_market_job_credentials():
    return bool(
        os.environ.get("ADZUNA_APP_ID", "").strip()
        and os.environ.get("ADZUNA_APP_KEY", "").strip()
    )


def default_market_sources():
    sources = ["reddit", "hackernews", "producthunt", "indiehackers", "githubissues"]
    if _has_market_g2_credentials():
        sources.append("g2_review")
    if _has_market_job_credentials():
        sources.append("job_posting")
    return sources


def _rank_market_topic_targets(posts, topic_filter=None):
    ranked = []
    seen = set()

    for slug in topic_filter or []:
        clean = str(slug or "").strip()
        if clean and clean in TRACKED_TOPICS and clean not in seen:
            seen.add(clean)
            ranked.append(clean)

    counts = Counter()
    for post in posts or []:
        for slug in classify_post_to_topics(post):
            if slug in TRACKED_TOPICS:
                counts[slug] += 1

    for slug, _count in counts.most_common():
        if slug not in seen:
            seen.add(slug)
            ranked.append(slug)

    for slug in TRACKED_TOPICS.keys():
        if slug not in seen:
            seen.add(slug)
            ranked.append(slug)

    return ranked


def _filter_market_topic_targets(topic_slugs, allowed_categories=None, limit=4):
    allowed = set(allowed_categories or [])
    selected = []
    for slug in topic_slugs or []:
        topic_info = TRACKED_TOPICS.get(slug) or {}
        category = str(topic_info.get("category") or "").strip().lower()
        if allowed and category not in allowed:
            continue
        selected.append(slug)
        if len(selected) >= limit:
            break
    return selected


def reconcile_stale_scraper_runs(max_age_hours=6):
    """Mark abandoned scraper_runs so the dashboard doesn't show zombie jobs forever."""
    if not SUPABASE_URL:
        return 0

    stale_before = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    running_rows = sb_select("scraper_runs", "select=id,started_at,status&status=eq.running")
    reconciled = 0

    for row in running_rows:
        started_at = _parse_datetime(row.get("started_at"))
        if not started_at or started_at >= stale_before:
            continue
        resp = sb_patch("scraper_runs", f"id=eq.{row['id']}", {
            "status": "failed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "error_text": f"Marked stale after exceeding {max_age_hours}h without completion",
        })
        if resp.status_code < 400:
            reconciled += 1

    if reconciled:
        print(f"  [Scraper] Reconciled {reconciled} stale scraper_runs row(s)")
    return reconciled


def _count_source_posts(posts, source_prefix):
    return sum(1 for post in posts if str(post.get("source", "")).startswith(source_prefix))


def _should_retry_reddit_sync(async_stats, async_added, requested_subs):
    if async_added < 10:
        return True
    if not async_stats:
        return False

    request_total = max(async_stats.get("requested_requests", 0), 1)
    failure_ratio = async_stats.get("failed_requests", 0) / request_total
    covered = async_stats.get("subreddits_with_posts", 0)
    coverage_ratio = covered / max(len(requested_subs), 1)
    return failure_ratio >= 0.4 or coverage_ratio < 0.3


def _reddit_health_summary(subreddits, live_posts, async_stats=None, pullpush_posts=0, praw_posts=0, sitemap_posts=0):
    reddit_live = [post for post in live_posts if str(post.get("source", "")).startswith("reddit")]
    counts = Counter(post.get("subreddit", "") for post in reddit_live if post.get("subreddit"))
    covered = sum(1 for sub in subreddits if counts.get(sub, 0) > 0)
    coverage_ratio = covered / max(len(subreddits), 1)

    warnings = []
    if async_stats:
        failed_requests = async_stats.get("failed_requests", 0)
        request_total = max(async_stats.get("requested_requests", 0), 1)
        if failed_requests:
            warnings.append(f"async failures {failed_requests}/{request_total}")
    if not reddit_live:
        warnings.append("no live Reddit posts collected")
    elif coverage_ratio < 0.3:
        warnings.append(f"low subreddit coverage {covered}/{len(subreddits)}")
    if pullpush_posts and not reddit_live:
        warnings.append("historical-only Reddit signal")

    summary = (
        f"live={len(reddit_live)}, covered={covered}/{len(subreddits)}, "
        f"pullpush={pullpush_posts}, sitemap={sitemap_posts}, praw={praw_posts}"
    )
    return {
        "is_degraded": bool(warnings),
        "warnings": warnings,
        "summary": summary,
    }


def _format_source_health_note(healthy_sources, degraded_sources):
    healthy = ",".join(sorted(set(filter(None, healthy_sources)))) or "none"
    degraded = ",".join(sorted(set(filter(None, degraded_sources)))) or "none"
    return f"Source health: healthy={healthy}; degraded={degraded}"


def _clean_run_note_value(value):
    text = str(value or "").replace("|", "/").replace("\n", " ").replace("\r", " ")
    text = text.replace(";", ",").strip()
    return text or "none"


def _format_runner_note(source_label):
    return f"Run metadata: caller={_clean_run_note_value(source_label)}"


def _format_reddit_health_note(access_mode, post_count, successful_requests, failed_requests, degraded_reason=""):
    return (
        "Reddit health: "
        f"mode={_clean_run_note_value(access_mode)}; "
        f"posts={int(post_count or 0)}; "
        f"success={int(successful_requests or 0)}; "
        f"failed={int(failed_requests or 0)}; "
        f"reason={_clean_run_note_value(degraded_reason or 'none')}"
    )


def _format_market_funnel_note(funnel):
    return (
        "Market funnel: "
        f"scraped={int(funnel.get('scraped_posts', 0) or 0)}; "
        f"matched={int(funnel.get('matched_posts', 0) or 0)}; "
        f"unmatched={int(funnel.get('unmatched_posts', 0) or 0)}; "
        f"builder_meta={int(funnel.get('builder_meta_filtered_posts', 0) or 0)}; "
        f"dynamic={int(funnel.get('dynamic_topics', 0) or 0)}; "
        f"buckets={int(funnel.get('subreddit_bucket_topics', 0) or 0)}; "
        f"invalid={int(funnel.get('invalid_topic_skips', 0) or 0)}; "
        f"weak={int(funnel.get('weak_topic_skips', 0) or 0)}; "
        f"ideas={int(funnel.get('final_ideas', 0) or 0)}"
    )


def finalize_scraper_run_record(run_id, status, start_time, posts_collected=0, ideas_updated=0, notes=None):
    if not run_id or not SUPABASE_URL:
        return

    structured_prefixes = ("Source health:", "Run metadata:", "Reddit health:", "Market funnel:")
    structured_notes = [note for note in (notes or []) if str(note or "").startswith(structured_prefixes)]
    regular_notes = [note for note in (notes or []) if not str(note or "").startswith(structured_prefixes)]
    budget = max(0, 8 - len(structured_notes))
    persisted_notes = regular_notes[:budget] + structured_notes[:8]
    error_text = " | ".join(persisted_notes[:8]) if persisted_notes else None
    sb_patch("scraper_runs", f"id=eq.{run_id}", {
        "status": status,
        "posts_collected": posts_collected,
        "ideas_updated": ideas_updated,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": round(time.time() - start_time, 1),
        "error_text": error_text,
    })


def _to_iso_datetime(value):
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
        except Exception:
            return datetime.now(timezone.utc).isoformat()
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
        except Exception:
            return datetime.now(timezone.utc).isoformat()
    return datetime.now(timezone.utc).isoformat()


def _to_epoch_timestamp(value):
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except Exception:
            return 0.0
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0.0
    return 0.0


def _parse_datetime(value):
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except Exception:
            return None
    return None


def _coerce_float(value, default=0.0):
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _should_advance_baseline(last_update, now_utc, interval):
    if last_update is None:
        return True
    return now_utc - last_update >= interval


def _resolve_score_baselines(existing, now_utc):
    if not existing:
        return {
            "prev_24h": 0.0,
            "prev_7d": 0.0,
            "prev_30d": 0.0,
            "next_score_24h_ago": 0.0,
            "next_score_7d_ago": 0.0,
            "next_score_30d_ago": 0.0,
            "next_last_24h_update": now_utc.isoformat(),
            "next_last_7d_update": now_utc.isoformat(),
        }

    existing_current = _coerce_float(existing.get("current_score"))
    stored_24h = _coerce_float(existing.get("score_24h_ago"))
    stored_7d = _coerce_float(existing.get("score_7d_ago"))
    stored_30d = _coerce_float(existing.get("score_30d_ago"))

    last_24h_update = _parse_datetime(existing.get("last_24h_update"))
    last_7d_update = _parse_datetime(existing.get("last_7d_update"))

    prev_24h = stored_24h if stored_24h > 0 else existing_current
    next_score_24h_ago = stored_24h
    next_last_24h_update = last_24h_update.isoformat() if last_24h_update else now_utc.isoformat()

    if _should_advance_baseline(last_24h_update, now_utc, timedelta(hours=24)) or stored_24h <= 0:
        prev_24h = existing_current
        next_score_24h_ago = existing_current
        next_last_24h_update = now_utc.isoformat()

    prev_7d = stored_7d if stored_7d > 0 else 0.0
    next_score_7d_ago = stored_7d
    next_last_7d_update = last_7d_update.isoformat() if last_7d_update else now_utc.isoformat()

    if _should_advance_baseline(last_7d_update, now_utc, timedelta(days=7)):
        rolled_7d = stored_24h if stored_24h > 0 else existing_current
        next_score_7d_ago = rolled_7d
        next_last_7d_update = now_utc.isoformat()
        prev_7d = rolled_7d

    prev_30d = stored_30d if stored_30d > 0 else 0.0

    return {
        "prev_24h": prev_24h,
        "prev_7d": prev_7d,
        "prev_30d": prev_30d,
        "next_score_24h_ago": next_score_24h_ago,
        "next_score_7d_ago": next_score_7d_ago,
        "next_score_30d_ago": stored_30d,
        "next_last_24h_update": next_last_24h_update,
        "next_last_7d_update": next_last_7d_update,
    }


def _post_activity_timestamp(post):
    """Recent-signal timestamp with scraped_at fallback for live feeds."""
    created_ts = _to_epoch_timestamp(post.get("created_utc", 0))
    if created_ts > 0:
        return created_ts
    return _to_epoch_timestamp(post.get("scraped_at", 0))


def _build_source_breakdown(posts):
    counter = Counter(post.get("source", "unknown") for post in posts if post.get("source"))
    return [
        {"platform": platform, "count": count}
        for platform, count in counter.most_common()
    ]


def _build_pain_summary(posts, topic_name=""):
    phrase_counter = Counter()
    supporting_titles = []
    matched_posts = 0

    sorted_posts = sorted(
        posts,
        key=lambda post: int(post.get("score", 0) or 0) + int(post.get("num_comments", 0) or 0),
        reverse=True,
    )

    for post in sorted_posts:
        text_lower = f"{post.get('title', '')} {post.get('full_text', '')} {post.get('body', '')}".lower()
        matches = []
        for phrase in PAIN_PHRASES[:30]:
            normalized = phrase.lower()
            if normalized in text_lower:
                matches.append(normalized)

        if not matches:
            continue

        matched_posts += 1
        phrase_counter.update(matches[:3])
        title = (post.get("title", "") or "").strip()
        if title and len(supporting_titles) < 2:
            supporting_titles.append(title[:120])

    if matched_posts == 0:
        return None, 0

    clean_topic = (topic_name or "").replace("_", " ").strip().lower()
    if supporting_titles:
        if clean_topic:
            summary = f"Users keep raising the same pain around {clean_topic}. Representative post: {supporting_titles[0]}."
        else:
            summary = f"Users keep raising the same workflow pain. Representative post: {supporting_titles[0]}."
    elif clean_topic:
        summary = f"Users keep raising the same pain around {clean_topic}."
    else:
        summary = "Users keep raising the same workflow pain."

    return summary[:420], matched_posts


MARKET_PAIN_KEYWORDS = [
    "hate", "frustrated", "struggling", "help",
    "issue", "problem", "broken", "slow",
    "expensive", "annoying", "anyone else",
    "does anyone", "how do i", "why does",
    "can't", "cannot", "won't", "doesn't work",
    "need help", "looking for", "recommendations",
    "alternative", "manual", "tedious", "waste",
    "hours", "every month", "pain", "tired of",
    "sick of", "wish there was", "dream of",
]


def _compose_post_text(post):
    """Combine the post fields we actually scrape across platforms."""
    return " ".join(
        str(part).strip()
        for part in (
            post.get("title", ""),
            post.get("body", ""),
            post.get("selftext", ""),
            post.get("full_text", ""),
        )
        if str(part).strip()
    )


def _normalized_market_source(post):
    """Normalize raw scraper sources for market-card display."""
    source = (post.get("source", "") or "").strip().lower()
    if source.startswith("reddit"):
        return "reddit"
    return source


def is_pain_post(post):
    text = _compose_post_text(post).lower()
    return any(keyword in text for keyword in MARKET_PAIN_KEYWORDS)


def pain_score(post):
    text = _compose_post_text(post).lower()
    return sum(1 for keyword in MARKET_PAIN_KEYWORDS if keyword in text)


def _normalize_market_posts_with_taxonomy(posts):
    normalized = []
    for post in posts or []:
        normalized.append(apply_evidence_taxonomy(post, icp_category="", forced_subreddits=[]))
    return normalized


def _engagement_score(post):
    return int(post.get("score", 0) or 0) + int(post.get("num_comments", 0) or 0)


def _normalize_market_signal_text(value):
    return (value or "").strip().lower()


def _is_launch_meta_market_post(post):
    title = _normalize_market_signal_text(post.get("title", ""))
    signal_kind = _normalize_market_signal_text(post.get("signal_kind", ""))
    voice_type = _normalize_market_signal_text(post.get("voice_type", ""))
    source = _normalized_market_source(post)

    if signal_kind == "launch_discussion":
        return True
    if source == "hackernews" and re.match(r"^(show|launch|ask)\s+hn:", title):
        return True
    if source == "indiehackers" and re.match(r"^(show|launch)\s+ih:", title):
        return True
    if source == "producthunt" and re.match(r"^(show|launch)\s+ph:", title):
        return True
    if voice_type == "founder" and "i built" in title:
        return True
    if voice_type in {"founder", "developer"} and ("open-source" in title or "open source" in title):
        return True
    return False


def _is_buyer_native_market_post(post):
    voice_type = _normalize_market_signal_text(post.get("voice_type", ""))
    source_class = _normalize_market_signal_text(post.get("source_class", ""))
    return voice_type in {"buyer", "operator"} or source_class in {"review", "jobs"}


def _market_post_support_rank(post):
    directness = _normalize_market_signal_text(post.get("directness_tier", ""))
    signal_kind = _normalize_market_signal_text(post.get("signal_kind", ""))
    launch_meta = _is_launch_meta_market_post(post)
    buyer_native = _is_buyer_native_market_post(post)

    if not launch_meta and buyer_native and directness == "direct":
        return 3

    if not launch_meta and (
        directness == "adjacent"
        or (buyer_native and directness == "supporting")
        or signal_kind in {"complaint", "workaround", "feature_request", "review_complaint", "willingness_to_pay"}
    ):
        return 2

    return 1


def _market_support_level_from_top_posts(top_posts, source_breakdown=None, source_count=None):
    top_posts = top_posts or []
    source_breakdown = source_breakdown or []
    resolved_source_count = int(source_count or len(source_breakdown) or 0)
    buyer_native_direct_count = sum(
        1 for post in top_posts
        if (post.get("market_support_level") or "") == "evidence_backed"
    )
    supporting_signal_count = sum(
        1 for post in top_posts
        if (post.get("market_support_level") or "") == "supporting_context"
    )
    launch_meta_count = sum(1 for post in top_posts if _is_launch_meta_market_post(post))
    dominant_platform = None
    if source_breakdown:
        dominant_platform = str(
            max(source_breakdown, key=lambda item: int(item.get("count", 0) or 0)).get("platform", "") or ""
        ).lower() or None
    single_source = resolved_source_count < 2
    hn_launch_heavy = dominant_platform == "hackernews" and launch_meta_count >= 2 and buyer_native_direct_count == 0

    support_level = "hypothesis"
    if (buyer_native_direct_count >= 2 and not single_source) or buyer_native_direct_count >= 3:
        support_level = "evidence_backed"
    elif buyer_native_direct_count >= 1 or supporting_signal_count >= 2:
        support_level = "supporting_context"

    if hn_launch_heavy:
        support_level = "hypothesis"

    return {
        "support_level": support_level,
        "buyer_native_direct_count": buyer_native_direct_count,
        "supporting_signal_count": supporting_signal_count,
        "launch_meta_count": launch_meta_count,
        "single_source": single_source,
        "hn_launch_heavy": hn_launch_heavy,
        "dominant_platform": dominant_platform,
    }


def _calculate_market_evidence_quality(signal_posts, source_breakdown=None):
    signal_posts = signal_posts or []
    source_breakdown = source_breakdown or _build_source_breakdown(signal_posts)

    if not signal_posts:
        return 0.0, {
            "buyer_native_direct_count": 0,
            "supporting_signal_count": 0,
            "launch_meta_count": 0,
            "buyer_native_count": 0,
            "source_count": len(source_breakdown),
            "single_source": len(source_breakdown) < 2,
            "hn_launch_heavy": False,
        }

    source_count = len(source_breakdown)
    support_rank_counts = Counter(_market_post_support_rank(post) for post in signal_posts)
    buyer_native_direct_count = int(support_rank_counts.get(3, 0))
    supporting_signal_count = int(support_rank_counts.get(2, 0))
    launch_meta_count = sum(1 for post in signal_posts if _is_launch_meta_market_post(post))
    buyer_native_count = sum(1 for post in signal_posts if _is_buyer_native_market_post(post))
    dominant_platform = None
    if source_breakdown:
        dominant_platform = str(
            max(source_breakdown, key=lambda item: int(item.get("count", 0) or 0)).get("platform", "") or ""
        ).lower() or None

    single_source = source_count < 2
    hn_launch_heavy = dominant_platform == "hackernews" and launch_meta_count >= 2 and buyer_native_direct_count == 0
    total_posts = max(len(signal_posts), 1)

    direct_ratio = buyer_native_direct_count / total_posts
    supporting_ratio = supporting_signal_count / total_posts
    buyer_native_ratio = buyer_native_count / total_posts
    launch_meta_ratio = launch_meta_count / total_posts

    quality_score = (
        min(buyer_native_direct_count, 4) * 18 +
        min(supporting_signal_count, 5) * 8 +
        min(source_count, 4) * 7 +
        buyer_native_ratio * 12 +
        supporting_ratio * 10 -
        launch_meta_ratio * 35 -
        (8 if single_source else 0) -
        (12 if buyer_native_direct_count == 0 else 0)
    )

    if buyer_native_direct_count == 0 and supporting_signal_count == 0:
        quality_score = min(quality_score, 22)

    if hn_launch_heavy:
        quality_score = min(quality_score, 15)

    return max(0.0, min(100.0, round(quality_score, 1))), {
        "buyer_native_direct_count": buyer_native_direct_count,
        "supporting_signal_count": supporting_signal_count,
        "launch_meta_count": launch_meta_count,
        "buyer_native_count": buyer_native_count,
        "source_count": source_count,
        "single_source": single_source,
        "hn_launch_heavy": hn_launch_heavy,
    }


MARKET_LEADER_STOPWORDS = {
    "reddit", "hacker news", "hackernews", "indie hackers", "indiehackers", "product hunt", "producthunt",
    "show hn", "ask hn", "launch ph", "show ih", "launch ih", "ai", "api", "saas", "tool", "tools",
    "software", "platform", "solution", "startup", "founder", "company", "business", "team", "teams",
    "workflow", "automation", "invoice automation", "accounting automation", "project management",
    "customer support", "email marketing", "landing page", "social media", "browser", "copilot",
    "spreadsheet", "billing", "invoicing", "crm", "erp",
}

MARKET_LEADER_CONTEXT_PATTERNS = [
    re.compile(
        r"(?:(?i:alternative\s+to|alternatives\s+to|replace|replacing|replacement\s+for|switched\s+from|switch\s+from|"
        r"migrated\s+from|migrate\s+from|vs\.?|versus|compare(?:d)?\s+to|using|use))\s+"
        r"([A-Z0-9][A-Za-z0-9+.#/\-]*(?:\s+[A-Z0-9][A-Za-z0-9+.#/\-]*){0,2})"
    ),
]


def _normalize_market_leader_name(value):
    cleaned = re.sub(r"\s+", " ", str(value or "")).strip(" \t\r\n-:;,.'\"()[]{}")
    cleaned = re.sub(r"(?:'s|’s)$", "", cleaned)
    if not cleaned:
        return ""

    words = [word for word in cleaned.split() if word]
    if len(words) > 3:
        words = words[:3]
    cleaned = " ".join(words).strip()
    lowered = cleaned.lower()

    if len(cleaned) < 3 or lowered in MARKET_LEADER_STOPWORDS:
        return ""
    if re.fullmatch(r"[0-9\W_]+", cleaned):
        return ""

    return cleaned


def _build_market_leaders(topic_slug, topic_name, posts, keywords=None, limit=4):
    posts = posts or []
    keywords = keywords or []
    topic_text = " ".join(
        part for part in [
            str(topic_slug or "").replace("-", " "),
            str(topic_name or ""),
            *[str(keyword or "") for keyword in keywords or []],
        ]
        if str(part).strip()
    ).lower()

    canonical_lookup = {}
    seeded_competitors = []
    for category_key, data in KNOWN_COMPETITORS.items():
        competitors = data.get("competitors", []) or []
        for competitor in competitors:
            name = _normalize_market_leader_name(competitor.get("name", "") if isinstance(competitor, dict) else competitor)
            if name:
                canonical_lookup[name.lower()] = name

        triggers = [category_key.replace("_", " ")] + list(data.get("triggers", []) or [])
        if any(str(trigger or "").lower() in topic_text for trigger in triggers if str(trigger or "").strip()):
            for competitor in competitors:
                if isinstance(competitor, dict):
                    seeded_competitors.append(competitor)
                else:
                    seeded_competitors.append({"name": competitor})

    leader_stats = {}

    def _get_stat(name):
        stat = leader_stats.setdefault(name, {
            "name": name,
            "posts": set(),
            "sources": set(),
            "buyer_signal_count": 0,
            "supporting_signal_count": 0,
            "engagement": 0,
            "seeded": False,
            "known_weakness": None,
            "price": None,
            "users": None,
        })
        return stat

    for competitor in seeded_competitors:
        canonical = _normalize_market_leader_name(competitor.get("name", "") if isinstance(competitor, dict) else competitor)
        if not canonical:
            continue
        stat = _get_stat(canonical)
        stat["seeded"] = True
        if isinstance(competitor, dict):
            stat["known_weakness"] = competitor.get("weakness") or stat["known_weakness"]
            stat["price"] = competitor.get("price") or stat["price"]
            stat["users"] = competitor.get("users") or stat["users"]

    for post in posts:
        text = _compose_post_text(post)
        if not text:
            continue
        text_lower = text.lower()
        post_key = _market_post_key(post) or post.get("title") or text[:120]
        source_name = _normalized_market_source(post)

        mentioned_names = set()

        for alias_lower, canonical in canonical_lookup.items():
            if alias_lower and alias_lower in text_lower:
                mentioned_names.add(canonical)

        for pattern in MARKET_LEADER_CONTEXT_PATTERNS:
            for match in pattern.finditer(text):
                raw_candidate = match.group(1)
                candidate = _normalize_market_leader_name(raw_candidate)
                if not candidate:
                    continue
                canonical = canonical_lookup.get(candidate.lower())
                if not canonical:
                    tokens = [token for token in raw_candidate.split() if token]
                    if not tokens or not all(re.fullmatch(r"[A-Z0-9][A-Za-z0-9+.#/\-]*", token) for token in tokens):
                        continue
                    canonical = candidate
                mentioned_names.add(canonical)

        if not mentioned_names:
            continue

        for canonical in mentioned_names:
            stat = _get_stat(canonical)
            stat["posts"].add(post_key)
            if source_name:
                stat["sources"].add(source_name)
            if _is_buyer_native_market_post(post):
                stat["buyer_signal_count"] += 1
            if _market_post_support_rank(post) >= 2:
                stat["supporting_signal_count"] += 1
            stat["engagement"] += min(_engagement_score(post), 120)

    live_leaders = []
    inferred_leaders = []
    for stat in leader_stats.values():
        mention_count = len(stat["posts"])
        source_count = len(stat["sources"])
        score = (
            mention_count * 5 +
            stat["buyer_signal_count"] * 4 +
            stat["supporting_signal_count"] * 2 +
            source_count * 3 +
            min(stat["engagement"] / 80, 3)
        )
        if stat["seeded"] and mention_count > 0:
            score += 2

        row = {
            "name": stat["name"],
            "mention_count": mention_count,
            "source_count": source_count,
            "buyer_signal_count": stat["buyer_signal_count"],
            "supporting_signal_count": stat["supporting_signal_count"],
            "evidence_mode": "hybrid" if stat["seeded"] and mention_count > 0 else ("live_mentions" if mention_count > 0 else "known_market_map"),
            "known_weakness": stat["known_weakness"],
            "price": stat["price"],
            "users": stat["users"],
            "leader_score": round(score, 1),
        }

        if mention_count > 0:
            live_leaders.append(row)
        elif stat["seeded"]:
            inferred_leaders.append(row)

    live_leaders.sort(
        key=lambda row: (
            int(row.get("mention_count", 0) or 0),
            int(row.get("buyer_signal_count", 0) or 0),
            int(row.get("source_count", 0) or 0),
            float(row.get("leader_score", 0) or 0),
        ),
        reverse=True,
    )
    inferred_leaders.sort(
        key=lambda row: (
            float(row.get("leader_score", 0) or 0),
            row.get("name", ""),
        ),
        reverse=True,
    )

    selected = live_leaders[:limit]
    if len(selected) < limit:
        for row in inferred_leaders:
            if row["name"] in {item["name"] for item in selected}:
                continue
            selected.append(row)
            if len(selected) >= limit:
                break

    if not selected:
        return None

    live_names = [row["name"] for row in selected if row["mention_count"] > 0][:3]
    if live_names:
        summary = f"Recurring competitor mentions center on {', '.join(live_names)}."
    else:
        summary = f"Known incumbents in this workflow include {', '.join(row['name'] for row in selected[:3])}."

    return {
        "available": True,
        "market_leaders_summary": summary,
        "direct_competitors": selected,
        "extraction_method": "hybrid" if live_names and any(row["mention_count"] == 0 for row in selected) else ("live_mentions" if live_names else "known_market_map"),
    }


def _confidence_rank(level):
    return {
        "INSUFFICIENT": 0,
        "LOW": 1,
        "MEDIUM": 2,
        "HIGH": 3,
        "STRONG": 4,
    }.get(str(level or "").upper(), 0)


def _min_confidence_level(level, cap):
    if _confidence_rank(level) <= _confidence_rank(cap):
        return level
    return cap


def build_top_posts_for_topic(posts):
    """
    Select representative topic posts for the Market page.
    Buyer-native direct pain should beat launch chatter and generic tool posts.
    """
    if not posts:
        return []

    deduped = {}
    for post in posts:
        key = post.get("external_id") or post.get("permalink") or post.get("url") or post.get("title")
        if key and key not in deduped:
            deduped[key] = post

    ranked_posts = sorted(
        deduped.values(),
        key=lambda post: (
            _market_post_support_rank(post),
            1 if _is_buyer_native_market_post(post) else 0,
            1 if not _is_launch_meta_market_post(post) else 0,
            pain_score(post),
            _engagement_score(post),
        ),
        reverse=True,
    )
    pain_posts = [
        post for post in ranked_posts
        if _market_post_support_rank(post) >= 2 or is_pain_post(post)
    ]

    selected = list(pain_posts[:5])
    if len(selected) < 3:
        for post in ranked_posts:
            key = post.get("external_id") or post.get("permalink") or post.get("url") or post.get("title")
            if key and all(
                key != (picked.get("external_id") or picked.get("permalink") or picked.get("url") or picked.get("title"))
                for picked in selected
            ):
                selected.append(post)
            if len(selected) >= 5:
                break

    available_sources = []
    for post in ranked_posts:
        source = _normalized_market_source(post)
        if source and source not in available_sources:
            available_sources.append(source)

    def _rank_tuple(post):
        return (
            _market_post_support_rank(post),
            1 if _is_buyer_native_market_post(post) else 0,
            1 if not _is_launch_meta_market_post(post) else 0,
            pain_score(post),
            _engagement_score(post),
        )

    selected = selected[:5]
    for source in available_sources:
        if source in {_normalized_market_source(post) for post in selected}:
            continue

        replacement = next((post for post in ranked_posts if _normalized_market_source(post) == source), None)
        if not replacement:
            continue

        if len(selected) < 5:
            selected.append(replacement)
            continue

        selected_counts = Counter(_normalized_market_source(post) for post in selected)
        replace_index = None
        weakest_rank = None
        for index, post in enumerate(selected):
            post_source = _normalized_market_source(post)
            if selected_counts.get(post_source, 0) <= 1:
                continue
            current_rank = _rank_tuple(post)
            if weakest_rank is None or current_rank < weakest_rank:
                weakest_rank = current_rank
                replace_index = index

        if replace_index is not None:
            selected[replace_index] = replacement

    selected.sort(key=_rank_tuple, reverse=True)

    return [{
        "title": (post.get("title", "") or "")[:200],
        "source": _normalized_market_source(post),
        "subreddit": post.get("subreddit", ""),
        "score": int(post.get("score", 0) or 0),
        "comments": int(post.get("num_comments", 0) or 0),
        "url": post.get("permalink") or post.get("url") or "",
        "pain_score": pain_score(post),
        "source_class": post.get("source_class", ""),
        "source_name": post.get("source_name", _normalized_market_source(post)),
        "voice_type": post.get("voice_type", ""),
        "signal_kind": post.get("signal_kind", ""),
        "evidence_layer": post.get("evidence_layer", ""),
        "directness_tier": post.get("directness_tier", ""),
        "reliability_tier": post.get("reliability_tier", ""),
        "market_support_level": (
            "evidence_backed" if _market_post_support_rank(post) == 3
            else "supporting_context" if _market_post_support_rank(post) == 2
            else "hypothesis"
        ),
    } for post in selected[:5]]


def store_posts(rows):
    """Persist raw posts so Realtime, alerts, and trend aggregation have live data."""
    if not SUPABASE_URL or not rows:
        return 0

    posts_has_source = table_has_column("posts", "source")
    posts_has_score_breakdown = table_has_column("posts", "score_breakdown")
    payload = []
    for post in rows[:2000]:
        external_id = post.get("external_id") or post.get("id") or hashlib.md5(
            f"{post.get('source', 'unknown')}::{post.get('title', '')}".encode("utf-8", errors="ignore")
        ).hexdigest()
        row = {
            "id": f"{post.get('source', 'src')}_{external_id}",
            "title": post.get("title", "")[:500],
            "selftext": (post.get("body") or post.get("selftext") or "")[:5000],
            "full_text": (post.get("full_text") or post.get("title") or "")[:8000],
            "score": int(post.get("score", 0) or 0),
            "upvote_ratio": float(post.get("upvote_ratio", 0.5) or 0.5),
            "num_comments": int(post.get("num_comments", 0) or 0),
            "created_utc": _to_iso_datetime(post.get("created_utc")),
            "subreddit": post.get("subreddit", ""),
            "permalink": post.get("permalink", ""),
            "author": post.get("author", ""),
            "url": post.get("url", post.get("permalink", "")),
            "matched_phrases": post.get("matched_keywords", post.get("matched_phrases", [])) or [],
            "scraped_at": datetime.now(timezone.utc).isoformat(),
        }
        if posts_has_source:
            row["source"] = post.get("source", "")
        if posts_has_score_breakdown:
            row["score_breakdown"] = {
                "evidence_meta": post.get("evidence_meta", {}),
                "source_class": post.get("source_class", ""),
                "source_name": post.get("source_name", ""),
                "voice_type": post.get("voice_type", ""),
                "signal_kind": post.get("signal_kind", ""),
                "evidence_layer": post.get("evidence_layer", ""),
                "directness_tier": post.get("directness_tier", ""),
                "reliability_tier": post.get("reliability_tier", ""),
            }
        payload.append(row)

    saved = 0
    for row in payload:
        resp = sb_upsert("posts", [row], on_conflict="id")
        if resp.status_code < 400:
            saved += 1
    return saved


def update_validation_scores(new_posts):
    """Small market-pulse confidence nudges for recent completed validations."""
    if not SUPABASE_URL or not new_posts:
        return 0

    recent_validations = sb_select(
        "idea_validations",
        "select=id,confidence,created_at,report&status=eq.done&order=created_at.desc&limit=100",
    )
    now = datetime.now(timezone.utc)
    updated = 0

    for validation in recent_validations:
        created_at = validation.get("created_at", "")
        try:
            created_dt = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
        except Exception:
            continue
        if created_dt < now - timedelta(days=30):
            continue

        report = validation.get("report") or {}
        if isinstance(report, str):
            try:
                report = json.loads(report)
            except Exception:
                report = {}

        keywords = report.get("keywords") or report.get("extracted_keywords") or []
        if not keywords:
            continue

        new_matches = 0
        for post in new_posts:
            haystack = f"{post.get('title', '')} {post.get('full_text', '')} {post.get('body', '')}".lower()
            if any(str(keyword).lower() in haystack for keyword in keywords[:5]):
                new_matches += 1

        if new_matches >= 3:
            adjustment = min(3.0, new_matches * 0.5)
        elif new_matches == 0:
            adjustment = -0.5
        else:
            adjustment = 0.0

        if adjustment == 0:
            continue

        current_conf = float(report.get("confidence", validation.get("confidence", 50)) or 50)
        new_conf = max(35.0, min(85.0, current_conf + adjustment))
        report["confidence"] = int(new_conf)
        report["market_pulse"] = {
            "previous_confidence": round(current_conf, 1),
            "current_confidence": int(new_conf),
            "delta": round(new_conf - current_conf, 1),
            "new_matches": new_matches,
            "last_updated_at": now.isoformat(),
        }
        resp = sb_patch("idea_validations", f"id=eq.{validation['id']}", {
            "confidence": int(new_conf),
            "report": report,
        })
        if resp.status_code < 400:
            updated += 1
            direction = "+" if new_conf >= current_conf else ""
            print(f"  [Pulse] {validation['id']}: {current_conf}% -> {new_conf}% ({direction}{new_conf - current_conf:.1f}, {new_matches} new matches)")

    return updated


# ═══════════════════════════════════════════════════════
# SCRAPING (REUSES EXISTING ENGINE SCRAPERS)
# ═══════════════════════════════════════════════════════

def scrape_reddit_sub(subreddit, sort="new", limit=100):
    """Scrape one subreddit via public .json API with proxy + stealth."""
    from proxy_rotator import get_rotator, stealth_json_headers
    _rotator = get_rotator()
    url = f"https://www.reddit.com/r/{subreddit}/{sort}.json"
    headers = stealth_json_headers()
    proxy_kwargs = {}
    proxies = _rotator.format_for_requests()
    if proxies:
        proxy_kwargs["proxies"] = proxies
    try:
        resp = requests.get(
            url, headers=headers,
            params={"limit": limit, "raw_json": 1},
            timeout=20, allow_redirects=False,
            **proxy_kwargs,
        )
        if resp.status_code == 403:
            _rotator.health.record_block()
            print(f"    [SYNC] r/{subreddit}/{sort} 403 BLOCKED")
            return []
        if resp.status_code != 200:
            _rotator.health.record_error()
            print(f"    [SYNC] r/{subreddit}/{sort} returned {resp.status_code}")
            return []
        _rotator.health.record_success()
        data = resp.json()
    except Exception as e:
        _rotator.health.record_error()
        print(f"    [SYNC] r/{subreddit}/{sort} error: {e}")
        return []

    posts = []
    for child in data.get("data", {}).get("children", []):
        if child.get("kind") != "t3":
            continue
        d = child["data"]
        if d.get("removed_by_category") or d.get("selftext") in ("[removed]", "[deleted]"):
            continue

        full_text = f"{d.get('title', '')} {d.get('selftext', '')[:3000]}".strip()
        if len(full_text) < 20:
            continue
        if any(p.search(full_text) for p in _spam_re):
            continue
        if sum(1 for p in _humor_re if p.search(full_text)) >= 2:
            continue

        posts.append({
            "source": "reddit",
            "external_id": d.get("id", ""),
            "subreddit": d.get("subreddit", ""),
            "title": d.get("title", ""),
            "body": d.get("selftext", "")[:3000],
            "full_text": full_text,
            "author": d.get("author", ""),
            "score": d.get("score", 0),
            "num_comments": d.get("num_comments", 0),
            "created_utc": d.get("created_utc", 0),
            "permalink": f"https://reddit.com{d.get('permalink', '')}",
        })
    return posts


def scrape_all_reddit(subreddits=None):
    """Scrape all target subreddits."""
    all_posts = []
    seen = set()
    status_counts = Counter()
    subreddit_counts = Counter()
    for sub in (subreddits or BASE_SUBREDDITS):
        for sort in ("new", "hot"):
            posts = scrape_reddit_sub(sub, sort, limit=100)
            status_counts["requests"] += 1
            if not posts:
                status_counts["empty"] += 1
            else:
                status_counts["successful_requests"] += 1
            for p in posts:
                key = p["external_id"]
                if key not in seen:
                    seen.add(key)
                    all_posts.append(p)
                    if p.get("subreddit"):
                        subreddit_counts[p["subreddit"]] += 1
            time.sleep(2.5)  # respect rate limits
        print(f"    r/{sub}: {len([p for p in all_posts if p.get('subreddit') == sub])} posts")
    scrape_all_reddit.last_run_stats = {
        "mode": "anonymous_public",
        "requested_subreddits": len(subreddits or BASE_SUBREDDITS),
        "requested_requests": status_counts.get("requests", 0),
        "successful_requests": status_counts.get("successful_requests", 0),
        "failed_requests": status_counts.get("empty", 0),
        "subreddit_post_counts": dict(subreddit_counts),
        "subreddits_with_posts": len(subreddit_counts),
    }
    return all_posts


def scrape_hn():
    """Scrape recent Hacker News posts for live trend detection."""
    try:
        from hn_scraper import search_hn_recent

        raw = []
        seen_ids = set()
        keywords = ["startup", "saas", "tool", "problem", "frustrated", "alternative", "invoice", "automation"]

        for keyword in keywords:
            keyword_posts = search_hn_recent(keyword, hits_per_page=100)
            added = 0
            for post in keyword_posts:
                post_id = str(post.get("id", post.get("objectID", "")))
                if not post_id or post_id in seen_ids:
                    continue
                seen_ids.add(post_id)
                raw.append(post)
                added += 1
            print(f"    [HN live] '{keyword}': +{added} recent posts (total {len(raw)})")

        # Normalize to our format
        posts = []
        for p in raw:
            posts.append({
                "source": "hackernews",
                "external_id": str(p.get("id", p.get("objectID", ""))),
                "subreddit": "",
                "title": p.get("title", ""),
                "body": p.get("selftext", p.get("story_text", ""))[:3000],
                "full_text": p.get("full_text", p.get("title", "")),
                "author": p.get("author", ""),
                "score": p.get("score", p.get("points", 0)),
                "num_comments": p.get("num_comments", 0),
                "created_utc": p.get("created_utc", 0),
                "permalink": p.get("permalink", p.get("url", "")),
            })
        return posts
    except Exception as e:
        print(f"    [!] HN scrape failed: {e}")
        return []


def scrape_ph():
    """Scrape ProductHunt."""
    try:
        from ph_scraper import run_ph_scrape
        raw = run_ph_scrape(["saas", "tool", "automation", "freelance", "invoice"])
        posts = []
        for p in raw:
            posts.append({
                "source": "producthunt",
                "external_id": str(p.get("id", "")),
                "subreddit": "",
                "title": p.get("title", ""),
                "body": p.get("selftext", "")[:3000],
                "full_text": p.get("full_text", p.get("title", "")),
                "author": p.get("author", ""),
                "score": p.get("score", 0),
                "num_comments": p.get("num_comments", 0),
                "created_utc": p.get("created_utc", 0),
                "permalink": p.get("permalink", ""),
            })
        return posts
    except Exception as e:
        print(f"    [!] PH scrape failed: {e}")
        return []


def scrape_ih():
    """Scrape IndieHackers."""
    try:
        from ih_scraper import run_ih_scrape
        raw = run_ih_scrape(["problem", "struggling", "tool", "expensive", "alternative", "frustrated"])
        posts = []
        for p in raw:
            posts.append({
                "source": "indiehackers",
                "external_id": str(p.get("id", "")),
                "subreddit": "",
                "title": p.get("title", ""),
                "body": p.get("selftext", "")[:3000],
                "full_text": p.get("full_text", p.get("title", "")),
                "author": p.get("author", ""),
                "score": p.get("score", 0),
                "num_comments": p.get("num_comments", 0),
                "created_utc": p.get("created_utc", 0),
                "permalink": p.get("permalink", ""),
            })
        return posts
    except Exception as e:
        print(f"    [!] IH scrape failed: {e}")
        return []


# ═══════════════════════════════════════════════════════
# TOPIC CLUSTERING — Group posts into ideas
# ═══════════════════════════════════════════════════════

# Pre-defined opportunity topics to track (45 topics, 10+ keywords each)
TRACKED_TOPICS = {
    # ══════ FINTECH ══════
    "invoice-automation": {
        "keywords": ["invoice", "invoicing", "billing", "payment automation", "accounts receivable",
                     "billing software", "send invoice", "overdue payment", "bill client", "payment reminder",
                     "stripe billing", "recurring invoice"],
        "category": "fintech",
    },
    "accounting-software": {
        "keywords": ["accounting", "bookkeeping", "quickbooks", "xero", "tax software", "expense tracking",
                     "profit and loss", "balance sheet", "tax filing", "tax return", "financial report",
                     "expense report", "receipt", "accountant", "cpa", "p&l"],
        "category": "fintech",
    },
    "payment-processing": {
        "keywords": ["payment processing", "stripe", "payment gateway", "subscription billing",
                     "recurring payments", "paypal", "square", "merchant account", "checkout",
                     "payment integration", "credit card processing", "payment link"],
        "category": "fintech",
    },
    "personal-finance": {
        "keywords": ["personal finance", "budget app", "budgeting", "savings", "debt tracker",
                     "net worth", "financial planning", "money management", "expense tracker",
                     "financial goal", "spending tracker", "mint alternative"],
        "category": "fintech",
    },

    # ══════ PRODUCTIVITY ══════
    "time-tracking": {
        "keywords": ["time tracking", "time tracker", "toggl", "clockify", "harvest", "track hours",
                     "billable hours", "timesheet", "pomodoro", "time management", "track time",
                     "work hours", "productivity timer"],
        "category": "productivity",
    },
    "project-management": {
        "keywords": ["project management", "task management", "asana", "notion", "clickup", "trello",
                     "jira", "monday.com", "to-do", "todo", "kanban", "project board", "task list",
                     "workflow", "sprint", "scrum", "agile", "backlog"],
        "category": "productivity",
    },
    "note-taking": {
        "keywords": ["note taking", "notes app", "obsidian", "notion", "evernote", "roam research",
                     "logseq", "note-taking", "second brain", "knowledge base", "zettelkasten",
                     "personal wiki", "markdown editor"],
        "category": "productivity",
    },
    "document-signing": {
        "keywords": ["document signing", "esignature", "docusign", "contract signing", "digital signature",
                     "e-sign", "sign document", "contract management", "pdf sign", "electronic signature",
                     "agreement", "nda"],
        "category": "productivity",
    },
    "forms-surveys": {
        "keywords": ["form builder", "survey", "typeform", "google forms", "questionnaire", "feedback form",
                     "contact form", "registration form", "survey tool", "poll", "quiz maker",
                     "tally", "jotform"],
        "category": "productivity",
    },
    "scheduling-booking": {
        "keywords": ["scheduling", "booking", "appointment", "calendly", "cal.com", "calendar booking",
                     "meeting scheduler", "book a call", "time slot", "availability", "schedule meeting",
                     "reservation", "booking system", "appointment booking"],
        "category": "productivity",
    },
    "ai-meeting-notes": {
        "keywords": ["meeting notes", "ai notes", "meeting transcription", "otter", "fireflies",
                     "meeting summary", "ai assistant", "meeting recording", "transcript",
                     "call recording", "ai notetaker", "automatic notes"],
        "category": "ai",
    },

    # ══════ MARKETING ══════
    "email-marketing": {
        "keywords": ["email marketing", "newsletter", "mailchimp", "convertkit", "email automation",
                     "drip campaign", "email sequence", "email list", "cold email", "email outreach",
                     "open rate", "click rate", "substack", "beehiiv", "email blast"],
        "category": "marketing",
    },
    "seo-tools": {
        "keywords": ["seo", "search engine optimization", "keyword research", "backlinks", "ahrefs",
                     "semrush", "google ranking", "organic traffic", "search ranking", "domain authority",
                     "serp", "link building", "on-page seo", "technical seo", "keyword tool"],
        "category": "marketing",
    },
    "social-media-scheduling": {
        "keywords": ["social media scheduler", "social media management", "hootsuite", "buffer",
                     "content calendar", "social media posting", "schedule posts", "social media tool",
                     "instagram scheduler", "twitter scheduler", "linkedin posting",
                     "social media analytics", "later", "sprout social"],
        "category": "marketing",
    },
    "landing-pages": {
        "keywords": ["landing page", "landing page builder", "conversion", "carrd", "leadpages",
                     "squeeze page", "sales page", "opt-in page", "landing page template",
                     "conversion rate", "a/b testing", "split test", "unbounce", "instapage"],
        "category": "marketing",
    },
    "content-creation": {
        "keywords": ["content creation", "blog post", "copywriting", "content writer", "ghostwriter",
                     "article writing", "content strategy", "content marketing", "blog tool",
                     "writing tool", "content calendar", "editorial", "brand voice"],
        "category": "marketing",
    },
    "influencer-marketing": {
        "keywords": ["influencer", "influencer marketing", "brand deal", "sponsorship", "ugc",
                     "user generated content", "creator economy", "brand ambassador", "collab",
                     "micro-influencer", "creator", "tiktok marketing", "instagram marketing"],
        "category": "marketing",
    },

    # ══════ DEV TOOLS ══════
    "no-code-tools": {
        "keywords": ["no-code", "nocode", "low-code", "bubble", "webflow", "without coding",
                     "no code", "zapier", "make.com", "airtable", "retool", "appsmith",
                     "visual builder", "drag and drop", "citizen developer"],
        "category": "dev-tools",
    },
    "api-monitoring": {
        "keywords": ["api monitoring", "uptime", "status page", "downtime", "alerting",
                     "uptime monitoring", "website monitoring", "server monitoring", "incident",
                     "pagerduty", "better uptime", "health check", "ping", "latency"],
        "category": "dev-tools",
    },
    "website-builder": {
        "keywords": ["website builder", "squarespace", "wix", "web design", "portfolio site",
                     "wordpress", "build website", "no code website", "website template",
                     "static site", "web hosting", "domain", "site builder"],
        "category": "dev-tools",
    },
    "ci-cd-devops": {
        "keywords": ["ci/cd", "devops", "deployment", "docker", "kubernetes", "github actions",
                     "pipeline", "continuous integration", "continuous deployment", "terraform",
                     "infrastructure", "cloud", "aws", "vercel", "netlify", "railway"],
        "category": "dev-tools",
    },
    "developer-tools": {
        "keywords": ["developer tool", "dev tool", "vscode", "ide", "code editor", "debugger",
                     "linter", "formatter", "git", "github", "open source", "sdk", "cli tool",
                     "terminal", "shell", "api client", "postman"],
        "category": "dev-tools",
    },

    # ══════ AI ══════
    "ai-writing": {
        "keywords": ["ai writing", "ai content", "chatgpt", "gpt writing", "ai copywriting",
                     "ai text", "ai blog", "ai email", "jasper ai", "ai assistant",
                     "llm", "openai", "claude", "gemini", "ai tool", "gpt-4", "gpt4"],
        "category": "ai",
    },
    "ai-image-generation": {
        "keywords": ["ai image", "midjourney", "dall-e", "stable diffusion", "ai art",
                     "image generation", "ai design", "text to image", "ai photo",
                     "generative ai", "ai graphics", "ai avatar"],
        "category": "ai",
    },
    "ai-automation": {
        "keywords": ["ai automation", "automate with ai", "ai workflow", "ai agent",
                     "autonomous agent", "ai bot", "ai scraper", "ai data entry",
                     "intelligent automation", "rpa", "process automation"],
        "category": "ai",
    },
    "ai-coding": {
        "keywords": ["ai coding", "copilot", "ai code", "code completion", "cursor ai",
                     "ai programming", "ai developer", "code generation", "ai ide",
                     "ai pair programming", "devin", "ai software engineer"],
        "category": "ai",
    },

    # ══════ SAAS ══════
    "customer-support": {
        "keywords": ["customer support", "help desk", "ticketing", "zendesk", "intercom", "live chat",
                     "support ticket", "customer service", "helpdesk", "freshdesk", "chatbot",
                     "knowledge base", "faq", "support tool", "customer success"],
        "category": "saas",
    },
    "crm-tools": {
        "keywords": ["crm", "client management", "client tracking", "pipeline", "hubspot",
                     "salesforce", "deal tracking", "lead management", "customer relationship",
                     "contact management", "sales pipeline", "sales tool", "prospecting"],
        "category": "saas",
    },
    "onboarding-tools": {
        "keywords": ["onboarding", "user onboarding", "product tour", "walkthrough", "activation",
                     "welcome flow", "getting started", "setup wizard", "first time user",
                     "product adoption", "feature adoption", "in-app guide"],
        "category": "saas",
    },
    "feedback-tools": {
        "keywords": ["feedback", "user feedback", "feature request", "roadmap", "changelog",
                     "product feedback", "customer feedback", "nps", "canny", "productboard",
                     "upvote", "feature voting", "beta testing"],
        "category": "saas",
    },

    # ══════ ECOMMERCE ══════
    "ecommerce-tools": {
        "keywords": ["ecommerce", "e-commerce", "shopify", "dropshipping", "online store", "woocommerce",
                     "shopify app", "shopify theme", "print on demand", "product listing",
                     "product photos", "supplier", "wholesale", "dtc", "direct to consumer",
                     "amazon seller", "amazon fba", "fulfillment"],
        "category": "ecommerce",
    },
    "inventory-management": {
        "keywords": ["inventory", "stock management", "warehouse", "supply chain", "fulfillment",
                     "inventory tracking", "order management", "sku", "barcode", "shipment",
                     "logistics", "3pl", "shipping software", "order fulfillment"],
        "category": "ecommerce",
    },

    # ══════ HR ══════
    "recruitment-hiring": {
        "keywords": ["hiring", "recruitment", "applicant tracking", "job posting", "talent acquisition",
                     "ats", "interview", "candidate", "job board", "resume", "cv",
                     "recruiter", "hr software", "onboarding employee", "payroll"],
        "category": "hr",
    },
    "remote-work-tools": {
        "keywords": ["remote work", "remote team", "distributed team", "work from home", "wfh",
                     "async work", "remote collaboration", "virtual office", "team communication",
                     "slack alternative", "remote culture", "hybrid work", "coworking"],
        "category": "hr",
    },

    # ══════ SECURITY ══════
    "vpn-privacy": {
        "keywords": ["vpn", "privacy", "online privacy", "encrypted", "anonymous browsing",
                     "password manager", "2fa", "two factor", "security tool", "cyber security",
                     "data breach", "malware", "antivirus", "firewall", "identity theft"],
        "category": "security",
    },

    # ══════ DATA ══════
    "data-analytics": {
        "keywords": ["analytics", "data visualization", "metabase", "mixpanel", "google analytics",
                     "amplitude", "data dashboard", "business intelligence", "bi tool", "reporting",
                     "data pipeline", "etl", "data warehouse", "sql", "tableau", "chart"],
        "category": "data",
    },
    "web-scraping": {
        "keywords": ["web scraping", "scraper", "scrape data", "web crawler", "data extraction",
                     "automation", "puppeteer", "playwright", "selenium", "beautifulsoup",
                     "parse website", "extract data", "apify"],
        "category": "data",
    },

    # ══════ EDUCATION ══════
    "online-courses": {
        "keywords": ["online course", "course creator", "teachable", "udemy", "skillshare",
                     "learn online", "e-learning", "lms", "create course", "sell course",
                     "course platform", "membership site", "cohort based"],
        "category": "saas",
    },

    # ══════ FREELANCE ══════
    "freelance-tools": {
        "keywords": ["freelance", "freelancer", "client", "proposal", "scope creep",
                     "hourly rate", "retainer", "upwork", "fiverr", "agency", "consulting",
                     "contract", "freelance income", "side gig", "independent contractor"],
        "category": "saas",
    },

    # ══════ REAL ESTATE ══════
    "proptech": {
        "keywords": ["real estate", "rental", "tenant", "property", "mortgage", "landlord",
                     "airbnb", "property management", "lease", "real estate investing",
                     "rental income", "property manager", "vacation rental"],
        "category": "fintech",
    },

    # ══════ DESIGN ══════
    "design-tools": {
        "keywords": ["design tool", "figma", "canva", "graphic design", "ui design", "ux design",
                     "logo maker", "brand kit", "design system", "prototype", "mockup",
                     "wireframe", "illustration", "photo editor"],
        "category": "dev-tools",
    },

    # ══════ COMMUNICATION ══════
    "video-conferencing": {
        "keywords": ["video call", "zoom", "video conferencing", "google meet", "teams",
                     "screen share", "webinar", "virtual meeting", "video chat",
                     "conference call", "video recording", "loom", "screen recording"],
        "category": "saas",
    },
}

# ── Subreddit-to-category mapping for dynamic topic discovery ──
RAW_SUBREDDIT_CATEGORIES = {
    "smallbusiness": "saas", "Entrepreneur": "saas", "startups": "saas",
    "SaaS": "saas", "sidehustle": "saas", "indiehackers": "saas",
    "microsaas": "saas", "EntrepreneurRideAlong": "saas", "sweatystartup": "saas",
    "ecommerce": "ecommerce", "shopify": "ecommerce", "dropship": "ecommerce",
    "FulfillmentByAmazon": "ecommerce", "AmazonSeller": "ecommerce",
    "freelance": "saas", "freelanceWriters": "saas", "graphic_design": "dev-tools",
    "web_design": "dev-tools", "Upwork": "saas",
    "marketing": "marketing", "SEO": "marketing", "PPC": "marketing",
    "socialmedia": "marketing", "emailmarketing": "marketing",
    "ContentCreators": "marketing", "juststart": "marketing",
    "webdev": "dev-tools", "devops": "dev-tools", "selfhosted": "dev-tools",
    "nocode": "dev-tools", "ProductManagement": "saas",
    "cscareerquestions": "dev-tools", "learnprogramming": "dev-tools",
    "Accounting": "fintech", "realestateinvesting": "fintech",
    "tax": "fintech", "legaladvice": "saas",
    "digitalnomad": "hr", "remotework": "hr", "WorkOnline": "hr",
    "artificial": "ai", "MachineLearning": "ai", "analytics": "data",
}
SUBREDDIT_CATEGORIES = {key.lower(): value for key, value in RAW_SUBREDDIT_CATEGORIES.items()}

DYNAMIC_TOPIC_ALLOWED_SHORT_TOKENS = {"ai", "api", "b2b", "b2c", "hr", "ui", "ux"}
DYNAMIC_TOPIC_STOPWORDS = {
    "a", "across", "an", "and", "anyone", "are", "as", "at", "be", "because", "been", "being", "best",
    "but", "by", "can", "could", "did", "do", "does", "doing", "for", "from", "get",
    "got", "had", "has", "have", "having", "how", "i", "if", "in", "into", "is", "it",
    "its", "just", "like", "make", "makes", "making", "me", "more", "most", "my", "need",
    "now", "of", "on", "or", "our", "out", "really", "so", "some", "still", "than",
    "solve", "solved", "that", "the", "their", "them", "then", "there", "these", "they", "this", "those",
    "to", "too", "use", "using", "want", "was", "we", "were", "what", "when", "where",
    "which", "who", "why", "will", "with", "would", "you", "your",
}
DYNAMIC_TOPIC_NOISE_TOKENS = {
    "app", "apps", "builder", "build", "building", "built", "community", "discussion",
    "founder", "founders", "hn", "idea", "ideas", "indiehackers", "launch", "launched",
    "maker", "makers", "open", "opensource", "ph", "post", "posts", "product",
    "producthunt", "project", "projects", "reddit", "saas", "show", "software", "startup",
    "startups", "thread", "threads", "tool", "tools",
}
DYNAMIC_TOPIC_GENERIC_TOKENS = {
    "all", "another", "anymore", "anything", "business", "day", "days", "don", "dont", "everybody",
    "everyone", "few", "first", "folks", "guys", "hey", "hours", "know", "knowing", "long", "lot",
    "lots", "many", "media", "month", "months", "nothing", "not", "other", "people", "person",
    "question", "questions", "second", "share", "sharing", "small", "someone", "somebody", "something",
    "stuff", "sure", "take", "team", "teams", "thing", "things", "third", "time", "times", "user",
    "users", "week", "weeks", "year", "years",
}
DYNAMIC_TOPIC_WEAK_EDGE_TOKENS = {
    "all", "another", "don", "dont", "everybody", "everyone", "few", "first", "folks", "guys", "hey",
    "long", "lot", "lots", "many", "not", "other", "small", "someone", "somebody", "sure",
}
DYNAMIC_TOPIC_EXACT_BLOCKLIST = {
    "ask hn",
    "don know",
    "hey all",
    "hey everyone",
    "hey guys",
    "not sure",
    "show hn",
    "show ih",
    "show ph",
    "open source",
    "first users",
    "from scratch",
}
INVALID_MARKET_TOPIC_EXACT_BLOCKLIST = {
    "don know",
    "few years",
    "first users",
    "hey all",
    "hey everyone",
    "hey guys",
    "https www",
    "long take",
    "lot people",
    "not sure",
    "other people",
    "quarter achieve",
    "years marketing",
}
INVALID_MARKET_TOPIC_PREFIXES = (
    "anyone else ",
    "does anyone ",
    "don know",
    "help ",
    "hey ",
    "how do i ",
    "looking for ",
    "manual ",
    "not sure",
)
INVALID_MARKET_TOPIC_GENERIC_TOKENS = {
    "alternative",
    "alternatives",
    "anyone",
    "does",
    "don",
    "else",
    "everyone",
    "few",
    "first",
    "for",
    "guys",
    "help",
    "how",
    "i",
    "issue",
    "issues",
    "know",
    "long",
    "lot",
    "looking",
    "manual",
    "month",
    "months",
    "not",
    "other",
    "people",
    "problem",
    "problems",
    "quarter",
    "recommendation",
    "recommendations",
    "sure",
    "year",
    "years",
}


def _normalize_dynamic_phrase(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()


def _is_invalid_market_topic_name(value):
    normalized = _normalize_dynamic_phrase(value)
    if not normalized:
        return True
    if normalized in INVALID_MARKET_TOPIC_EXACT_BLOCKLIST:
        return True
    if any(normalized.startswith(prefix) for prefix in INVALID_MARKET_TOPIC_PREFIXES):
        return True
    if "http" in normalized or "www" in normalized:
        return True
    meaningful_tokens = [
        token for token in normalized.split()
        if token not in INVALID_MARKET_TOPIC_GENERIC_TOKENS and len(token) > 2
    ]
    return len(meaningful_tokens) < 2


DYNAMIC_TOPIC_TRACKED_PHRASES = set()
for _topic in TRACKED_TOPICS.values():
    for _keyword in _topic.get("keywords", []):
        normalized_keyword = _normalize_dynamic_phrase(_keyword)
        if normalized_keyword:
            DYNAMIC_TOPIC_TRACKED_PHRASES.add(normalized_keyword)


def _market_post_key(post):
    return str(
        post.get("external_id")
        or post.get("permalink")
        or post.get("url")
        or f"{post.get('source', 'unknown')}::{post.get('title', '')}"
    ).strip()


def _slugify_market_topic(text):
    slug = re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")
    return slug[:64] or hashlib.md5(str(text or "").encode("utf-8", errors="ignore")).hexdigest()[:12]


def _humanize_dynamic_topic_name(phrase):
    title = " ".join(word.capitalize() for word in phrase.split())
    replacements = {
        "Ai": "AI",
        "Api": "API",
        "B2b": "B2B",
        "B2c": "B2C",
        "Ui": "UI",
        "Ux": "UX",
    }
    for source, target in replacements.items():
        title = title.replace(source, target)
    return title


def _extract_dynamic_topic_tokens(text):
    tokens = []
    for raw_token in re.findall(r"[a-z0-9][a-z0-9/+_-]{1,24}", str(text or "").lower()):
        token = raw_token.strip("-_/+")
        if not token:
            continue
        if len(token) <= 2 and token not in DYNAMIC_TOPIC_ALLOWED_SHORT_TOKENS:
            continue
        if token.isdigit():
            continue
        if token in DYNAMIC_TOPIC_STOPWORDS or token in DYNAMIC_TOPIC_NOISE_TOKENS:
            continue
        if token in MARKET_PAIN_KEYWORDS:
            continue
        tokens.append(token)
    return tokens


def _is_valid_dynamic_phrase(tokens):
    if len(tokens) < 2:
        return False
    phrase = " ".join(tokens)
    normalized_phrase = _normalize_dynamic_phrase(phrase)
    if not normalized_phrase or normalized_phrase in DYNAMIC_TOPIC_EXACT_BLOCKLIST:
        return False
    if normalized_phrase in DYNAMIC_TOPIC_TRACKED_PHRASES:
        return False
    if any(token in {"show", "ask", "launch", "build", "built", "building"} for token in tokens):
        return False
    if sum(1 for token in tokens if token in DYNAMIC_TOPIC_NOISE_TOKENS) >= 2:
        return False
    if len({token for token in tokens}) < len(tokens):
        return False
    if tokens[0] in DYNAMIC_TOPIC_WEAK_EDGE_TOKENS or tokens[-1] in DYNAMIC_TOPIC_WEAK_EDGE_TOKENS:
        return False
    meaningful_tokens = [
        token for token in tokens
        if token not in DYNAMIC_TOPIC_GENERIC_TOKENS
    ]
    if len(meaningful_tokens) < 2:
        return False
    if all(token in DYNAMIC_TOPIC_STOPWORDS or token in DYNAMIC_TOPIC_NOISE_TOKENS for token in tokens):
        return False
    return True


def _extract_dynamic_topic_candidates(post):
    if _is_launch_meta_market_post(post) and _market_post_support_rank(post) < 2 and not is_pain_post(post):
        return []

    candidate_phrases = []
    text_candidates = [
        post.get("title", ""),
        (post.get("body") or post.get("selftext") or post.get("full_text") or "")[:240],
    ]

    for text in text_candidates:
        tokens = _extract_dynamic_topic_tokens(text)
        for size in (2, 3):
            for index in range(max(len(tokens) - size + 1, 0)):
                phrase_tokens = tokens[index:index + size]
                if _is_valid_dynamic_phrase(phrase_tokens):
                    candidate_phrases.append(" ".join(phrase_tokens))

    deduped = []
    seen = set()
    for phrase in candidate_phrases:
        if phrase in seen:
            continue
        seen.add(phrase)
        deduped.append(phrase)
        if len(deduped) >= 6:
            break
    return deduped


def _infer_dynamic_topic_category(phrase, posts):
    category_counts = Counter()
    normalized_phrase = _normalize_dynamic_phrase(phrase)
    phrase_tokens = set(normalized_phrase.split())

    for post in posts:
        subreddit = (post.get("subreddit", "") or "").strip().lower()
        mapped = SUBREDDIT_CATEGORIES.get(subreddit)
        if mapped:
            category_counts[mapped] += 2

    for topic_info in TRACKED_TOPICS.values():
        category = topic_info.get("category", "general")
        for keyword in topic_info.get("keywords", []):
            normalized_keyword = _normalize_dynamic_phrase(keyword)
            if not normalized_keyword:
                continue
            keyword_tokens = set(normalized_keyword.split())
            if normalized_keyword == normalized_phrase:
                category_counts[category] += 4
            elif phrase_tokens & keyword_tokens:
                category_counts[category] += 1

    return category_counts.most_common(1)[0][0] if category_counts else "general"


def _discover_dynamic_market_topics(unmatched_posts, unmatched_signal_posts):
    posts_by_key = {}
    for post in unmatched_posts:
        post_key = _market_post_key(post)
        if post_key and post_key not in posts_by_key:
            posts_by_key[post_key] = post

    if len(posts_by_key) < 2:
        return {}, {}, {}, set()

    signal_keys = {
        _market_post_key(post)
        for post in unmatched_signal_posts
        if _market_post_key(post)
    }

    candidates_by_post_key = {}
    phrase_to_post_keys = defaultdict(set)

    for post_key, post in posts_by_key.items():
        phrases = _extract_dynamic_topic_candidates(post)
        if not phrases:
            continue
        candidates_by_post_key[post_key] = phrases
        for phrase in phrases:
            phrase_to_post_keys[phrase].add(post_key)

    qualifying_phrase_scores = {}
    phrase_source_counts = {}
    for phrase, post_keys in phrase_to_post_keys.items():
        phrase_posts = [posts_by_key[key] for key in post_keys]
        signal_count = sum(1 for key in post_keys if key in signal_keys)
        source_count = len({_normalized_market_source(post) for post in phrase_posts if _normalized_market_source(post)})
        support_count = sum(1 for post in phrase_posts if _market_post_support_rank(post) >= 2)
        pain_count = sum(1 for post in phrase_posts if is_pain_post(post))
        launch_count = sum(1 for post in phrase_posts if _is_launch_meta_market_post(post))
        total_engagement = sum(min(_engagement_score(post), 80) for post in phrase_posts)

        if len(post_keys) < 2:
            continue
        if signal_count == 0:
            continue
        if len(post_keys) == 2 and support_count < 2:
            continue
        if signal_count < 2 and support_count == 0 and source_count < 2:
            continue
        if support_count == 0 and pain_count == 0:
            continue
        if launch_count == len(post_keys) and support_count == 0:
            continue

        qualifying_phrase_scores[phrase] = (
            source_count * 100
            + support_count * 25
            + pain_count * 15
            + signal_count * 12
            + len(post_keys) * 10
            + total_engagement / 10.0
        )
        phrase_source_counts[phrase] = source_count

    assigned_posts = defaultdict(list)
    for post_key, phrases in candidates_by_post_key.items():
        viable_phrases = [phrase for phrase in phrases if phrase in qualifying_phrase_scores]
        if not viable_phrases:
            continue
        best_phrase = max(
            viable_phrases,
            key=lambda phrase: (
                qualifying_phrase_scores[phrase],
                len(phrase_to_post_keys[phrase]),
                phrase_source_counts.get(phrase, 0),
                len(phrase),
            ),
        )
        assigned_posts[best_phrase].append(posts_by_key[post_key])

    dynamic_idea_posts = {}
    dynamic_signal_posts = {}
    dynamic_topic_meta = {}
    assigned_post_keys = set()

    for phrase, phrase_posts in sorted(
        assigned_posts.items(),
        key=lambda item: qualifying_phrase_scores.get(item[0], 0),
        reverse=True,
    ):
        deduped_posts = []
        seen_keys = set()
        for post in phrase_posts:
            post_key = _market_post_key(post)
            if not post_key or post_key in seen_keys:
                continue
            seen_keys.add(post_key)
            deduped_posts.append(post)

        if len(deduped_posts) < 2:
            continue

        signal_bucket = [post for post in deduped_posts if _market_post_key(post) in signal_keys]
        source_count = len({_normalized_market_source(post) for post in signal_bucket or deduped_posts if _normalized_market_source(post)})
        support_count = sum(1 for post in deduped_posts if _market_post_support_rank(post) >= 2)

        if not signal_bucket:
            continue
        if len(deduped_posts) == 2 and support_count < 2:
            continue
        if len(signal_bucket) < 2 and (support_count < 2 or source_count < 2):
            continue

        topic_name = _humanize_dynamic_topic_name(phrase)
        if _is_invalid_market_topic_name(topic_name):
            continue

        slug_base = f"dyn-{_slugify_market_topic(phrase)}"
        slug = slug_base
        suffix = 2
        while slug in dynamic_topic_meta:
            slug = f"{slug_base[:58]}-{suffix}"
            suffix += 1

        dynamic_idea_posts[slug] = deduped_posts
        dynamic_signal_posts[slug] = signal_bucket
        dynamic_topic_meta[slug] = {
            "topic": topic_name,
            "category": _infer_dynamic_topic_category(phrase, deduped_posts),
            "keywords": [phrase],
        }
        assigned_post_keys.update(_market_post_key(post) for post in deduped_posts if _market_post_key(post))

    return dynamic_idea_posts, dynamic_signal_posts, dynamic_topic_meta, assigned_post_keys


def classify_post_to_topics(post):
    return _classify_post_to_topics_with_meta(post)["topics"]


def _classify_post_to_topics_with_meta(post):
    """Match a post to one or more tracked topics. Returns list of topic slugs."""
    text = _compose_post_text(post).lower()
    subreddit = (post.get("subreddit", "") or "").lower().strip()
    subreddit_text = subreddit.replace("_", " ").replace("-", " ")
    combined_text = f"{subreddit_text} {text}".strip()
    source = _normalized_market_source(post)
    builder_meta_post = _market_post_support_rank(post) == 1 and source in {"hackernews", "indiehackers", "producthunt"}
    subreddit_category = SUBREDDIT_CATEGORIES.get(subreddit, "")
    matches = []
    builder_meta_filtered = False

    for slug, topic_info in TRACKED_TOPICS.items():
        score = 0
        phrase_hit = False
        keyword_hits = 0
        for keyword in topic_info["keywords"]:
            normalized = keyword.lower().strip()
            if not normalized:
                continue
            if " " in normalized or "-" in normalized or "/" in normalized:
                if normalized in combined_text:
                    score += 2
                    phrase_hit = True
                    keyword_hits += 1
            elif re.search(rf"\b{re.escape(normalized)}\b", combined_text):
                score += 1
                keyword_hits += 1

        if (
            source == "reddit"
            and subreddit_category
            and subreddit_category == topic_info.get("category")
            and (keyword_hits > 0 or is_pain_post(post))
        ):
            # Reddit complaints often use category-native buyer language in body text.
            score += 1

        if builder_meta_post and not phrase_hit and keyword_hits < 2:
            if keyword_hits > 0:
                builder_meta_filtered = True
            continue

        if phrase_hit or score >= 2:
            matches.append((slug, score))

    # Sort by match score, return top 2 strongest themes.
    matches.sort(key=lambda x: x[1], reverse=True)
    return {
        "topics": [match[0] for match in matches[:2]],
        "builder_meta_filtered": bool(builder_meta_filtered and not matches),
        "builder_meta_post": builder_meta_post,
    }


# ═══════════════════════════════════════════════════════
# SCORE CALCULATOR — The price formula
# ═══════════════════════════════════════════════════════

def calculate_idea_score(topic_slug, posts, signal_posts=None, existing_idea=None):
    """
    Calculate the live score (0-100) for an idea topic.
    The score rewards momentum, pain density, source breadth, and evidence quality.
    """
    signal_posts = signal_posts or posts

    if not posts or not signal_posts:
        return 0.0, {}

    now = time.time()
    twenty_four_hours_ago = now - 86400
    seven_days_ago = now - 7 * 86400
    thirty_days_ago = now - 30 * 86400

    # Parse timestamps
    post_count_24h = sum(1 for post in signal_posts if _post_activity_timestamp(post) > twenty_four_hours_ago)

    # ── Velocity (how many posts in last 7 days vs previous) ──
    recent_count = sum(1 for post in signal_posts if _post_activity_timestamp(post) > seven_days_ago)
    older_count = sum(
        1 for post in signal_posts
        if seven_days_ago >= _post_activity_timestamp(post) > thirty_days_ago
    )

    if older_count > 0:
        velocity_ratio = recent_count / older_count
    else:
        velocity_ratio = min(recent_count, 5)

    velocity_score = min(velocity_ratio * 15, 100)

    # ── Cross-platform (how many different sources) ──
    source_breakdown = _build_source_breakdown(signal_posts)
    source_names = [item["platform"] for item in source_breakdown]
    source_count = len(source_breakdown)
    cross_platform_multipliers = {1: 1.0, 2: 1.5, 3: 2.2, 4: 3.0}
    cp_mult = cross_platform_multipliers.get(source_count, 3.0)
    cross_platform_score = min(source_count * 25 * cp_mult / 3.0, 100)

    # ── Engagement (avg upvotes + comments) ──
    total_engagement = sum(p.get("score", 0) + p.get("num_comments", 0) for p in signal_posts)
    avg_engagement = total_engagement / max(len(signal_posts), 1)
    engagement_score = min(math.log(avg_engagement + 1) / 7.0 * 100, 100)

    # ── Pain signal (how many match pain phrases) ──
    pain_count = 0
    for p in signal_posts:
        text_lower = (p.get("full_text", "") or "").lower()
        if any(phrase.lower() in text_lower for phrase in PAIN_PHRASES[:20]):
            pain_count += 1
    pain_ratio = pain_count / max(len(signal_posts), 1)
    pain_boost = min(pain_ratio * 40, 100)

    # ── Volume bonus (more data = more confident) ──
    volume_bonus = min(math.log(len(signal_posts) + 1) / math.log(500) * 15, 15)

    # ── Final score (pain-weighted: pain signals are the core value) ──
    evidence_quality_score, evidence_quality_meta = _calculate_market_evidence_quality(
        signal_posts,
        source_breakdown=source_breakdown,
    )
    raw_score = (
        velocity_score * 0.20 +
        pain_boost * 0.20 +
        cross_platform_score * 0.15 +
        engagement_score * 0.15 +
        volume_bonus * 0.10 +
        evidence_quality_score * 0.20
    )

    final_score = max(0, min(100, round(raw_score, 1)))

    breakdown = {
        "velocity": round(velocity_score, 1),
        "pain_density": round(pain_boost, 1),
        "cross_platform": round(cross_platform_score, 1),
        "engagement": round(engagement_score, 1),
        "volume": round(volume_bonus / 15 * 100, 1) if volume_bonus else 0.0,
        "evidence_quality": round(evidence_quality_score, 1),
        "velocity_weight": 0.20,
        "pain_density_weight": 0.20,
        "cross_platform_weight": 0.15,
        "engagement_weight": 0.15,
        "volume_weight": 0.10,
        "evidence_quality_weight": 0.20,
        "raw_weighted_score": round(raw_score, 1),
        "source_count": source_count,
        "sources": source_breakdown,
        "source_names": source_names,
        "post_count_24h": post_count_24h,
        "post_count_7d": recent_count,
        "post_count_total": len(signal_posts),
        "pain_count": pain_count,
        "buyer_native_direct_count": evidence_quality_meta["buyer_native_direct_count"],
        "supporting_signal_count": evidence_quality_meta["supporting_signal_count"],
        "launch_meta_count": evidence_quality_meta["launch_meta_count"],
        "buyer_native_count": evidence_quality_meta["buyer_native_count"],
        "single_source": evidence_quality_meta["single_source"],
        "hn_launch_heavy": evidence_quality_meta["hn_launch_heavy"],
        # Backward-compatible aliases for any legacy readers.
        "pain_signal": round(pain_boost, 1),
        "volume_bonus": round(volume_bonus, 1),
    }

    return final_score, breakdown


def determine_trend(current, previous_24h, previous_7d):
    """Determine trend direction from score history."""
    if previous_7d == 0 and previous_24h == 0:
        return "new"

    if previous_7d > 0:
        change_7d = current - previous_7d
        if change_7d > 5:
            return "rising"
        elif change_7d < -5:
            return "falling"

    if previous_24h > 0:
        change_24h = current - previous_24h
        if change_24h > 2:
            return "rising"
        elif change_24h < -2:
            return "falling"

    return "stable"


def determine_confidence(post_count, source_count, pain_count=0, signal_contract=None):
    """Determine confidence level based on evidence + pain signal density."""
    pain_ratio = pain_count / max(post_count, 1)
    support_level = str((signal_contract or {}).get("support_level", "") or "").lower()
    buyer_native_direct_count = int((signal_contract or {}).get("buyer_native_direct_count", 0) or 0)
    supporting_signal_count = int((signal_contract or {}).get("supporting_signal_count", 0) or 0)

    if post_count < 3:
        base_confidence = "INSUFFICIENT"
    elif post_count < 8:
        # Small sample - but cross-source/supporting patterns should still show up on the board.
        base_confidence = (
            "LOW"
            if (
                pain_ratio > 0.2
                or source_count >= 2
                or buyer_native_direct_count >= 1
                or supporting_signal_count >= 2
                or support_level in {"supporting_context", "evidence_backed"}
            )
            else "INSUFFICIENT"
        )
    elif post_count < 20:
        if source_count >= 2 or pain_ratio > 0.3:
            base_confidence = "MEDIUM"
        else:
            base_confidence = "LOW"
    elif post_count < 80:
        if source_count >= 2 and pain_ratio > 0.15:
            base_confidence = "HIGH"
        elif source_count >= 2 or pain_ratio > 0.25:
            base_confidence = "MEDIUM"
        else:
            base_confidence = "LOW"
    else:
        if source_count >= 3 and pain_ratio > 0.1:
            base_confidence = "STRONG"
        elif source_count >= 2:
            base_confidence = "HIGH"
        else:
            base_confidence = "MEDIUM"

    if not signal_contract:
        return base_confidence

    support_level = str(signal_contract.get("support_level", "") or "").lower()
    buyer_native_direct_count = int(signal_contract.get("buyer_native_direct_count", 0) or 0)
    hn_launch_heavy = bool(signal_contract.get("hn_launch_heavy"))
    single_source = bool(signal_contract.get("single_source"))

    if support_level == "hypothesis":
        if hn_launch_heavy and buyer_native_direct_count == 0 and post_count < 15:
            return "INSUFFICIENT"
        if buyer_native_direct_count == 0 and (single_source or post_count < 12):
            return _min_confidence_level(base_confidence, "LOW" if post_count >= 12 else "INSUFFICIENT")
        return _min_confidence_level(base_confidence, "LOW")

    if support_level == "supporting_context" and buyer_native_direct_count == 0:
        if single_source and post_count < 15:
            return _min_confidence_level(base_confidence, "LOW")
        return _min_confidence_level(base_confidence, "MEDIUM")

    return base_confidence


# ═══════════════════════════════════════════════════════
# MAIN JOB
# ═══════════════════════════════════════════════════════

def run_scraper_job(sources=None, topic_filter=None, mode="full", source_label="local"):
    """
    Run the full scraper pipeline:
    1. Scrape all sources
    2. Cluster posts into ideas
    3. Calculate scores
    4. Upsert to Supabase
    """
    start_time = time.time()
    run_id = None
    run_status = "failed"
    run_notes = []
    ideas_updated = 0
    ideas_to_upsert = []
    idea_upsert_failures = []
    all_posts = []
    source_counts = Counter()
    sources = sources or default_market_sources()
    if mode == "quick":
        sources = [source for source in sources if source in {"reddit", "hackernews"}]
    elif mode == "trends":
        sources = [source for source in sources if source in {"reddit", "hackernews", "producthunt"}]

    print("=" * 60)
    print("  Opportunity Engine — Scraper Job")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Sources: {', '.join(sources)}")
    print(f"  Mode: {mode}")
    print(f"  Caller: {source_label}")
    print("=" * 60)

    if SUPABASE_URL:
        reconcile_stale_scraper_runs()
        run_source_value = _format_scraper_run_source_value(sources)
        resp = sb_upsert("scraper_runs", [{
            "source": run_source_value,
            "status": "running",
            "started_at": datetime.now(timezone.utc).isoformat(),
        }])
        if resp.status_code < 400:
            data = resp.json()
            if data:
                run_id = data[0].get("id")
                _ACTIVE_SCRAPER_CONTEXT.update({
                    "run_id": run_id,
                    "start_time": start_time,
                    "posts_collected": 0,
                    "ideas_updated": 0,
                })
    run_notes.append(_format_runner_note(source_label))

    # ── 1. Scrape (4-Layer Architecture) ──
    all_posts = []
    all_post_map = {}
    live_posts = []
    live_ids = set()
    historical_ids = set()

    def _merge(new_posts, bucket="live"):
        """Deduplicate and merge posts into all_posts."""
        added = 0
        for p in new_posts:
            eid = p.get("external_id", "")
            if not eid:
                continue

            if not p.get("scraped_at"):
                p["scraped_at"] = datetime.now(timezone.utc).isoformat()

            if eid not in all_post_map:
                all_post_map[eid] = p
                all_posts.append(p)
                added += 1

            canonical = all_post_map[eid]
            if bucket == "live":
                if eid not in live_ids:
                    live_ids.add(eid)
                    live_posts.append(canonical)
            elif bucket == "historical":
                if eid not in historical_ids and eid not in live_ids:
                    historical_ids.add(eid)
        return added

    all_subs = load_user_requested_subreddits()

    # ── Pre-step: Ensure proxies are available ──
    try:
        from proxy_rotator import get_rotator, reset_rotator
        _pre_rotator = get_rotator()
        if not _pre_rotator.has_proxies():
            print("\n  [0/6] Auto-harvesting free proxies...")
            try:
                from proxy_harvester import ensure_proxies
                found_proxies = ensure_proxies(min_count=8, max_age_hours=3.0)
                if found_proxies:
                    reset_rotator()  # Force re-init with new PROXY_LIST
                    print(f"  [OK] Proxy pool ready: {len(found_proxies)} working proxies")
                else:
                    print("  [!] No free proxies found — scraper will try direct (expect 403s)")
            except ImportError:
                print("  [!] proxy_harvester not available — skipping auto-harvest")
            except Exception as e:
                print(f"  [!] Proxy harvest failed: {e} — continuing without proxies")
        else:
            print(f"  [Proxy] Pool ready: {_pre_rotator.mode} ({_pre_rotator.live_count()} proxies)")
    except ImportError:
        pass
    reddit_async_stats = {}
    pullpush_added = 0
    comment_added = 0
    sitemap_added = 0
    praw_added = 0
    reddit_access_mode = "none"
    reddit_successful_requests = 0
    reddit_failed_requests = 0
    reddit_post_count = 0
    reddit_degraded_reason = ""
    healthy_sources = []
    degraded_sources = []
    optional_source_notes = []

    if "reddit" in sources:
        reddit_primary_stats = {}
        reddit_fallback_stats = {}
        provider_attempt_note = ""
        auth_attempt_note = ""
        provider_ready = False
        auth_ready = False

        try:
            from reddit_scrapecreators import is_available as provider_available, scrape_all_subreddit_posts
        except Exception:
            provider_available = lambda: False
            scrape_all_subreddit_posts = None

        try:
            from reddit_auth import is_available as praw_available, scrape_all_authenticated
        except Exception:
            praw_available = lambda: False
            scrape_all_authenticated = None

        if provider_available() and scrape_all_subreddit_posts:
            reddit_access_mode = "provider_api"
            print("\n  [0.5/6] Layer 0 - Provider Reddit scrape...")
            try:
                reddit_posts = scrape_all_subreddit_posts(all_subs, sorts=["new", "hot"], limit=100)
                reddit_primary_stats = getattr(scrape_all_subreddit_posts, "last_run_stats", {}) or {}
                added = _merge(reddit_posts, bucket="live")
                print(f"  [OK] Layer 0 (provider): {added} fresh posts")

                if _should_retry_reddit_sync(reddit_primary_stats, added, all_subs):
                    provider_attempt_note = (
                        f"Layer 0 provider degraded: {reddit_primary_stats.get('failed_requests', 0)}/"
                        f"{reddit_primary_stats.get('requested_requests', 0)} request failures"
                    )
                    run_notes.append(provider_attempt_note)
                    print(f"  [!] {provider_attempt_note} - retrying with authenticated Reddit")
                else:
                    provider_ready = True
            except Exception as e:
                provider_attempt_note = f"Layer 0 provider failed: {type(e).__name__}: {e}"
                run_notes.append(provider_attempt_note)
                print(f"  [!] {provider_attempt_note} - falling back to authenticated Reddit")

        if not provider_ready and praw_available() and scrape_all_authenticated:
            reddit_access_mode = "authenticated_app"
            print("\n  [1/6] Layer 1 — Authenticated Reddit app scrape...")
            try:
                reddit_posts = scrape_all_authenticated(all_subs, sorts=["new", "hot"], limit=100)
                reddit_primary_stats = getattr(scrape_all_authenticated, "last_run_stats", {}) or {}
                added = _merge(reddit_posts, bucket="live")
                print(f"  [OK] Layer 1 (authenticated): {added} fresh posts")

                if _should_retry_reddit_sync(reddit_primary_stats, added, all_subs):
                    auth_attempt_note = (
                        f"Layer 1 authenticated degraded: {reddit_primary_stats.get('failed_requests', 0)}/"
                        f"{reddit_primary_stats.get('requested_requests', 0)} request failures"
                    )
                    run_notes.append(auth_attempt_note)
                    print(f"  [!] {auth_attempt_note} - retrying with anonymous Reddit fallback")
                else:
                    auth_ready = True
            except Exception as e:
                auth_attempt_note = f"Layer 1 authenticated failed: {type(e).__name__}: {e}"
                run_notes.append(auth_attempt_note)
                print(f"  [!] {auth_attempt_note} - falling back to anonymous Reddit")

        if not provider_ready and not auth_ready:
            reddit_access_mode = "anonymous_public"
            print("\n  [1a/6] Anonymous Reddit fallback...")
            try:
                from reddit_async import scrape_all_async
                reddit_posts = asyncio.run(scrape_all_async(subreddits=all_subs))
                reddit_fallback_stats = getattr(scrape_all_async, "last_run_stats", {}) or {}
                added = _merge(reddit_posts, bucket="live")
                print(f"  [OK] Layer 1a (async fallback): {added} fresh posts")
                if _should_retry_reddit_sync(reddit_fallback_stats, added, all_subs):
                    note = (
                        f"Layer 1 anonymous degraded: {reddit_fallback_stats.get('failed_requests', 0)}/"
                        f"{reddit_fallback_stats.get('requested_requests', 0)} request failures"
                    )
                    run_notes.append(note)
                    print(f"  [!] {note} - retrying with sync scraper")
                    reddit_posts = scrape_all_reddit(subreddits=all_subs)
                    reddit_fallback_stats = getattr(scrape_all_reddit, "last_run_stats", {}) or {}
                    added = _merge(reddit_posts, bucket="live")
                    print(f"  [OK] Layer 1a (sync fallback): +{added} posts")
            except Exception as e:
                note = f"Layer 1 anonymous failed: {type(e).__name__}: {e}"
                run_notes.append(note)
                print(f"  [!] {note} - falling back to sync")
                reddit_posts = scrape_all_reddit(subreddits=all_subs)
                reddit_fallback_stats = getattr(scrape_all_reddit, "last_run_stats", {}) or {}
                added = _merge(reddit_posts, bucket="live")
                print(f"  [OK] Layer 1a (sync fallback): {added} posts")

        # ── Layer 2: PullPush.io Historical (90 days back) ──
        print("\n  [2/6] Layer 2 — PullPush historical scrape...")
        try:
            from pullpush_scraper import scrape_historical_multi
            pp_posts = scrape_historical_multi(subreddits=all_subs, days_back=90, size_per_sub=100, delay=0.5)
            pullpush_added = _merge(pp_posts, bucket="historical")
            print(f"  [OK] Layer 2 (PullPush): +{pullpush_added} historical posts")
        except Exception as e:
            note = f"Layer 2 (PullPush) skipped: {type(e).__name__}: {e}"
            run_notes.append(note)
            print(f"  [!] {note}")

        print("\n  [2.5/6] Layer 2b — PullPush comment scrape...")
        try:
            from pullpush_scraper import scrape_historical_comments_multi
            comment_posts = scrape_historical_comments_multi(
                subreddits=all_subs,
                keywords=[],
                days_back=90,
                size_per_sub=25,
                delay=0.25,
                max_total=250,
            )
            comment_added = _merge(comment_posts, bucket="historical")
            print(f"  [OK] Layer 2b (comments): +{comment_added} historical comments")
        except Exception as e:
            note = f"Layer 2b (comments) skipped: {type(e).__name__}: {e}"
            run_notes.append(note)
            print(f"  [!] {note}")

        # ── Layer 3: Reddit Sitemap (real-time discovery) ──
        print("\n  [3/6] Layer 3 — Sitemap real-time discovery...")
        try:
            from sitemap_listener import discover_new_posts
            sitemap_posts = discover_new_posts(max_fetch=30)
            sitemap_added = _merge(sitemap_posts, bucket="live")
            print(f"  [OK] Layer 3 (sitemap): +{sitemap_added} newly discovered posts")
        except Exception as e:
            note = f"Layer 3 (sitemap) skipped: {type(e).__name__}: {e}"
            run_notes.append(note)
            print(f"  [!] {note}")

        # ── Layer 4: PRAW authenticated top-up when the broad lane stayed anonymous ──
        if reddit_access_mode not in {"authenticated_app", "provider_api"}:
            try:
                from reddit_auth import is_available as praw_available, scrape_all_authenticated
                if praw_available():
                    print("\n  [3.5/6] Layer 4 — PRAW authenticated top-up...")
                    praw_posts = scrape_all_authenticated(all_subs[:10], sorts=["rising"])
                    praw_added = _merge(praw_posts, bucket="live")
                    print(f"  [OK] Layer 4 (PRAW): +{praw_added} authenticated posts")
            except Exception as e:
                note = f"Layer 4 (PRAW) skipped: {type(e).__name__}: {e}"
                run_notes.append(note)
                print(f"  [!] {note}")

        effective_reddit_stats = reddit_primary_stats or reddit_async_stats
        if reddit_fallback_stats:
            effective_reddit_stats = reddit_fallback_stats

        reddit_post_count = _count_source_posts(all_posts, "reddit")
        reddit_successful_requests = int(effective_reddit_stats.get("successful_requests", 0) or 0)
        reddit_failed_requests = int(effective_reddit_stats.get("failed_requests", 0) or 0)

        reddit_health = _reddit_health_summary(
            all_subs,
            live_posts,
            async_stats=effective_reddit_stats,
            pullpush_posts=pullpush_added + comment_added,
            praw_posts=praw_added,
            sitemap_posts=sitemap_added,
        )
        print(f"  [Reddit health] {reddit_health['summary']}")
        if reddit_health["is_degraded"]:
            reddit_degraded_reason = ", ".join(reddit_health["warnings"])
            if provider_attempt_note and provider_attempt_note not in reddit_degraded_reason:
                reddit_degraded_reason = f"{provider_attempt_note}; {reddit_degraded_reason}" if reddit_degraded_reason else provider_attempt_note
            if auth_attempt_note and auth_attempt_note not in reddit_degraded_reason:
                reddit_degraded_reason = f"{auth_attempt_note}; {reddit_degraded_reason}" if reddit_degraded_reason else auth_attempt_note
            run_notes.append(f"Reddit degraded: {reddit_degraded_reason}")
            degraded_sources.append("reddit")
        else:
            healthy_sources.append("reddit")
            reddit_degraded_reason = ""

        run_notes.append(
            _format_reddit_health_note(
                reddit_access_mode,
                reddit_post_count,
                reddit_successful_requests,
                reddit_failed_requests,
                reddit_degraded_reason,
            )
        )

        # ── Proxy health guardrail ──
        try:
            from proxy_rotator import get_rotator as _get_proxy_rotator
            _proxy = _get_proxy_rotator()
            if _proxy.has_proxies() and _proxy.health.total_requests > 0:
                ph = _proxy.health
                if ph.success_rate < 0.85:
                    proxy_note = (
                        f"PROXY DEGRADED: {ph.success_rate:.0%} success rate "
                        f"({ph.blocked} blocked, {ph.timeouts} timeouts out of {ph.total_requests} requests)"
                    )
                    print(f"  [!] {proxy_note}")
                    run_notes.append(proxy_note)
                    if ph.success_rate < 0.50:
                        print(f"  [!] CRITICAL: Proxy pool below 50% — check provider dashboard")
                        run_notes.append("CRITICAL: Proxy success rate below 50%")
                else:
                    print(f"  [Proxy] Healthy: {ph.success_rate:.0%} success rate ({ph.success}/{ph.total_requests})")
        except ImportError:
            pass

    if "hackernews" in sources:
        print("\n  [4/6] Scraping Hacker News...")
        try:
            hn_posts = scrape_hn()
            _merge(hn_posts, bucket="live")
            healthy_sources.append("hackernews")
            print(f"  [OK] HN: {len(hn_posts)} posts")
        except Exception as e:
            note = f"Hacker News skipped: {type(e).__name__}: {e}"
            run_notes.append(note)
            degraded_sources.append("hackernews")
            print(f"  [!] {note}")

    if "producthunt" in sources:
        print("\n  [5/6] Scraping ProductHunt...")
        try:
            ph_posts = scrape_ph()
            _merge(ph_posts, bucket="live")
            healthy_sources.append("producthunt")
            print(f"  [OK] PH: {len(ph_posts)} posts")
        except Exception as e:
            note = f"ProductHunt skipped: {type(e).__name__}: {e}"
            run_notes.append(note)
            degraded_sources.append("producthunt")
            print(f"  [!] {note}")

    if "indiehackers" in sources:
        print("\n  [6/6] Scraping IndieHackers...")
        try:
            ih_posts = scrape_ih()
            _merge(ih_posts, bucket="live")
            healthy_sources.append("indiehackers")
            print(f"  [OK] IH: {len(ih_posts)} posts")
        except Exception as e:
            note = f"IndieHackers skipped: {type(e).__name__}: {e}"
            run_notes.append(note)
            degraded_sources.append("indiehackers")
            print(f"  [!] {note}")

    active_topic_targets = _rank_market_topic_targets(all_posts, topic_filter)

    if "githubissues" in sources:
        print("\n  [7/9] Enriching GitHub Issues...")
        github_targets = _filter_market_topic_targets(
            active_topic_targets,
            allowed_categories={"dev-tools", "ai", "data", "productivity", "saas"},
            limit=4,
        ) or _filter_market_topic_targets(active_topic_targets, limit=4)
        try:
            from market_optional_sources import scrape_market_github_posts

            github_result = scrape_market_github_posts(
                github_targets,
                TRACKED_TOPICS,
                max_topics=max(1, len(github_targets)),
            )
            github_posts = github_result.get("posts", [])
            added = _merge(github_posts, bucket="live")
            optional_source_notes.append(
                f"GitHub Issues: topics={','.join(github_targets) or 'none'}, posts={added}"
            )
            healthy_sources.append("githubissues")
            if added > 0:
                print(f"  [OK] GitHub Issues: +{added} posts across {len(github_targets)} topics")
            else:
                note = f"GitHub Issues returned 0 posts across {len(github_targets)} topic targets"
                run_notes.append(note)
                print(f"  [!] {note}")
        except Exception as e:
            note = f"GitHub Issues skipped: {type(e).__name__}: {e}"
            run_notes.append(note)
            degraded_sources.append("githubissues")
            print(f"  [!] {note}")

    if "g2_review" in sources:
        print("\n  [8/9] Enriching G2 reviews...")
        g2_targets = _filter_market_topic_targets(
            active_topic_targets,
            allowed_categories={"fintech", "productivity", "marketing", "saas", "ecommerce", "data", "hr"},
            limit=3,
        )
        try:
            from market_optional_sources import scrape_market_g2_posts

            g2_result = scrape_market_g2_posts(
                g2_targets,
                TRACKED_TOPICS,
                max_topics=max(1, len(g2_targets)),
                timeout_seconds=45,
            )
            if not g2_result.get("executed", True):
                note = f"G2 skipped: {g2_result.get('reason') or 'not configured'}"
                run_notes.append(note)
                degraded_sources.append("g2_review")
                print(f"  [!] {note}")
            else:
                g2_posts = g2_result.get("posts", [])
                added = _merge(g2_posts, bucket="live")
                optional_source_notes.append(
                    f"G2 reviews: topics={','.join(g2_targets) or 'none'}, posts={added}"
                )
                healthy_sources.append("g2_review")
                if added > 0:
                    print(f"  [OK] G2 reviews: +{added} complaint posts")
                else:
                    note = f"G2 returned 0 review complaints across {len(g2_targets)} topic targets"
                    run_notes.append(note)
                    print(f"  [!] {note}")
        except Exception as e:
            note = f"G2 skipped: {type(e).__name__}: {e}"
            run_notes.append(note)
            degraded_sources.append("g2_review")
            print(f"  [!] {note}")

    if "job_posting" in sources:
        print("\n  [9/9] Enriching job postings...")
        job_targets = _filter_market_topic_targets(
            active_topic_targets,
            allowed_categories={"fintech", "productivity", "marketing", "saas", "ecommerce", "hr", "data", "dev-tools", "ai"},
            limit=3,
        )
        try:
            from market_optional_sources import scrape_market_job_posts

            job_result = scrape_market_job_posts(
                job_targets,
                TRACKED_TOPICS,
                max_topics=max(1, len(job_targets)),
                timeout_seconds=35,
                max_posts=45,
            )
            if not job_result.get("executed", True):
                note = f"Jobs skipped: {job_result.get('reason') or 'not configured'}"
                run_notes.append(note)
                degraded_sources.append("job_posting")
                print(f"  [!] {note}")
            else:
                job_posts = job_result.get("posts", [])
                added = _merge(job_posts, bucket="live")
                optional_source_notes.append(
                    f"Jobs: topics={','.join(job_targets) or 'none'}, posts={added}"
                )
                healthy_sources.append("job_posting")
                if added > 0:
                    print(f"  [OK] Jobs: +{added} postings")
                else:
                    note = f"Jobs returned 0 postings across {len(job_targets)} topic targets"
                    run_notes.append(note)
                    print(f"  [!] {note}")
        except Exception as e:
            note = f"Jobs skipped: {type(e).__name__}: {e}"
            run_notes.append(note)
            degraded_sources.append("job_posting")
            print(f"  [!] {note}")

    run_notes.extend(optional_source_notes[:3])

    source_health_note = _format_source_health_note(healthy_sources, degraded_sources)
    if source_health_note not in run_notes:
        run_notes.append(source_health_note)

    source_counts = Counter(_normalized_market_source(post) for post in all_posts)
    all_posts = _normalize_market_posts_with_taxonomy(all_posts)
    live_posts = _normalize_market_posts_with_taxonomy(live_posts)
    print(f"\n  Total posts scraped (deduplicated): {len(all_posts)}")
    print(f"  Live signal corpus: {len(live_posts)} posts")
    print(f"  Historical support corpus: {len(historical_ids)} posts")
    if source_counts:
        print(f"  Source mix: {dict(source_counts)}")
        print(f"  Evidence taxonomy: {summarize_taxonomy(all_posts)}")

    if not all_posts:
        print("  [!] No posts collected — exiting")
        run_notes.append("No posts collected")
        finalize_scraper_run_record(run_id, "failed", start_time, posts_collected=0, ideas_updated=0, notes=run_notes)
        _ACTIVE_SCRAPER_CONTEXT.clear()
        return

    _ACTIVE_SCRAPER_CONTEXT["posts_collected"] = len(all_posts)

    if SUPABASE_URL:
        try:
            saved_posts = store_posts(all_posts)
            print(f"  [OK] Stored {saved_posts} raw posts in Supabase")
        except Exception as e:
            print(f"  [Posts] Raw post storage skipped: {e}")

        try:
            alert_matches = check_alerts_against_posts(all_posts)
            if alert_matches:
                print(f"  [PainStream] {alert_matches} new alert matches created")
        except Exception as e:
            print(f"  [PainStream] Alert check skipped: {e}")

        try:
            all_known_competitors = []
            for competitor_list in KNOWN_COMPETITORS.values():
                all_known_competitors.extend(competitor_list)
            complaints = scan_for_complaints(all_posts, all_known_competitors)
            if complaints:
                saved_complaints = save_complaints(complaints)
                print(f"  [Deathwatch] {saved_complaints} competitor pain signals saved")
        except Exception as e:
            print(f"  [Deathwatch] Scan skipped: {e}")

        try:
            aggregate_trends(posts=all_posts, select_fn=sb_select, patch_fn=sb_patch, upsert_fn=sb_upsert)
        except Exception as e:
            print(f"  [Trends] Aggregation skipped: {e}")

        try:
            pulse_updates = update_validation_scores(all_posts)
            if pulse_updates:
                print(f"  [Pulse] Updated {pulse_updates} active validations")
        except Exception as e:
            print(f"  [Pulse] Score updates skipped: {e}")

    # ── 2. Cluster posts → ideas ──
    signal_posts = live_posts if live_posts else all_posts

    print("\n  Clustering posts into idea topics...")
    idea_posts = defaultdict(list)
    signal_posts_by_topic = defaultdict(list)
    unmatched_all_posts = []
    unmatched_signal_posts = []
    all_post_keys = {
        _market_post_key(post)
        for post in all_posts
        if _market_post_key(post)
    }
    matched_post_keys = set()
    market_funnel = {
        "scraped_posts": len(all_post_keys) or len(all_posts),
        "matched_posts": 0,
        "unmatched_posts": 0,
        "builder_meta_filtered_posts": 0,
        "dynamic_topics": 0,
        "subreddit_bucket_topics": 0,
        "invalid_topic_skips": 0,
        "weak_topic_skips": 0,
        "final_ideas": 0,
    }

    for post in all_posts:
        classification = _classify_post_to_topics_with_meta(post)
        topics = classification["topics"]
        if topics:
            post_key = _market_post_key(post)
            if post_key:
                matched_post_keys.add(post_key)
            for topic in topics:
                idea_posts[topic].append(post)
        else:
            unmatched_all_posts.append(post)
            if classification.get("builder_meta_filtered"):
                market_funnel["builder_meta_filtered_posts"] += 1

    for post in signal_posts:
        topics = classify_post_to_topics(post)
        if topics:
            for topic in topics:
                signal_posts_by_topic[topic].append(post)
        else:
            unmatched_signal_posts.append(post)

    market_funnel["matched_posts"] = len(matched_post_keys)
    market_funnel["unmatched_posts"] = max(0, market_funnel["scraped_posts"] - market_funnel["matched_posts"])

    dynamic_topic_meta = {}
    dynamic_idea_posts, dynamic_signal_topics, dynamic_topic_meta, assigned_dynamic_post_keys = _discover_dynamic_market_topics(
        unmatched_all_posts,
        unmatched_signal_posts,
    )
    for slug, posts in dynamic_idea_posts.items():
        idea_posts[slug].extend(posts)
    for slug, posts in dynamic_signal_topics.items():
        signal_posts_by_topic[slug].extend(posts)
    if dynamic_topic_meta:
        print(f"  [Dynamic Themes] {len(dynamic_topic_meta)} recurring unmatched themes promoted into the market")
    market_funnel["dynamic_topics"] = len(dynamic_topic_meta)

    unmatched_signal_keys = {
        _market_post_key(post)
        for post in unmatched_signal_posts
        if _market_post_key(post)
    }
    unmatched_by_sub = defaultdict(list)
    for post in unmatched_all_posts:
        post_key = _market_post_key(post)
        if post_key in assigned_dynamic_post_keys:
            continue
        sub = (post.get("subreddit") or "").strip()
        if sub and is_pain_post(post):
            unmatched_by_sub[sub].append(post)

    # ── Pain-gated dynamic topics from unmatched subreddit posts ──
    # Only create a topic if ≥6 pain posts exist — keep subreddit buckets as high-signal context only
    dynamic_created = 0
    for sub, pain_posts in unmatched_by_sub.items():
        if len(pain_posts) < 6:
            continue
        dyn_slug = f"sub-{sub.lower()}"
        idea_posts[dyn_slug].extend(pain_posts)
        signal_bucket = [post for post in pain_posts if _market_post_key(post) in unmatched_signal_keys]
        signal_posts_by_topic[dyn_slug].extend(signal_bucket or pain_posts)
        dynamic_created += 1

    if dynamic_created:
        print(f"  [Pain Gate] {dynamic_created} dynamic topics qualified (>=6 pain posts each)")
    market_funnel["subreddit_bucket_topics"] = dynamic_created

    # Filter by topic if specified
    if topic_filter:
        idea_posts = {k: v for k, v in idea_posts.items() if k in topic_filter}
        signal_posts_by_topic = {k: v for k, v in signal_posts_by_topic.items() if k in topic_filter}

    active_topic_posts = signal_posts_by_topic if signal_posts_by_topic else idea_posts
    matched_ideas = len(active_topic_posts)
    matched_posts = sum(len(v) for v in active_topic_posts.values())
    print(f"  [OK] {matched_posts} live-signal posts matched into {matched_ideas} idea topics")

    # ── 3. Load existing ideas from Supabase ──
    existing_ideas = {}
    if SUPABASE_URL:
        rows = sb_select("ideas", "select=*")
        for row in rows:
            existing_ideas[row["slug"]] = row
    idea_optional_columns = {
        "post_count_24h": table_has_column("ideas", "post_count_24h"),
        "pain_count": table_has_column("ideas", "pain_count"),
        "pain_summary": table_has_column("ideas", "pain_summary"),
        "last_24h_update": table_has_column("ideas", "last_24h_update"),
        "last_7d_update": table_has_column("ideas", "last_7d_update"),
        "score_breakdown": table_has_column("ideas", "score_breakdown"),
        "competition_data": table_has_column("ideas", "competition_data"),
        "market_editorial": table_has_column("ideas", "market_editorial"),
        "market_editorial_updated_at": table_has_column("ideas", "market_editorial_updated_at"),
    }

    # ── 4. Calculate scores + upsert ──
    print("\n  Calculating idea scores...")
    ideas_to_upsert = []
    history_to_insert = []
    ideas_updated = 0

    for slug, signal_bucket in active_topic_posts.items():
        posts = idea_posts.get(slug, signal_bucket)
        topic_info = TRACKED_TOPICS.get(slug) or dynamic_topic_meta.get(slug) or {}

        # Handle dynamic topics — phrase cluster first, then subreddit pain buckets.
        if slug in dynamic_topic_meta:
            topic_name = dynamic_topic_meta[slug].get("topic", slug.replace("-", " ").title())
            topic_info = {
                "category": dynamic_topic_meta[slug].get("category", "general"),
                "keywords": dynamic_topic_meta[slug].get("keywords", []),
            }
        elif slug.startswith("sub-"):
            subreddit_name = slug[4:]
            category = SUBREDDIT_CATEGORIES.get(subreddit_name, "general")
            topic_name = f"{subreddit_name.replace('_', ' ').title()} workflow pain"
            topic_info = {"category": category, "keywords": [subreddit_name]}
        else:
            topic_name = slug.replace("-", " ").title()

        if _is_invalid_market_topic_name(topic_name):
            print(f"  [Skip] Rejected invalid market topic name: {topic_name}")
            market_funnel["invalid_topic_skips"] += 1
            continue

        score, breakdown = calculate_idea_score(
            slug,
            posts,
            signal_posts=signal_bucket,
        )
        existing = existing_ideas.get(slug)
        now_utc = datetime.now(timezone.utc)

        # Roll baselines forward only when their time window has elapsed.
        baselines = _resolve_score_baselines(existing, now_utc)
        prev_24h = baselines["prev_24h"]
        prev_7d = baselines["prev_7d"]
        prev_30d = baselines["prev_30d"]

        top_posts_json = build_top_posts_for_topic(posts)
        signal_contract = _market_support_level_from_top_posts(
            top_posts_json,
            source_breakdown=breakdown.get("sources", []),
            source_count=breakdown.get("source_count", 1),
        )
        trend = determine_trend(score, prev_24h, prev_7d)
        confidence = determine_confidence(
            len(posts),
            breakdown.get("source_count", 1),
            pain_count=breakdown.get("pain_count", 0),
            signal_contract=signal_contract,
        )

        # Skip obviously weak launch-heavy hypotheses for brand-new topics.
        min_new_posts = 4 if slug in dynamic_topic_meta else (6 if slug.startswith("sub-") else 3)
        if not existing and (
            len(posts) < min_new_posts
            or (
                signal_contract.get("support_level") == "hypothesis"
                and signal_contract.get("buyer_native_direct_count", 0) == 0
                and (
                    signal_contract.get("hn_launch_heavy")
                    or len(posts) < (8 if slug in dynamic_topic_meta else 12)
                )
            )
        ):
            market_funnel["weak_topic_skips"] += 1
            continue

        pain_summary, pain_count = _build_pain_summary(posts, topic_name)
        competition_data = _build_market_leaders(
            slug,
            topic_name,
            posts,
            keywords=topic_info.get("keywords", []),
        )

        idea_row = {
            "topic": topic_name,
            "slug": slug,
            "current_score": score,
            "score_24h_ago": baselines["next_score_24h_ago"],
            "score_7d_ago": baselines["next_score_7d_ago"],
            "score_30d_ago": baselines["next_score_30d_ago"],
            "change_24h": round(score - prev_24h, 1) if prev_24h > 0 else 0,
            "change_7d": round(score - prev_7d, 1) if prev_7d > 0 else 0,
            "change_30d": round(score - prev_30d, 1) if prev_30d > 0 else 0,
            "trend_direction": trend,
            "confidence_level": confidence,
            "post_count_total": len(posts),
            "post_count_7d": breakdown.get("post_count_7d", 0),
            "source_count": breakdown.get("source_count", 1),
            "sources": json.dumps(breakdown.get("sources", [])),
            "reddit_velocity": breakdown.get("velocity", 0),
            "cross_platform_multiplier": breakdown.get("cross_platform", 0),
            "competition_score": 0,
            "category": topic_info.get("category", "general"),
            "top_posts": json.dumps(top_posts_json),
            "keywords": json.dumps(topic_info.get("keywords", [])),
            "last_updated": now_utc.isoformat(),
        }

        if idea_optional_columns["post_count_24h"]:
            idea_row["post_count_24h"] = breakdown.get("post_count_24h", 0)
        if idea_optional_columns["pain_count"]:
            idea_row["pain_count"] = pain_count or breakdown.get("pain_count", 0)
        if idea_optional_columns["pain_summary"] and pain_summary:
            idea_row["pain_summary"] = pain_summary
        if idea_optional_columns["last_24h_update"]:
            idea_row["last_24h_update"] = baselines["next_last_24h_update"]
        if idea_optional_columns["last_7d_update"]:
            idea_row["last_7d_update"] = baselines["next_last_7d_update"]
        if idea_optional_columns["score_breakdown"]:
            idea_row["score_breakdown"] = breakdown
        if idea_optional_columns["competition_data"] and competition_data:
            idea_row["competition_data"] = competition_data

        ideas_to_upsert.append(idea_row)
        ideas_updated += 1
        _ACTIVE_SCRAPER_CONTEXT["ideas_updated"] = ideas_updated

        # History record
        history_to_insert.append({
            "score": score,
            "post_count": len(posts),
            "source_count": breakdown.get("source_count", 1),
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        })

        tier_icon = {"INSUFFICIENT": "---", "LOW": " . ", "MEDIUM": " o ", "HIGH": " O ", "STRONG": " @ "}
        trend_icon = {"rising": "+", "falling": "-", "stable": "=", "new": "*"}
        print(f"    [{tier_icon.get(confidence, '?')}] {slug:30s} {score:5.1f} {trend_icon.get(trend, '?')} ({len(posts)} posts, {breakdown.get('source_count',1)} sources)")

    market_funnel["final_ideas"] = len(ideas_to_upsert)
    run_notes.append(_format_market_funnel_note(market_funnel))

    # ── 5. Upsert to Supabase ──
    editorial_updates = []
    if ideas_to_upsert:
        persist_editorial = idea_optional_columns["market_editorial"] and idea_optional_columns["market_editorial_updated_at"]
        editorial_seed_rows = []
        for row in ideas_to_upsert:
            merged = dict(row)
            existing_editorial_row = existing_ideas.get(row.get("slug"))
            if existing_editorial_row:
                if "market_editorial" in existing_editorial_row:
                    merged["market_editorial"] = existing_editorial_row.get("market_editorial")
                if "market_editorial_updated_at" in existing_editorial_row:
                    merged["market_editorial_updated_at"] = existing_editorial_row.get("market_editorial_updated_at")
            editorial_seed_rows.append(merged)

        ideas_to_upsert, editorial_updates, editorial_telemetry = run_market_editorial_pass(
            editorial_seed_rows,
            list(existing_ideas.values()) + editorial_seed_rows,
            persist_enabled=persist_editorial,
            runtime_context={
                "healthy_sources": healthy_sources,
                "degraded_sources": degraded_sources,
                "source_counts": dict(source_counts),
            },
            logger=print,
        )
        if editorial_telemetry.get("enabled"):
            run_notes.append(
                "Market editorial: "
                f"mode={editorial_telemetry.get('publish_mode', 'shadow')}, "
                f"{editorial_telemetry.get('processed', 0)} processed, "
                f"{editorial_telemetry.get('approved_public', 0)} public, "
                f"{editorial_telemetry.get('duplicates', 0)} duplicates, "
                f"{editorial_telemetry.get('fallback_count', 0)} fallback, "
                f"{editorial_telemetry.get('tokens_used', 0)} tokens, "
                f"daily={editorial_telemetry.get('daily_tokens_after', 0)}/{editorial_telemetry.get('daily_budget_limit', 0)}"
            )
            if editorial_telemetry.get("source_mix_status") not in {"", "healthy", "unknown"}:
                run_notes.append(
                    f"Market editorial source mix: {editorial_telemetry.get('source_mix_status')}"
                    + (f" ({editorial_telemetry.get('source_mix_note')})" if editorial_telemetry.get("source_mix_note") else "")
                )
            if editorial_telemetry.get("errors"):
                run_notes.append(
                    f"Market editorial warnings: {', '.join(str(item) for item in editorial_telemetry['errors'][:4])}"
                )

    idea_rows_to_upsert = ideas_to_upsert + editorial_updates

    if SUPABASE_URL and idea_rows_to_upsert:
        print(f"\n  Uploading {len(idea_rows_to_upsert)} ideas to Supabase...")

        # Upsert ideas in chunks first to cut down the number of round-trips.
        idea_upsert_successes, idea_upsert_failures = _bulk_upsert_rows(
            "ideas",
            idea_rows_to_upsert,
            on_conflict="slug",
            chunk_size=25,
            id_fn=lambda row: row.get("slug", "unknown"),
        )

        # Insert history (need idea_ids)
        updated_ideas = sb_select("ideas", "select=id,slug")
        slug_to_id = {r["slug"]: r["id"] for r in updated_ideas}

        history_rows = []
        history_failures = []
        for i, hist in enumerate(history_to_insert):
            slug = ideas_to_upsert[i]["slug"]
            idea_id = slug_to_id.get(slug)
            if idea_id:
                history_rows.append({
                    **hist,
                    "idea_id": idea_id,
                })
            else:
                history_failures.append(slug)

        history_successes, batched_history_failures = _bulk_upsert_rows(
            "idea_history",
            history_rows,
            chunk_size=50,
            id_fn=lambda row: row.get("idea_id", "unknown"),
        )
        history_failures.extend(batched_history_failures)

        if idea_upsert_failures:
            print(f"  [!] Idea upsert failures: {', '.join(idea_upsert_failures[:8])}")
            run_notes.append(f"Idea upsert failures: {', '.join(idea_upsert_failures[:8])}")
        if history_failures:
            print(f"  [!] Idea history failures: {', '.join(history_failures[:8])}")
            run_notes.append(f"Idea history failures: {', '.join(history_failures[:8])}")

        print(
            f"  [OK] {idea_upsert_successes}/{len(idea_rows_to_upsert)} ideas upserted + "
            f"{history_successes}/{len(history_to_insert)} history records"
        )

    # ── 6. Update run log ──
    structured_note_prefixes = ("Source health:", "Run metadata:", "Reddit health:", "Market funnel:", "Market editorial:")
    non_health_notes = [
        note for note in run_notes
        if not str(note or "").startswith(structured_note_prefixes)
    ]
    if degraded_sources:
        run_status = "degraded"
    elif not non_health_notes and not idea_upsert_failures:
        run_status = "completed"
    else:
        run_status = "completed_errors"
    finalize_scraper_run_record(
        run_id,
        run_status,
        start_time,
        posts_collected=len(all_posts),
        ideas_updated=ideas_updated,
        notes=run_notes,
    )
    _ACTIVE_SCRAPER_CONTEXT.clear()

    if SUPABASE_URL:
        print("\n  Running database cleanup...")
        sb_rpc("cleanup_old_posts")

    duration = round(time.time() - start_time, 1)
    print(f"\n{'=' * 60}")
    print(f"  Done! {len(all_posts)} posts -> {ideas_updated} ideas updated")
    print(f"  Duration: {duration}s")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Opportunity Engine — Scraper Job")
    parser.add_argument("--sources", nargs="+", default=None,
                        choices=["reddit", "hackernews", "producthunt", "indiehackers", "githubissues", "g2_review", "job_posting"],
                        help="Which sources to scrape")
    parser.add_argument("--topics", type=str, default=None,
                        help="Comma-separated topic slugs to update (e.g. 'invoice-automation,crm-for-freelancers')")
    parser.add_argument("--mode", default="full", choices=["full", "trends", "quick"])
    parser.add_argument("--source", default="local", help="Caller identifier for logging")
    args = parser.parse_args()

    topic_filter = None
    if args.topics:
        topic_filter = [t.strip() for t in args.topics.split(",")]

    try:
        run_scraper_job(
            sources=args.sources,
            topic_filter=topic_filter,
            mode=args.mode,
            source_label=args.source,
        )
    except Exception as e:
        run_id = _ACTIVE_SCRAPER_CONTEXT.get("run_id")
        start_time = _ACTIVE_SCRAPER_CONTEXT.get("start_time", time.time())
        posts_collected = int(_ACTIVE_SCRAPER_CONTEXT.get("posts_collected", 0) or 0)
        ideas_updated = int(_ACTIVE_SCRAPER_CONTEXT.get("ideas_updated", 0) or 0)
        finalize_scraper_run_record(
            run_id,
            "failed",
            start_time,
            posts_collected=posts_collected,
            ideas_updated=ideas_updated,
            notes=[f"Fatal error: {type(e).__name__}: {e}"],
        )
        _ACTIVE_SCRAPER_CONTEXT.clear()
        print(f"\n  [FATAL] {e}")
        traceback.print_exc()
