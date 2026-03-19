"""
RedditPulse - Pain Stream (Retention Alerts Engine)
Creates alerts from validation keywords, checks new posts for matches,
and stores them for the user's alerts feed.

Solves churn: user validates once -> gets alerted about new relevant posts
-> returns daily.
"""

import os
import re
import uuid
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


def _compile_keyword_pattern(keyword: str):
    clean = str(keyword or "").strip().lower()
    if len(clean) < 2:
        return None
    escaped = re.escape(clean).replace(r"\ ", r"\s+")
    return re.compile(rf"(?<!\w){escaped}(?!\w)", re.IGNORECASE)


def _match_keywords(text: str, keywords: list) -> list:
    matched = []
    for keyword in keywords:
        pattern = _compile_keyword_pattern(keyword)
        if pattern and pattern.search(text):
            matched.append(keyword)
    return matched


def _post_identity(post: dict) -> str:
    canonical_url = str(post.get("permalink") or post.get("url") or "").strip()
    if canonical_url:
        return canonical_url

    source = str(post.get("source") or post.get("subreddit") or "unknown").strip().lower()
    subreddit = str(post.get("subreddit") or "unknown").strip().lower()
    title = str(post.get("title") or "").strip().lower()
    return f"{source}:{subreddit}:{title[:240]}"


def create_alert(user_id: str, validation_id: str, keywords: list,
                 subreddits: list = None, min_score: int = 10) -> dict:
    """
    Create a pain alert after a validation completes.
    Auto-called at end of validate_idea pipeline.

    Returns the created alert row or empty dict on failure.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("  [PainStream] Supabase not configured - skipping alert creation")
        return {}

    payload = {
        "user_id": user_id,
        "validation_id": validation_id,
        "keywords": keywords[:10],
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
            print(f"  [PainStream] OK Alert created: {len(keywords)} keywords, min_score={min_score}")
            return alert
        print(f"  [PainStream] X Alert creation failed: {resp.status_code} {resp.text[:200]}")
        return {}
    except Exception as exc:
        print(f"  [PainStream] X Alert creation error: {exc}")
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


def check_alerts_against_posts(posts: list) -> int:
    """
    Check all active alerts against a batch of scraped posts.
    Creates alert_matches for any hits.
    Returns count of unique matches created or refreshed.

    Called from scraper_job.py after each scrape cycle.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        return 0

    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/pain_alerts",
            headers=_headers(),
            params={"is_active": "eq.true", "select": "*"},
            timeout=10,
        )
        if resp.status_code != 200:
            print(f"  [PainStream] X Could not load alerts: {resp.status_code} {resp.text[:200]}")
            return 0
        alerts = resp.json()
    except Exception as exc:
        print(f"  [PainStream] X Alert fetch error: {exc}")
        return 0

    if not alerts:
        return 0

    batch = []
    seen_match_ids = set()

    for alert in alerts:
        alert_keywords = [str(kw).strip() for kw in (alert.get("keywords") or []) if str(kw).strip()]
        alert_subreddits = [str(sub).lower() for sub in (alert.get("subreddits") or []) if str(sub).strip()]
        min_score = int(alert.get("min_score", 10) or 10)

        for post in posts:
            score = int(post.get("score", 0) or 0)
            if score < min_score:
                continue

            post_subreddit = str(post.get("subreddit") or "").lower()
            if alert_subreddits and post_subreddit not in alert_subreddits:
                continue

            text = str(post.get("full_text") or post.get("title") or "")
            matched = _match_keywords(text, alert_keywords)
            if len(matched) < 1:
                continue

            identity = _post_identity(post)
            match_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{alert['id']}::{identity}"))
            if match_id in seen_match_ids:
                continue
            seen_match_ids.add(match_id)

            batch.append({
                "id": match_id,
                "alert_id": alert["id"],
                "user_id": alert["user_id"],
                "post_title": str(post.get("title") or "")[:500],
                "post_score": score,
                "post_url": str(post.get("permalink") or post.get("url") or ""),
                "subreddit": str(post.get("subreddit") or ""),
                "matched_keywords": matched,
            })

    if batch:
        try:
            resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/alert_matches",
                headers={**_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
                params={"on_conflict": "id"},
                json=batch,
                timeout=15,
            )
            if resp.status_code in (200, 201):
                print(f"  [PainStream] OK {len(batch)} unique matches upserted across {len(alerts)} alerts")
            else:
                print(f"  [PainStream] X Batch upsert failed: {resp.status_code} {resp.text[:200]}")
                return 0
        except Exception as exc:
            print(f"  [PainStream] X Batch upsert error: {exc}")
            return 0

    try:
        now = datetime.now(timezone.utc).isoformat()
        for alert in alerts:
            patch_resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/pain_alerts",
                headers={**_headers(), "Prefer": "return=minimal"},
                params={"id": f"eq.{alert['id']}"},
                json={"last_checked": now},
                timeout=5,
            )
            if patch_resp.status_code >= 400:
                print(f"  [PainStream] X last_checked update failed for alert {alert['id']}: {patch_resp.status_code} {patch_resp.text[:120]}")
    except Exception as exc:
        print(f"  [PainStream] X last_checked update error: {exc}")

    return len(batch)


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
