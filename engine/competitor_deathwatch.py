"""
RedditPulse — Competitor Deathwatch
Scans scraped posts for competitor complaints and negative sentiment.
Sales intelligence: know when users are unhappy with alternatives.

Usage:
    from competitor_deathwatch import scan_for_complaints
    complaints = scan_for_complaints(posts, competitor_names)
"""

import re
import os
import requests
from datetime import datetime, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_KEY", ""))

# ═══════════════════════════════════════════════════════
# COMPLAINT SIGNAL PATTERNS
# ═══════════════════════════════════════════════════════

COMPLAINT_SIGNALS = [
    re.compile(p, re.IGNORECASE) for p in [
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


def scan_for_complaints(posts: list, competitor_names: list) -> list:
    """
    Scan posts for competitor complaints.

    Args:
        posts: list of scraped post dicts (must have 'full_text' or 'title' + 'selftext')
        competitor_names: list of competitor brand names to watch for

    Returns:
        list of complaint dicts: {post_title, post_score, post_url, subreddit,
                                   competitors_mentioned, complaint_signals}
    """
    if not competitor_names:
        return []

    # Normalize competitor names for matching
    comp_patterns = {}
    for name in competitor_names:
        clean = name.strip()
        if len(clean) >= 2:
            comp_patterns[clean.lower()] = re.compile(
                r'\b' + re.escape(clean) + r'\b', re.IGNORECASE
            )

    complaints = []

    for post in posts:
        text = (post.get("full_text")
                or f"{post.get('title', '')} {post.get('selftext', '')}")
        if not text or len(text) < 20:
            continue

        # Find which competitors are mentioned
        mentioned = []
        for comp_name, pattern in comp_patterns.items():
            if pattern.search(text):
                mentioned.append(comp_name)

        if not mentioned:
            continue

        # Check for complaint signals
        signals_found = []
        for sig_pattern in COMPLAINT_SIGNALS:
            match = sig_pattern.search(text)
            if match:
                signals_found.append(match.group(0))

        if not signals_found:
            continue

        complaints.append({
            "post_title": (post.get("title") or "")[:500],
            "post_score": post.get("score", 0),
            "post_url": post.get("permalink", ""),
            "subreddit": post.get("subreddit", ""),
            "competitors_mentioned": mentioned,
            "complaint_signals": signals_found[:5],  # cap to avoid noise
        })

    print(f"  [Deathwatch] {len(complaints)} competitor complaints found across {len(posts)} posts")
    return complaints


def save_complaints(complaints: list) -> int:
    """Save complaints to Supabase. Returns count saved."""
    if not SUPABASE_URL or not SUPABASE_KEY or not complaints:
        return 0

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    try:
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/competitor_complaints",
            headers=headers,
            json=complaints,
            timeout=15,
        )
        if resp.status_code in (200, 201):
            print(f"  [Deathwatch] ✓ {len(complaints)} complaints saved to DB")
            return len(complaints)
        else:
            print(f"  [Deathwatch] ✗ Save failed: {resp.status_code}")
            return 0
    except Exception as e:
        print(f"  [Deathwatch] ✗ Save error: {e}")
        return 0


def get_complaints(limit: int = 100) -> list:
    """Fetch recent competitor complaints from DB."""
    if not SUPABASE_URL:
        return []
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/competitor_complaints",
            headers=headers,
            params={"order": "scraped_at.desc", "limit": limit},
            timeout=10,
        )
        return resp.json() if resp.status_code == 200 else []
    except Exception:
        return []
