"""
Optional Reddit provider adapter backed by ScrapeCreators.

This module is intentionally additive:
- if SCRAPECREATORS_API_KEY is absent, nothing uses it
- if the provider fails, callers should fall back to the existing Reddit paths
"""

from __future__ import annotations

import os
import time
from collections import Counter
from datetime import datetime, timezone
from typing import Any

import requests

SCRAPECREATORS_BASE_URL = os.environ.get(
    "SCRAPECREATORS_BASE_URL",
    "https://api.scrapecreators.com/v1/reddit",
).rstrip("/")

UTILITY_SUBREDDITS = {
    "askreddit",
    "funny",
    "pics",
    "todayilearned",
    "worldnews",
    "news",
    "videos",
    "gaming",
    "movies",
    "television",
    "music",
}

NOISE_WORDS = {
    "app",
    "apps",
    "best",
    "better",
    "build",
    "help",
    "how",
    "looking",
    "need",
    "problem",
    "software",
    "solution",
    "tool",
    "tools",
}


def get_api_key() -> str:
    return os.environ.get("SCRAPECREATORS_API_KEY", "").strip()


def is_available() -> bool:
    return bool(get_api_key())


def _headers(api_key: str) -> dict[str, str]:
    return {
        "x-api-key": api_key,
        "Accept": "application/json",
    }


def _clean_text(value: Any) -> str:
    return str(value or "").replace("\n", " ").replace("\r", " ").strip()


def _keyword_matches(keyword: str, text_lower: str) -> bool:
    kw_lower = str(keyword or "").lower().strip()
    if not kw_lower:
        return False
    if kw_lower in text_lower:
        return True

    words = [word for word in kw_lower.split() if len(word) > 2]
    if len(words) <= 1:
        return False
    matching_words = sum(1 for word in words if word in text_lower)
    return matching_words >= min(2, len(words))


def _to_iso_timestamp(value: Any) -> str:
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
        except Exception:
            return ""
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    except Exception:
        return text


def _normalize_permalink(permalink: Any, fallback_url: Any = "") -> str:
    value = _clean_text(permalink)
    if value.startswith("http://") or value.startswith("https://"):
        return value
    if value.startswith("/"):
        return f"https://reddit.com{value}"
    fallback = _clean_text(fallback_url)
    if fallback.startswith("http://") or fallback.startswith("https://"):
        return fallback
    return value or fallback


def _extract_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []

    for key in ("posts", "results", "items", "comments", "data"):
        value = payload.get(key)
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]

    nested_data = payload.get("data")
    if isinstance(nested_data, dict):
        for key in ("posts", "results", "items", "comments"):
            value = nested_data.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]

    return []


def _request(endpoint: str, params: dict[str, Any], *, timeout: int = 25) -> list[dict[str, Any]]:
    api_key = get_api_key()
    if not api_key:
        return []

    response = requests.get(
        f"{SCRAPECREATORS_BASE_URL}{endpoint}",
        headers=_headers(api_key),
        params=params,
        timeout=timeout,
    )
    response.raise_for_status()
    return _extract_rows(response.json())


def _normalize_post(row: dict[str, Any], *, source: str = "reddit", fallback_subreddit: str = "") -> dict[str, Any]:
    external_id = _clean_text(
        row.get("id")
        or row.get("redditId")
        or row.get("reddit_id")
        or row.get("name")
        or row.get("postId")
        or row.get("post_id")
    )
    title = _clean_text(row.get("title") or row.get("headline"))
    body = _clean_text(
        row.get("selftext")
        or row.get("body")
        or row.get("content")
        or row.get("text")
    )[:3000]
    subreddit = _clean_text(
        row.get("subreddit")
        or row.get("subreddit_name")
        or row.get("subredditName")
        or fallback_subreddit
    ).replace("r/", "").replace("/r/", "")
    permalink = _normalize_permalink(row.get("permalink"), row.get("url"))
    full_text = " ".join(part for part in (title, body) if part).strip()

    return {
        "source": source,
        "provider": "scrapecreators",
        "id": external_id,
        "external_id": external_id,
        "subreddit": subreddit,
        "title": title,
        "body": body,
        "selftext": body,
        "full_text": full_text,
        "author": _clean_text(row.get("author") or row.get("username") or "[deleted]"),
        "score": int(row.get("score") or row.get("ups") or 0),
        "num_comments": int(row.get("num_comments") or row.get("comments") or row.get("comment_count") or 0),
        "created_utc": _to_iso_timestamp(
            row.get("created_utc")
            or row.get("createdAt")
            or row.get("created_at")
            or row.get("timestamp")
        ),
        "permalink": permalink,
        "url": permalink,
    }


def _unique_tokens(keywords: list[str], idea_text: str = "") -> list[str]:
    tokens: list[str] = []
    for keyword in keywords or []:
        clean = _clean_text(keyword)
        if clean:
            tokens.append(clean)
    if idea_text:
        for word in _clean_text(idea_text).split():
            lowered = word.lower().strip(" ,.!?;:()[]{}\"'")
            if len(lowered) >= 4 and lowered not in NOISE_WORDS:
                tokens.append(lowered)

    unique: list[str] = []
    seen = set()
    for token in tokens:
        lowered = token.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        unique.append(token)
    return unique


def _build_queries(keywords: list[str], idea_text: str = "", max_queries: int = 3) -> list[str]:
    tokens = _unique_tokens(keywords, idea_text=idea_text)
    multi_word = [token for token in tokens if " " in token][: max_queries - 1]
    single_word = [token for token in tokens if " " not in token][:4]

    queries: list[str] = []
    queries.extend(multi_word)
    if single_word:
        queries.append(" ".join(single_word[:3]))
    if not queries and tokens:
        queries.append(tokens[0])
    return queries[:max_queries]


def discover_subreddits_from_results(
    posts: list[dict[str, Any]],
    keywords: list[str],
    *,
    selected_subreddits: list[str] | None = None,
    max_subs: int = 6,
) -> list[str]:
    selected_lookup = {
        _clean_text(sub).lower().replace("r/", "").replace("/r/", "")
        for sub in (selected_subreddits or [])
        if _clean_text(sub)
    }
    keyword_tokens = {
        token.lower()
        for token in _unique_tokens(keywords)
        if len(token) >= 3 and token.lower() not in NOISE_WORDS
    }

    scores: Counter[str] = Counter()
    for row in posts or []:
        subreddit = _clean_text(row.get("subreddit")).lower().replace("r/", "").replace("/r/", "")
        if not subreddit or subreddit in selected_lookup or subreddit in UTILITY_SUBREDDITS:
            continue

        text = f"{_clean_text(row.get('title'))} {_clean_text(row.get('body') or row.get('selftext'))}".lower()
        token_hits = sum(1 for token in keyword_tokens if token in text or token in subreddit)
        if token_hits <= 0:
            continue

        score = token_hits * 4
        score += min(int(row.get("score") or 0), 40) / 10
        score += min(int(row.get("num_comments") or 0), 50) / 10
        scores[subreddit] += score

    return [sub for sub, _ in scores.most_common(max_subs)]


def search_keyword_posts(
    keywords: list[str],
    *,
    selected_subreddits: list[str] | None = None,
    forced_subreddits: list[str] | None = None,
    idea_text: str = "",
    max_posts: int = 250,
) -> dict[str, Any]:
    if not is_available():
        return {"posts": [], "discovered_subreddits": [], "stats": {}}

    queries = _build_queries(keywords, idea_text=idea_text)
    raw_global_posts: list[dict[str, Any]] = []
    posts_by_id: dict[str, dict[str, Any]] = {}
    stats = Counter()

    def register(posts: list[dict[str, Any]]) -> None:
        for post in posts:
            text_lower = _clean_text(post.get("full_text")).lower()
            matched_keywords = [kw for kw in keywords if _keyword_matches(kw, text_lower)]
            if keywords and not matched_keywords:
                continue
            key = _clean_text(post.get("external_id") or post.get("id") or post.get("permalink"))
            if not key:
                continue
            post["matched_keywords"] = matched_keywords
            posts_by_id.setdefault(key, post)

    for query in queries:
        try:
            raw_rows = _request("/search", {"query": query, "trim": "true", "timeframe": "month", "sort": "new"})
            stats["requested_requests"] += 1
            stats["successful_requests"] += 1
            normalized_rows = [_normalize_post(row) for row in raw_rows]
            raw_global_posts.extend(normalized_rows)
            register(normalized_rows)
        except Exception:
            stats["requested_requests"] += 1
            stats["failed_requests"] += 1

    discovered = discover_subreddits_from_results(
        raw_global_posts,
        keywords,
        selected_subreddits=selected_subreddits,
        max_subs=6,
    )
    combined_subs = list(
        dict.fromkeys(
            [
                _clean_text(sub).replace("r/", "").replace("/r/", "")
                for sub in list(selected_subreddits or []) + list(forced_subreddits or []) + list(discovered)
                if _clean_text(sub)
            ]
        )
    )[:14]

    subreddit_query = " OR ".join(f"\"{kw}\"" if " " in kw else kw for kw in keywords[:6]) or " ".join(queries[:1])
    for subreddit in combined_subs:
        try:
            raw_rows = _request(
                "/subreddit/search",
                {
                    "subreddit": subreddit,
                    "query": subreddit_query,
                    "trim": "true",
                    "sort": "new",
                    "timeframe": "month",
                },
            )
            stats["requested_requests"] += 1
            stats["successful_requests"] += 1
            register([_normalize_post(row, fallback_subreddit=subreddit) for row in raw_rows])
        except Exception:
            stats["requested_requests"] += 1
            stats["failed_requests"] += 1

    posts = sorted(
        posts_by_id.values(),
        key=lambda post: (
            int(post.get("score", 0) or 0),
            int(post.get("num_comments", 0) or 0),
        ),
        reverse=True,
    )

    stats_payload = {
        "mode": "provider_api",
        "requested_requests": int(stats.get("requested_requests", 0) or 0),
        "successful_requests": int(stats.get("successful_requests", 0) or 0),
        "failed_requests": int(stats.get("failed_requests", 0) or 0),
        "requested_subreddits": len(combined_subs),
        "subreddits_with_posts": len(
            {
                _clean_text(post.get("subreddit")).lower()
                for post in posts
                if _clean_text(post.get("subreddit"))
            }
        ),
        "subreddit_post_counts": dict(
            Counter(
                _clean_text(post.get("subreddit")).lower()
                for post in posts
                if _clean_text(post.get("subreddit"))
            )
        ),
    }
    search_keyword_posts.last_run_stats = stats_payload

    return {
        "posts": posts[:max_posts],
        "discovered_subreddits": discovered,
        "stats": stats_payload,
        "global_posts": raw_global_posts,
    }


def scrape_subreddit_posts(subreddit: str, sort: str = "new", limit: int = 100) -> list[dict[str, Any]]:
    rows = _request(
        "/subreddit/posts",
        {
            "subreddit": subreddit,
            "sort": sort,
            "limit": max(1, min(int(limit or 100), 100)),
            "trim": "true",
            "timeframe": "month",
        },
    )
    return [_normalize_post(row, fallback_subreddit=subreddit) for row in rows]


def scrape_all_subreddit_posts(
    subreddits: list[str],
    *,
    sorts: list[str] | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    if not is_available():
        return []

    sort_modes = list(sorts or ["new", "hot"])
    seen = set()
    posts: list[dict[str, Any]] = []
    subreddit_counts = Counter()
    stats = Counter()

    for subreddit in subreddits or []:
        for sort in sort_modes:
            try:
                batch = scrape_subreddit_posts(subreddit, sort=sort, limit=limit)
                stats["requested_requests"] += 1
                stats["successful_requests"] += 1
            except Exception:
                batch = []
                stats["requested_requests"] += 1
                stats["failed_requests"] += 1

            for post in batch:
                key = _clean_text(post.get("external_id") or post.get("id") or post.get("permalink"))
                if not key or key in seen:
                    continue
                seen.add(key)
                posts.append(post)
                if _clean_text(post.get("subreddit")):
                    subreddit_counts[_clean_text(post.get("subreddit"))] += 1
            time.sleep(0.15)

    scrape_all_subreddit_posts.last_run_stats = {
        "mode": "provider_api",
        "requested_subreddits": len(subreddits or []),
        "requested_requests": int(stats.get("requested_requests", 0) or 0),
        "successful_requests": int(stats.get("successful_requests", 0) or 0),
        "failed_requests": int(stats.get("failed_requests", 0) or 0),
        "subreddit_post_counts": dict(subreddit_counts),
        "subreddits_with_posts": len(subreddit_counts),
    }
    return posts


def fetch_top_comments(
    seed_posts: list[dict[str, Any]],
    keywords: list[str],
    *,
    max_posts: int = 40,
    per_post_limit: int = 4,
) -> list[dict[str, Any]]:
    if not is_available():
        return []

    results: list[dict[str, Any]] = []
    seen = set()
    candidate_posts = sorted(
        [
            post for post in (seed_posts or [])
            if str(post.get("source") or "").lower().startswith("reddit")
            and _clean_text(post.get("permalink"))
            and int(post.get("num_comments", 0) or 0) > 0
        ],
        key=lambda post: (
            int(post.get("score", 0) or 0),
            int(post.get("num_comments", 0) or 0),
        ),
        reverse=True,
    )[:12]

    for post in candidate_posts:
        if len(results) >= max_posts:
            break
        permalink = _clean_text(post.get("permalink"))
        try:
            rows = _request("/post/comments", {"url": permalink, "sort": "top", "limit": per_post_limit, "trim": "true"}, timeout=20)
        except Exception:
            continue

        for row in rows:
            if len(results) >= max_posts:
                break
            normalized = _normalize_post(row, source="reddit_comment", fallback_subreddit=_clean_text(post.get("subreddit")))
            body = _clean_text(normalized.get("body") or normalized.get("selftext"))
            if len(body) < 40 or body in ("[removed]", "[deleted]"):
                continue
            text_lower = f"{_clean_text(post.get('title'))} {body}".lower()
            matched_keywords = [kw for kw in keywords if _keyword_matches(kw, text_lower)]
            if keywords and not matched_keywords:
                continue
            key = _clean_text(normalized.get("external_id") or normalized.get("id") or normalized.get("permalink"))
            if not key or key in seen:
                continue
            seen.add(key)
            normalized["matched_keywords"] = matched_keywords
            normalized["parent_external_id"] = post.get("external_id") or post.get("id") or ""
            results.append(normalized)

    return results[:max_posts]
