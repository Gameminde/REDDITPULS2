"""
RedditPulse — Pain Stream (Retention Alerts Engine)
Creates alerts from validation keywords, checks new posts for matches,
and stores them for the user's alerts feed.

Solves churn: user validates once → gets alerted about new relevant posts → returns daily.
"""

import os
import re
import time
import requests
from datetime import datetime, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_KEY", ""))


def _headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


# ═══════════════════════════════════════════════════════
# ALERT CREATION
# ═══════════════════════════════════════════════════════

def create_alert(user_id: str, validation_id: str, keywords: list,
                 subreddits: list = None, min_score: int = 10) -> dict:
    """
    Create a pain alert after a validation completes.
    Auto-called at end of validate_idea pipeline.

    Returns the created alert row or empty dict on failure.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("  [PainStream] Supabase not configured — skipping alert creation")
        return {}

    payload = {
        "user_id": user_id,
        "validation_id": validation_id,
        "keywords": keywords[:10],  # cap at 10 keywords
        "subreddits": (subreddits or [])[:20],
        "min_score": min_score,
        "is_active": True,
    }

    try:
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/pain_alerts",
            headers=_headers(),
            json=payload,
            timeout=10,
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            alert = data[0] if isinstance(data, list) else data
            print(f"  [PainStream] ✓ Alert created: {len(keywords)} keywords, min_score={min_score}")
            return alert
        else:
            print(f"  [PainStream] ✗ Alert creation failed: {resp.status_code} {resp.text[:200]}")
            return {}
    except Exception as e:
        print(f"  [PainStream] ✗ Alert creation error: {e}")
        return {}


def get_user_alerts(user_id: str) -> list:
    """Get all active alerts for a user."""
    if not SUPABASE_URL:
        return []
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/pain_alerts",
            headers=_headers(),
            params={"user_id": f"eq.{user_id}", "is_active": "eq.true", "order": "created_at.desc"},
            timeout=10,
        )
        return resp.json() if resp.status_code == 200 else []
    except Exception:
        return []


def get_alert_matches(user_id: str, limit: int = 50, unseen_only: bool = False) -> list:
    """Get recent alert matches for a user."""
    if not SUPABASE_URL:
        return []
    try:
        params = {
            "user_id": f"eq.{user_id}",
            "order": "matched_at.desc",
            "limit": limit,
        }
        if unseen_only:
            params["seen"] = "eq.false"
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/alert_matches",
            headers=_headers(),
            params=params,
            timeout=10,
        )
        return resp.json() if resp.status_code == 200 else []
    except Exception:
        return []


def mark_matches_seen(user_id: str, match_ids: list = None) -> bool:
    """Mark alert matches as seen."""
    if not SUPABASE_URL:
        return False
    try:
        params = {"user_id": f"eq.{user_id}"}
        if match_ids:
            params["id"] = f"in.({','.join(match_ids)})"
        resp = requests.patch(
            f"{SUPABASE_URL}/rest/v1/alert_matches",
            headers=_headers(),
            params=params,
            json={"seen": True},
            timeout=10,
        )
        return resp.status_code in (200, 204)
    except Exception:
        return False


# ═══════════════════════════════════════════════════════
# ALERT CHECKING — run periodically via scraper_job.py
# ═══════════════════════════════════════════════════════

def check_alerts_against_posts(posts: list) -> int:
    """
    Check all active alerts against a batch of scraped posts.
    Creates alert_matches for any hits.
    Returns count of new matches created.

    Called from scraper_job.py after each scrape cycle.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        return 0

    # Fetch all active alerts
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/pain_alerts",
            headers=_headers(),
            params={"is_active": "eq.true", "select": "*"},
            timeout=10,
        )
        if resp.status_code != 200:
            return 0
        alerts = resp.json()
    except Exception:
        return 0

    if not alerts:
        return 0

    matches_created = 0
    batch = []

    for alert in alerts:
        alert_kws = [kw.lower() for kw in (alert.get("keywords") or [])]
        alert_subs = [s.lower() for s in (alert.get("subreddits") or [])]
        min_score = alert.get("min_score", 10)

        for post in posts:
            score = post.get("score", 0)
            if score < min_score:
                continue

            # Subreddit filter (if specified)
            post_sub = (post.get("subreddit") or "").lower()
            if alert_subs and post_sub not in alert_subs:
                continue

            # Keyword matching
            text = (post.get("full_text") or post.get("title", "")).lower()
            matched = [kw for kw in alert_kws if kw in text]
            if len(matched) < 2:  # require 2+ keyword hits (same as scraper)
                continue

            batch.append({
                "alert_id": alert["id"],
                "user_id": alert["user_id"],
                "post_title": (post.get("title") or "")[:500],
                "post_score": score,
                "post_url": post.get("permalink", ""),
                "subreddit": post.get("subreddit", ""),
                "matched_keywords": matched,
            })
            matches_created += 1

    # Batch insert
    if batch:
        try:
            resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/alert_matches",
                headers={**_headers(), "Prefer": "return=minimal"},
                json=batch,
                timeout=15,
            )
            if resp.status_code in (200, 201):
                print(f"  [PainStream] ✓ {len(batch)} new matches created across {len(alerts)} alerts")
            else:
                print(f"  [PainStream] ✗ Batch insert failed: {resp.status_code}")
                matches_created = 0
        except Exception as e:
            print(f"  [PainStream] ✗ Batch insert error: {e}")
            matches_created = 0

    # Update last_checked timestamp on all alerts
    try:
        now = datetime.now(timezone.utc).isoformat()
        for alert in alerts:
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/pain_alerts",
                headers={**_headers(), "Prefer": "return=minimal"},
                params={"id": f"eq.{alert['id']}"},
                json={"last_checked": now},
                timeout=5,
            )
    except Exception:
        pass

    return matches_created


def deactivate_alert(alert_id: str, user_id: str) -> bool:
    """Deactivate an alert (soft delete)."""
    if not SUPABASE_URL:
        return False
    try:
        resp = requests.patch(
            f"{SUPABASE_URL}/rest/v1/pain_alerts",
            headers={**_headers(), "Prefer": "return=minimal"},
            params={"id": f"eq.{alert_id}", "user_id": f"eq.{user_id}"},
            json={"is_active": False},
            timeout=10,
        )
        return resp.status_code in (200, 204)
    except Exception:
        return False
