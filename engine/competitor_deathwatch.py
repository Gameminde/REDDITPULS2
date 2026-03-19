"""
RedditPulse - Competitor Deathwatch
Scans scraped posts for competitor complaints and negative sentiment.
Sales intelligence: know when users are unhappy with alternatives.

Usage:
    from competitor_deathwatch import scan_for_complaints
    complaints = scan_for_complaints(posts, competitor_names)
"""

import os
import re
import uuid
import requests
from datetime import datetime, timedelta, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_KEY", ""))

COMPLAINT_SIGNALS = [
    re.compile(pattern, re.IGNORECASE) for pattern in [
        r"\b(hate|hating|hated)\s+(using|this|it|the)",
        r"\b(frustrated|frustrating|frustration)\b",
        r"\b(switching|switched|migrate|migrating)\s+(from|away)",
        r"\b(alternative|replacement)\s+(to|for)\b",
        r"\b(stopped using|quit using|gave up on|abandoned)\b",
        r"\b(terrible|horrible|awful|worst)\s+(experience|support|service|product)",
        r"\b(broken|buggy|crashes|crashing|unreliable)\b",
        r"\b(overpriced|too expensive|price hike|price increase)\b",
        r"\b(customer support|support team)\s+(is|was|sucks|terrible|nonexistent)",
        r"\b(downgrade|downgraded|paywall|feature removal)\b",
        r"\b(looking for|searching for|need)\s+(a|an)?\s*(better|new|different|cheaper)\b",
        r"\b(deal[\s-]?breaker|last straw|final straw)\b",
        r"\b(cancel|cancelled|canceling|unsubscribe)\b",
        r"\b(scam|ripoff|rip[\s-]?off|fraud)\b",
        r"\b(enshittification|enshittified|degraded|degrading)\b",
    ]
]


def _headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def _complaint_identity(post: dict, mentioned: list) -> str:
    canonical_url = str(post.get("permalink") or post.get("url") or "").strip()
    if canonical_url:
        return canonical_url
    source = str(post.get("source") or post.get("subreddit") or "unknown").strip().lower()
    subreddit = str(post.get("subreddit") or "unknown").strip().lower()
    title = str(post.get("title") or "").strip().lower()
    competitors = ",".join(sorted(mentioned))
    return f"{source}:{subreddit}:{competitors}:{title[:240]}"


def scan_for_complaints(posts: list, competitor_names: list) -> list:
    """
    Scan posts for competitor complaints.

    Args:
        posts: list of scraped post dicts
        competitor_names: list of competitor brand names to watch for

    Returns:
        list of complaint dicts
    """
    if not competitor_names:
        return []

    competitor_patterns = {}
    for name in competitor_names:
        clean = str(name).strip()
        if len(clean) >= 2:
            competitor_patterns[clean.lower()] = re.compile(
                r"\b" + re.escape(clean) + r"\b",
                re.IGNORECASE,
            )

    complaints = []
    seen_ids = set()

    for post in posts:
        text = str(post.get("full_text") or f"{post.get('title', '')} {post.get('selftext', '')}").strip()
        if len(text) < 20:
            continue

        mentioned = [
            competitor
            for competitor, pattern in competitor_patterns.items()
            if pattern.search(text)
        ]
        if not mentioned:
            continue

        signals_found = []
        for signal_pattern in COMPLAINT_SIGNALS:
            match = signal_pattern.search(text)
            if match:
                signals_found.append(match.group(0))
        if not signals_found:
            continue

        complaint_id = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                _complaint_identity(post, mentioned),
            )
        )
        if complaint_id in seen_ids:
            continue
        seen_ids.add(complaint_id)

        complaints.append({
            "id": complaint_id,
            "post_title": str(post.get("title") or "")[:500],
            "post_score": int(post.get("score", 0) or 0),
            "post_url": str(post.get("permalink") or post.get("url") or ""),
            "subreddit": str(post.get("subreddit") or ""),
            "competitors_mentioned": sorted(set(mentioned)),
            "complaint_signals": signals_found[:5],
            "scraped_at": datetime.now(timezone.utc).isoformat(),
        })

    print(f"  [Deathwatch] {len(complaints)} competitor complaints found across {len(posts)} posts")
    return complaints


def _cleanup_old_complaints() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    try:
        requests.delete(
            f"{SUPABASE_URL}/rest/v1/competitor_complaints",
            headers=_headers(),
            params={"scraped_at": f"lt.{cutoff}"},
            timeout=10,
        )
    except Exception as exc:
        print(f"  [Deathwatch] X Cleanup error: {exc}")


def save_complaints(complaints: list) -> int:
    """Save complaints to Supabase with idempotent upsert. Returns count saved."""
    if not complaints:
        print("  [Deathwatch] No competitor complaints to save")
        return 0

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("  [Deathwatch] Supabase not configured - complaints were detected but not persisted")
        return 0

    try:
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/competitor_complaints",
            headers={**_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
            params={"on_conflict": "id"},
            json=complaints,
            timeout=15,
        )
        if resp.status_code in (200, 201):
            _cleanup_old_complaints()
            print(f"  [Deathwatch] OK {len(complaints)} complaints upserted to DB")
            return len(complaints)
        print(f"  [Deathwatch] X Save failed: {resp.status_code} {resp.text[:200]}")
        return 0
    except Exception as exc:
        print(f"  [Deathwatch] X Save error: {exc}")
        return 0


def get_complaints(limit: int = 100) -> list:
    """Fetch recent competitor complaints from DB."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/competitor_complaints",
            headers=_headers(),
            params={"order": "scraped_at.desc", "limit": limit},
            timeout=10,
        )
        return resp.json() if resp.status_code == 200 else []
    except Exception:
        return []
