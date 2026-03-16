"""
RedditPulse - Trend Signals Aggregator
Builds lightweight keyword momentum snapshots for the trend_signals table.
"""

import os
import re
import time
import requests
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone


SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_KEY", ""))

STOP_WORDS = {
    "the", "and", "for", "with", "that", "this", "from", "your", "have", "just",
    "need", "want", "help", "when", "what", "into", "about", "tool", "tools",
    "startup", "market", "using", "used", "like", "than", "been", "more", "less",
    "will", "would", "does", "dont", "cant", "should", "could", "their", "there",
}

NOISE_KEYWORDS = {
    "link", "links", "best", "coming", "planning", "overview", "overviews",
    "discussion", "discussions", "schedule", "scheduling", "update", "updates",
    "list", "lists", "today", "tomorrow", "yesterday", "latest", "thread", "threads",
    "question", "questions", "story", "stories", "general",
}


def _headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _parse_post_time(post):
    value = post.get("created_utc") or post.get("scraped_at") or post.get("created_at")
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except Exception:
            return None
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


def _is_meaningful_token(word: str):
    if not word:
        return False
    if word in STOP_WORDS or word in NOISE_KEYWORDS:
        return False
    if word.startswith("http") or word.startswith("www"):
        return False
    if len(word) < 4:
        return False
    if re.fullmatch(r"\d+", word):
        return False
    return True


def _extract_keywords(text: str):
    words = [
        word
        for word in re.findall(r"\b[a-z][a-z0-9\-]{3,}\b", text.lower())
        if _is_meaningful_token(word)
    ]
    if not words:
        return []

    phrases = []
    for idx in range(len(words) - 1):
        left = words[idx]
        right = words[idx + 1]
        if left == right:
            continue
        phrases.append(f"{left} {right}")

    candidates = phrases or words
    return list(dict.fromkeys(candidates))[:8]


def _classify_tier(change_24h: float, change_7d: float, velocity: float):
    if change_24h >= 100 or velocity >= 2.5:
        return "EXPLODING"
    if change_24h >= 25 or change_7d >= 40:
        return "GROWING"
    if change_24h <= -40 or change_7d <= -50:
        return "DEAD"
    if change_24h <= -15 or change_7d <= -20:
        return "DECLINING"
    return "STABLE"


def _select_recent_posts():
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/posts",
            headers=_headers(),
            params={
                "select": "id,title,full_text,score,sentiment_compound,created_utc,scraped_at,subreddit,permalink",
                "order": "scraped_at.desc",
                "limit": 5000,
            },
            timeout=30,
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception:
        return []
    return []


def aggregate_trends(supabase_client=None, posts=None, select_fn=None, patch_fn=None, upsert_fn=None):
    """
    Compute keyword trend snapshots and write them to trend_signals.
    """
    posts = posts or _select_recent_posts()
    if not posts:
        print("[Trends] No posts available for aggregation")
        return []

    now = datetime.now(timezone.utc)
    windows = {
        "24h": now - timedelta(hours=24),
        "48h": now - timedelta(hours=48),
        "7d": now - timedelta(days=7),
        "14d": now - timedelta(days=14),
        "30d": now - timedelta(days=30),
    }

    by_keyword = defaultdict(lambda: {
        "24h": 0,
        "prev24h": 0,
        "7d": 0,
        "prev7d": 0,
        "sentiment_total": 0.0,
        "sentiment_count": 0,
        "top_posts": [],
    })

    for post in posts:
        post_time = _parse_post_time(post)
        if not post_time or post_time < windows["30d"]:
            continue

        text = f"{post.get('title', '')}".strip()
        keywords = set(_extract_keywords(text))
        if not keywords:
            continue

        score = int(post.get("score", 0) or 0)
        sentiment = float(post.get("sentiment_compound", 0) or 0)
        top_post = {
            "title": post.get("title", ""),
            "score": score,
            "subreddit": post.get("subreddit", ""),
            "url": post.get("permalink", ""),
        }

        for keyword in keywords:
            bucket = by_keyword[keyword]
            if post_time >= windows["24h"]:
                bucket["24h"] += 1
            elif post_time >= windows["48h"]:
                bucket["prev24h"] += 1

            if post_time >= windows["7d"]:
                bucket["7d"] += 1
            elif post_time >= windows["14d"]:
                bucket["prev7d"] += 1

            bucket["sentiment_total"] += sentiment
            bucket["sentiment_count"] += 1
            bucket["top_posts"].append(top_post)

    rows = []
    for keyword, metrics in by_keyword.items():
        post_count_24h = metrics["24h"]
        post_count_7d = metrics["7d"]
        prev24h = metrics["prev24h"]
        prev7d = metrics["prev7d"]

        if keyword in NOISE_KEYWORDS:
            continue
        if post_count_24h == 0 and post_count_7d <= 1:
            continue
        if " " not in keyword and post_count_24h < 2 and post_count_7d < 3:
            continue

        change_24h = ((post_count_24h - prev24h) / max(prev24h, 1)) * 100
        change_7d = ((post_count_7d - prev7d) / max(prev7d, 1)) * 100
        velocity = post_count_24h / max(prev24h, 1)
        sentiment_score = metrics["sentiment_total"] / max(metrics["sentiment_count"], 1)
        top_posts = sorted(metrics["top_posts"], key=lambda item: item["score"], reverse=True)[:5]
        tier = _classify_tier(change_24h, change_7d, velocity)

        rows.append({
            "keyword": keyword,
            "tier": tier,
            "post_count_24h": post_count_24h,
            "post_count_7d": post_count_7d,
            "change_24h": round(change_24h, 2),
            "change_7d": round(change_7d, 2),
            "sentiment_score": round(sentiment_score, 3),
            "top_posts": top_posts,
            "velocity": round(velocity, 3),
            "updated_at": now.isoformat(),
            "created_at": now.isoformat(),
        })

    rows = sorted(rows, key=lambda row: (row["post_count_24h"], row["change_24h"]), reverse=True)[:100]

    if not rows:
        print("[Trends] No keyword rows produced")
        return []

    for row in rows:
        keyword = row["keyword"]
        existing_id = None
        if select_fn:
            existing = select_fn("trend_signals", f"select=id&keyword=eq.{keyword}&limit=1")
            if existing:
                existing_id = existing[0].get("id")
        elif SUPABASE_URL and SUPABASE_KEY:
            try:
                resp = requests.get(
                    f"{SUPABASE_URL}/rest/v1/trend_signals",
                    headers=_headers(),
                    params={"select": "id", "keyword": f"eq.{keyword}", "limit": 1},
                    timeout=10,
                )
                if resp.status_code == 200 and resp.json():
                    existing_id = resp.json()[0].get("id")
            except Exception:
                existing_id = None

        if existing_id and patch_fn:
            patch_fn("trend_signals", f"id=eq.{existing_id}", row)
        elif existing_id and SUPABASE_URL and SUPABASE_KEY:
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/trend_signals?id=eq.{existing_id}",
                headers=_headers(),
                json=row,
                timeout=10,
            )
        elif upsert_fn:
            upsert_fn("trend_signals", [row])
        elif SUPABASE_URL and SUPABASE_KEY:
            requests.post(
                f"{SUPABASE_URL}/rest/v1/trend_signals",
                headers=_headers(),
                json=row,
                timeout=10,
            )

    print(f"[Trends] Aggregation complete — {len(rows)} keywords updated")
    return rows
